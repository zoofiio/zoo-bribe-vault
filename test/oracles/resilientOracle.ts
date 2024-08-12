import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  nativeTokenAddress, makeToken, deployAllContractsFixture, getBytes32String, getTime,
  addr0000, addr1111, getSimpleAddress, getChainlinkOracle, getMockChainlinkFeed, getPythOracle, getMockBoundValidator
} from "../utils";
import { ResilientOracle__factory, MockV3Aggregator__factory } from "../../typechain";

const { provider } = ethers;

const MAX_STALE_PERIOD = 60n * 15n; // 15min

describe("Oracle plugin frame unit tests", () => {

  beforeEach(async function () {
    this.vf = await loadFixture(deployAllContractsFixture);

    this.boundValidator = await getMockBoundValidator();

    this.mainOracle = await getChainlinkOracle(await this.vf.protocol.getAddress());
    this.pivotOracle = await getPythOracle(await this.vf.protocol.getAddress());
    this.fallbackOracle = await getChainlinkOracle(await this.vf.protocol.getAddress());

    const ResilientOracleFactory = await ethers.getContractFactory("ResilientOracle");
    const ResilientOracle = await ResilientOracleFactory.deploy(await this.vf.protocol.getAddress(), await this.boundValidator.getAddress());
    this.resilientOracle = ResilientOracle__factory.connect(await ResilientOracle.getAddress(), this.vf.Alice);
  });

  describe("token config", () => {

    describe("add single token config", () => {

      it("Asset address can\"t be zero & main oracle can't be zero", async function () {
        await expect(
          this.resilientOracle.setTokenConfig({
            asset: addr0000,
            oracles: [addr1111, addr1111, addr1111],
            enableFlagsForOracles: [true, false, true],
          }),
        ).to.be.revertedWith("can't be zero address");

        await expect(
          this.resilientOracle.setTokenConfig({
            asset: addr1111,
            oracles: [addr0000, addr1111, addr0000],
            enableFlagsForOracles: [true, false, true],
          }),
        ).to.be.revertedWith("can't be zero address");
      });

      it("reset token config", async function () {
        const asset = nativeTokenAddress;

        await expect(this.resilientOracle.connect(this.vf.Bob).setTokenConfig({
          asset,
          oracles: [addr1111, addr1111, addr1111],
          enableFlagsForOracles: [true, false, true],
        })).to.be.revertedWith("Ownable: caller is not the owner");

        await expect(this.resilientOracle.connect(this.vf.Alice).setTokenConfig({
          asset,
          oracles: [addr1111, addr1111, addr1111],
          enableFlagsForOracles: [true, false, true],
        }))
          .to.emit(this.resilientOracle, "TokenConfigAdded")
          .withArgs(asset, addr1111, addr1111, addr1111);
        expect((await this.resilientOracle.getTokenConfig(asset)).enableFlagsForOracles).to.deep.equal([true, false, true]);

        await expect(this.resilientOracle.connect(this.vf.Alice).setTokenConfig({
          asset,
          oracles: [addr1111, addr0000, addr0000],
          enableFlagsForOracles: [false, false, true],
        })).not.to.be.rejected;
        expect((await this.resilientOracle.getTokenConfig(asset)).enableFlagsForOracles).to.deep.equal([false, false, true]);
      });

    });

    describe("batch add token configs", () => {
      it("length check", async function () {
        await expect(this.resilientOracle.setTokenConfigs([])).to.be.revertedWith("length can't be 0");
      });

      it("token config added successfully & data check", async function () {
        const asset1 = await this.vf.stETH.getAddress();
        const asset2 = await this.vf.wbtc.getAddress();

        const tokenConfigs = [
          {
            asset: asset1,
            oracles: [addr1111, addr1111, addr0000],
            enableFlagsForOracles: [true, false, true],
          },
          {
            asset: asset2,
            oracles: [addr1111, getSimpleAddress(2), getSimpleAddress(3)],
            enableFlagsForOracles: [true, false, true],
          },
        ];
        await expect(this.resilientOracle.connect(this.vf.Bob).setTokenConfigs(tokenConfigs)).to.be.revertedWith("Ownable: caller is not the owner");
        await this.resilientOracle.setTokenConfigs(tokenConfigs);
        expect((await this.resilientOracle.getTokenConfig(asset1)).oracles[0]).to.equal(addr1111);
        expect((await this.resilientOracle.getTokenConfig(asset2)).oracles[1]).to.equal(getSimpleAddress(2));
        expect((await this.resilientOracle.getTokenConfig(asset2)).enableFlagsForOracles[0]).to.equal(true);
        // non exist config
        expect((await this.resilientOracle.getTokenConfig(getSimpleAddress(8))).asset).to.be.equal(addr0000);
      });
    });

  });

  describe("change oracle", () => {

    describe("set oracle", () => {

      it("null check", async function () {
        const asset = await this.vf.wbtc.getAddress();

        // asset can't be zero
        await expect(this.resilientOracle.setOracle(addr0000, addr1111, 0)).to.be.revertedWith("can't be zero address");

        // main oracle can't be zero
        await this.resilientOracle.setTokenConfig({
          asset,
          oracles: [addr1111, addr1111, addr0000],
          enableFlagsForOracles: [true, false, true],
        });
        await expect(this.resilientOracle.setOracle(asset, addr0000, 0)).to.be.revertedWith(
          "can't set zero address to main oracle",
        );
        // nothing happens
        await expect(this.resilientOracle.connect(this.vf.Bob).setOracle(asset, addr1111, 0)).to.be.revertedWith("Ownable: caller is not the owner");
        await this.resilientOracle.setOracle(asset, addr1111, 0);
        await this.resilientOracle.setOracle(asset, addr0000, 2);
      });

      it("existance check", async function () {
        const asset = await this.vf.wbtc.getAddress();

        await expect(this.resilientOracle.setOracle(asset, addr1111, 0)).to.be.revertedWith("token config must exist");
      });

      it("oracle set successfully & data check", async function () {
        const asset = await this.vf.wbtc.getAddress();

        await this.resilientOracle.setTokenConfig({
          asset,
          oracles: [addr1111, addr1111, addr0000],
          enableFlagsForOracles: [true, false, true],
        });

        await this.resilientOracle.setOracle(asset, getSimpleAddress(2), 1);
        expect((await this.resilientOracle.getTokenConfig(asset)).enableFlagsForOracles).to.eql([true, false, true]);
        expect((await this.resilientOracle.getTokenConfig(asset)).oracles).to.eql([
          addr1111,
          getSimpleAddress(2),
          addr0000,
        ]);
      });
    });

  });

  describe("get underlying price", () => {
    let asset1: string;
    let asset2: string;
    let asset3: string;

    const token1FallbackPrice = 2222222n;
    const token2FallbackPrice = 3333333n;

    beforeEach(async function () {
      const token1 = await makeToken("Liquid staked Ether 2.0", "stETH");
      asset1 = await token1.getAddress();

      const token2 = await makeToken("WBTC Token", "WBTC");
      asset2 = await token2.getAddress();

      const token3 = await makeToken("Wrapped eETH", "weETH");
      asset3 = await token3.getAddress();

      const UnderlyingPythFactory = await ethers.getContractFactory("MockAbsPyth");
      this.underlyingPythOracle = UnderlyingPythFactory.attach(await this.pivotOracle.underlyingPythOracle());

      await this.resilientOracle.setTokenConfigs([
        {
          asset: asset1,
          oracles: [await this.mainOracle.getAddress(), await this.pivotOracle.getAddress(), await this.fallbackOracle.getAddress()],
          enableFlagsForOracles: [true, true, false],
        },
        {
          asset: asset2,
          oracles: [await this.mainOracle.getAddress(), await this.pivotOracle.getAddress(), await this.fallbackOracle.getAddress()],
          enableFlagsForOracles: [true, true, false],
        },
        {
          asset: asset3,
          oracles: [await this.mainOracle.getAddress(), await this.pivotOracle.getAddress(), await this.fallbackOracle.getAddress()],
          enableFlagsForOracles: [true, true, false],
        },
      ]);

      await this.mainOracle.connect(this.vf.Alice).setTokenConfigs([
        {
          asset: asset1,
          feed: await (await getMockChainlinkFeed(18n, token1FallbackPrice)).getAddress(),
          maxStalePeriod: MAX_STALE_PERIOD,
        },
        {
          asset: asset2,
          feed: await (await getMockChainlinkFeed(18n, token2FallbackPrice)).getAddress(),
          maxStalePeriod: MAX_STALE_PERIOD,
        },
        {
          asset: asset3,
          feed: await (await getMockChainlinkFeed(18n, token2FallbackPrice)).getAddress(),
          maxStalePeriod: MAX_STALE_PERIOD,
        },
      ]);

      await this.pivotOracle.connect(this.vf.Alice).setTokenConfigs([
        {
          asset: asset1,
          pythId: getBytes32String(1),
          maxStalePeriod: MAX_STALE_PERIOD,
        },
        {
          asset: asset2,
          pythId: getBytes32String(3),
          maxStalePeriod: MAX_STALE_PERIOD,
        },
        {
          asset: asset3,
          pythId: getBytes32String(3),
          maxStalePeriod: MAX_STALE_PERIOD,
        },
      ]);

      const ts = await getTime();
      await this.underlyingPythOracle.connect(this.vf.Alice).updatePriceFeedsHarness([
        {
          id: getBytes32String(1),
          price: { price: token1FallbackPrice, conf: 10, expo: 0, publishTime: ts, },
          emaPrice: { price: 0, conf: 0, expo: 0, publishTime: 0 },
        },
        {
          id: getBytes32String(2),
          price: { price: token2FallbackPrice, conf: 10, expo: 0, publishTime: ts, },
          emaPrice: { price: 0, conf: 0, expo: 0, publishTime: 0 },
        },
        {
          id: getBytes32String(3),
          price: { price: token2FallbackPrice, conf: 10, expo: 0, publishTime: ts, },
          emaPrice: { price: 0, conf: 0, expo: 0, publishTime: 0 },
        },
      ]);

      await this.fallbackOracle.connect(this.vf.Alice).setTokenConfigs([
        {
          asset: asset1,
          feed: await (await getMockChainlinkFeed(18n, token1FallbackPrice)).getAddress(),
          maxStalePeriod: MAX_STALE_PERIOD,
        },
        {
          asset: asset2,
          feed: await (await getMockChainlinkFeed(18n, token2FallbackPrice)).getAddress(),
          maxStalePeriod: MAX_STALE_PERIOD,
        },
        {
          asset: asset3,
          feed: await (await getMockChainlinkFeed(18n, token2FallbackPrice)).getAddress(),
          maxStalePeriod: MAX_STALE_PERIOD,
        },
      ]);

    });

    it("revert when protocol paused", async function () {
      await expect(this.resilientOracle.connect(this.vf.Bob).pause()).to.be.revertedWith("Ownable: caller is not the owner");
      await this.resilientOracle.pause();
      await expect(this.resilientOracle.getPrice(asset1)).to.be.revertedWith("resilient oracle is paused");
      await expect(this.resilientOracle.connect(this.vf.Bob).unpause()).to.be.revertedWith("Ownable: caller is not the owner");
      await this.resilientOracle.unpause();
      await expect(this.resilientOracle.getPrice(asset1)).to.be.revertedWith("invalid resilient oracle price");
    });

    it("revert price when main oracle is disabled and there is no fallback oracle", async function () {
      await expect(this.resilientOracle.connect(this.vf.Bob).enableOracle(asset1, 0, false)).to.be.revertedWith("Ownable: caller is not the owner");
      await this.resilientOracle.enableOracle(asset1, 0, false);
      await expect(this.resilientOracle.getPrice(asset1)).to.be.revertedWith("invalid resilient oracle price");
    });

    it("revert price main oracle returns 0 and there is no fallback oracle", async function () {
      let [, feed, ] = await this.fallbackOracle.tokenConfigs(asset1);
      let feedInstance = MockV3Aggregator__factory.connect(feed, provider);
      await expect(feedInstance.connect(this.vf.Alice).updateAnswer(0)).not.to.be.reverted;

      await expect(this.resilientOracle.getPrice(asset1)).to.be.revertedWith("invalid resilient oracle price");
    });

    it("revert if price fails checking", async function () {
      let [, feed, ] = await this.mainOracle.tokenConfigs(asset1);
      let feedInstance = MockV3Aggregator__factory.connect(feed, provider);
      await expect(feedInstance.connect(this.vf.Alice).updateAnswer(1000)).not.to.be.reverted;

      // invalidate the main oracle
      await this.underlyingPythOracle.connect(this.vf.Alice).updatePriceFeedsHarness([
        {
          id: getBytes32String(1),
          price: { price: 1000, conf: 10, expo: 0, publishTime: 0 },
          emaPrice: { price: 0, conf: 0, expo: 0, publishTime: 0 },
        },
      ]);

      await this.boundValidator.connect(this.vf.Alice).setValidateResult(asset1, false);
      await expect(this.resilientOracle.getPrice(asset1)).to.be.revertedWith("invalid resilient oracle price");
    });

    it("check price with/without pivot oracle", async function () {
      let [, feed, ] = await this.mainOracle.tokenConfigs(asset1);
      let mainOracleFeedInstance = MockV3Aggregator__factory.connect(feed, provider);

      await expect(mainOracleFeedInstance.connect(this.vf.Alice).updateAnswer(1000)).not.to.be.reverted;
      await this.boundValidator.connect(this.vf.Alice).setValidateResult(asset1, false);

      // empty pivot oracle
      await this.resilientOracle.connect(this.vf.Alice).setOracle(asset1, addr0000, 1);
      const price1 = await this.resilientOracle.getPrice(asset1);
      expect(price1).to.equal(1000);

      // set oracle back
      await this.resilientOracle.connect(this.vf.Alice).setOracle(asset1, await this.pivotOracle.getAddress(), 1);
      await expect(mainOracleFeedInstance.connect(this.vf.Alice).updateAnswer(1000)).not.to.be.reverted;
      await this.underlyingPythOracle.connect(this.vf.Alice).updatePriceFeedsHarness([
        {
          id: getBytes32String(1),
          price: { price: 1000, conf: 10, expo: 0, publishTime: 0 },
          emaPrice: { price: 0, conf: 0, expo: 0, publishTime: 0 },
        },
      ]);

      // invalidate price
      await this.boundValidator.connect(this.vf.Alice).setValidateResult(asset1, false);
      await expect(this.resilientOracle.getPrice(asset1)).to.be.revertedWith("invalid resilient oracle price");
    });

    it("disable pivot oracle", async function () {
      let [, feed, ] = await this.mainOracle.tokenConfigs(asset1);
      let asset1MainOracleFeedInstance = MockV3Aggregator__factory.connect(feed, provider);
      [, feed, ] = await this.mainOracle.tokenConfigs(asset3);
      let asset3MainOracleFeedInstance = MockV3Aggregator__factory.connect(feed, provider);

      await expect(asset1MainOracleFeedInstance.connect(this.vf.Alice).updateAnswer(1000)).not.to.be.reverted;
      await expect(asset3MainOracleFeedInstance.connect(this.vf.Alice).updateAnswer(2000)).not.to.be.reverted;

      // pivot passes the price...
      await this.boundValidator.connect(this.vf.Alice).setValidateResult(asset1, true);
      await this.boundValidator.connect(this.vf.Alice).setValidateResult(asset3, true);

      // ...but pivot is disabled, so it won't come to invalidate
      await this.resilientOracle.connect(this.vf.Alice).enableOracle(asset1, 1, false);
      await this.resilientOracle.connect(this.vf.Alice).enableOracle(asset3, 1, false);
      const price1 = await this.resilientOracle.getPrice(asset1);
      expect(price1).to.equal(1000);
      const price3 = await this.resilientOracle.getPrice(asset3);
      expect(price3).to.equal(2000);
    });

    it("enable fallback oracle", async function () {
      let [, feed, ] = await this.mainOracle.tokenConfigs(asset2);
      let asset2MainOracleFeedInstance = MockV3Aggregator__factory.connect(feed, provider);
      [, feed, ] = await this.fallbackOracle.tokenConfigs(asset2);
      let asset2FallbackOracleFeedInstance = MockV3Aggregator__factory.connect(feed, provider);

      [, feed, ] = await this.mainOracle.tokenConfigs(asset3);
      let asset3MainOracleFeedInstance = MockV3Aggregator__factory.connect(feed, provider);

      await expect(asset2MainOracleFeedInstance.connect(this.vf.Alice).updateAnswer(1000)).not.to.be.reverted;
      await expect(asset3MainOracleFeedInstance.connect(this.vf.Alice).updateAnswer(2000)).not.to.be.reverted;

      // invalidate the price first
      await this.underlyingPythOracle.connect(this.vf.Alice).updatePriceFeedsHarness([
        {
          id: getBytes32String(2),
          price: { price: 1000, conf: 10, expo: 0, publishTime: await getTime() },
          emaPrice: { price: 0, conf: 0, expo: 0, publishTime: 0 },
        },
        {
          id: getBytes32String(3),
          price: { price: 2000, conf: 10, expo: 0, publishTime: await getTime() },
          emaPrice: { price: 0, conf: 0, expo: 0, publishTime: 0 },
        },
      ]);

      await this.boundValidator.connect(this.vf.Alice).setValidateResult(asset2, false);
      await this.boundValidator.connect(this.vf.Alice).setValidateResult(asset3, false);

      await expect(this.resilientOracle.getPrice(asset2)).to.be.revertedWith("invalid resilient oracle price");
      await expect(this.resilientOracle.getPrice(asset3)).to.be.revertedWith("invalid resilient oracle price");

      // enable fallback oracle
      await expect(asset2MainOracleFeedInstance.connect(this.vf.Alice).updateAnswer(0)).not.to.be.reverted;
      await this.boundValidator.connect(this.vf.Alice).setValidateResult(asset2, true);
      await this.resilientOracle.enableOracle(asset2, 2, true);
      expect(await this.resilientOracle.getPrice(asset2)).to.equal(token2FallbackPrice);

      // set fallback oracle to zero address
      await this.resilientOracle.setOracle(asset2, addr0000, 2);
      await expect(this.resilientOracle.getPrice(asset2)).to.be.revertedWith("invalid resilient oracle price");

      // bring fallback oracle to action, but return 0 price
      await this.resilientOracle.setOracle(asset2, await this.fallbackOracle.getAddress(), 2);
      await expect(asset2FallbackOracleFeedInstance.connect(this.vf.Alice).updateAnswer(0)).not.to.be.reverted;
      // notice: asset2 is invalidated
      await expect(this.resilientOracle.getPrice(asset2)).to.be.revertedWith("invalid resilient oracle price");
    });

    it("Return fallback price when fallback price is validated successfully with pivot oracle", async function () {
      let [, feed, ] = await this.mainOracle.tokenConfigs(asset1);
      let asset1MainOracleFeedInstance = MockV3Aggregator__factory.connect(feed, provider);
      [, feed, ] = await this.fallbackOracle.tokenConfigs(asset1);
      let asset1FallbackOracleFeedInstance = MockV3Aggregator__factory.connect(feed, provider);

      // main oracle price is invalid
      await expect(asset1MainOracleFeedInstance.connect(this.vf.Alice).updateAnswer(0)).not.to.be.reverted;
      await expect(asset1FallbackOracleFeedInstance.connect(this.vf.Alice).updateAnswer(2000)).not.to.be.reverted;
      await this.underlyingPythOracle.connect(this.vf.Alice).updatePriceFeedsHarness([
        {
          id: getBytes32String(1),
          price: { price: 1000, conf: 10, expo: 0, publishTime: await getTime() },
          emaPrice: { price: 0, conf: 0, expo: 0, publishTime: 0 },
        },
      ]);

      // fallback oracle is enabled
      await this.resilientOracle.enableOracle(asset1, 0, false);
      await this.resilientOracle.enableOracle(asset1, 2, true);
      await this.boundValidator.connect(this.vf.Alice).setValidateResult(asset1, true);
      expect(await this.resilientOracle.getPrice(asset1)).to.be.equal(2000);
    });

    it("Return main price when fallback price validation failed with pivot oracle", async function () {
      let [, feed, ] = await this.mainOracle.tokenConfigs(asset1);
      let asset1MainOracleFeedInstance = MockV3Aggregator__factory.connect(feed, provider);
      [, feed, ] = await this.fallbackOracle.tokenConfigs(asset1);
      let asset1FallbackOracleFeedInstance = MockV3Aggregator__factory.connect(feed, provider);

      await expect(asset1MainOracleFeedInstance.connect(this.vf.Alice).updateAnswer(2000)).not.to.be.reverted;
      // pivot oracle price is invalid
      await expect(asset1FallbackOracleFeedInstance.connect(this.vf.Alice).updateAnswer(1000)).not.to.be.reverted;
      await this.underlyingPythOracle.connect(this.vf.Alice).updatePriceFeedsHarness([
        {
          id: getBytes32String(1),
          price: { price: 0, conf: 10, expo: 0, publishTime: await getTime() },
          emaPrice: { price: 0, conf: 0, expo: 0, publishTime: 0 },
        },
      ]);

      // fallback oracle is enabled
      await this.resilientOracle.enableOracle(asset1, 2, true);
      await this.boundValidator.connect(this.vf.Alice).setValidateResult(asset1, true);
      expect(await this.resilientOracle.getPrice(asset1)).to.be.equal(2000);
    });
  });

});