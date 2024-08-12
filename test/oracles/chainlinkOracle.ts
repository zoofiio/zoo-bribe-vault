import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  nativeTokenAddress, makeToken, deployAllContractsFixture, increaseTime, getTime,
  addr0000, getChainlinkOracle, getMockChainlinkFeed
} from "../utils";

const MAX_STALE_PERIOD = 60n * 15n; // 15min

describe("Oracle unit tests", () => {
  before(async function () {
    this.vf = await loadFixture(deployAllContractsFixture);

    this.bnbAddr = nativeTokenAddress;
    this.token = await makeToken("Token", "Token");
    this.vai = await makeToken("VAI", "VAI");
    this.xvs = await makeToken("XVS", "XVS");
    this.exampleSet = await makeToken("ExampleSet", "ExampleSet");
    this.exampleUnset = await makeToken("ExampleUnset", "ExampleUnset");
    this.usdc = await makeToken("USDC", "USDC", 6);
    this.usdt = await makeToken("USDT", "USDT", 6);
    this.dai = await makeToken("DAI", "DAI", 18);

    this.bnbFeed = await getMockChainlinkFeed(8n, 30000000000n);
    this.usdcFeed = await getMockChainlinkFeed(8n, 100000000n);
    this.usdtFeed = await getMockChainlinkFeed(8n, 100000000n);
    this.daiFeed = await getMockChainlinkFeed(8n, 100000000n);

    const instance = await getChainlinkOracle(await this.vf.protocol.getAddress());
    this.chainlinkOracle = instance;
    return instance;
  });

  describe("set token config", () => {

    it("cannot set feed to zero address", async function () {
      await expect(
        this.chainlinkOracle.connect(this.vf.Alice).setTokenConfig({
          asset: this.bnbAddr,
          feed: addr0000,
          maxStalePeriod: MAX_STALE_PERIOD,
        }),
      ).to.be.revertedWith("can't be zero address");
    });

    it("sets a token config", async function () {
      let tokenConfig = {
        asset: this.bnbAddr,
        feed: await this.bnbFeed.getAddress(),
        maxStalePeriod: MAX_STALE_PERIOD,
      };
      await expect(this.chainlinkOracle.connect(this.vf.Bob).setTokenConfig(tokenConfig)).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(this.chainlinkOracle.connect(this.vf.Alice).setTokenConfig(tokenConfig)).not.to.be.reverted;

      tokenConfig = await this.chainlinkOracle.tokenConfigs(this.bnbAddr);
      expect(tokenConfig.feed).to.be.equal(await this.bnbFeed.getAddress());
    });
  });

  describe("batch set token configs", () => {

    it("cannot set feed or token to zero address", async function () {
      await expect(
        this.chainlinkOracle.connect(this.vf.Alice).setTokenConfigs([
          {
            asset: this.bnbAddr,
            feed: addr0000,
            maxStalePeriod: MAX_STALE_PERIOD,
          },
        ]),
      ).to.be.revertedWith("can't be zero address");
      await expect(
        this.chainlinkOracle.connect(this.vf.Alice).setTokenConfigs([
          {
            asset: addr0000,
            feed: await this.bnbFeed.getAddress(),
            maxStalePeriod: MAX_STALE_PERIOD,
          },
        ]),
      ).to.be.revertedWith("can't be zero address");
    });

    it("parameter length check", async function () {
      await expect(this.chainlinkOracle.connect(this.vf.Alice).setTokenConfigs([])).to.be.revertedWith("length can't be 0");
    });

    it("set multiple feeds", async function () {
      const tokenConfigs = [
        {
          asset: this.bnbAddr,
          feed: await this.bnbFeed.getAddress(),
          maxStalePeriod: MAX_STALE_PERIOD * 2n,
        },
        {
          asset: await this.usdt.getAddress(),
          feed: await this.usdtFeed.getAddress(),
          maxStalePeriod: MAX_STALE_PERIOD * 3n,
        },
      ];
      await expect(this.chainlinkOracle.connect(this.vf.Bob).setTokenConfigs(tokenConfigs)).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(this.chainlinkOracle.connect(this.vf.Alice).setTokenConfigs(tokenConfigs)).not.to.be.reverted;

      const [, newBnbFeed, newBnbStalePeriod] = await this.chainlinkOracle.tokenConfigs(this.bnbAddr);
      const [, newUsdtFeed, newUsdtStalePeriod] = await this.chainlinkOracle.tokenConfigs(await this.usdt.getAddress());

      expect(newBnbFeed).to.equal(await this.bnbFeed.getAddress());
      expect(newUsdtFeed).to.equal(await this.usdtFeed.getAddress());
      expect(newBnbStalePeriod).to.be.equal(2n * MAX_STALE_PERIOD);
      expect(newUsdtStalePeriod).to.be.equal(3n * MAX_STALE_PERIOD);
    });
  });

  describe("getPrice", () => {

    beforeEach(async function () {
      await this.chainlinkOracle.connect(this.vf.Alice).setTokenConfig({
        asset: this.bnbAddr,
        feed: await this.bnbFeed.getAddress(),
        maxStalePeriod: MAX_STALE_PERIOD,
      });
      await this.chainlinkOracle.connect(this.vf.Alice).setTokenConfig({
        asset: await this.usdc.getAddress(),
        feed: await this.usdcFeed.getAddress(),
        maxStalePeriod: MAX_STALE_PERIOD,
      });
      await this.chainlinkOracle.connect(this.vf.Alice).setTokenConfig({
        asset: await this.usdt.getAddress(),
        feed: await this.usdtFeed.getAddress(),
        maxStalePeriod: MAX_STALE_PERIOD,
      });
      await this.chainlinkOracle.connect(this.vf.Alice).setTokenConfig({
        asset: await this.dai.getAddress(),
        feed: await this.daiFeed.getAddress(),
        maxStalePeriod: MAX_STALE_PERIOD,
      });
      await this.chainlinkOracle.connect(this.vf.Alice).setDirectPrice(await this.xvs.getAddress(), 7);
      await this.chainlinkOracle.connect(this.vf.Alice).setDirectPrice(await this.exampleSet.getAddress(), 1);
    });

    it("gets the price from Chainlink for BNB", async function () {
      const price = await this.chainlinkOracle.getPrice(this.bnbAddr);
      expect(price).to.equal("300000000000000000000");
    });

    it("gets the price from Chainlink for USDC", async function () {
      const price = await this.chainlinkOracle.getPrice(await this.usdc.getAddress());
      expect(price).to.equal("1000000000000000000");
    });

    it("gets the price from Chainlink for USDT", async function () {
      const price = await this.chainlinkOracle.getPrice(await this.usdt.getAddress());
      expect(price).to.equal("1000000000000000000");
    });

    it("gets the price from Chainlink for DAI", async function () {
      const price = await this.chainlinkOracle.getPrice(await this.dai.getAddress());
      expect(price).to.equal("1000000000000000000");
    });

    it("gets the direct price of a set asset", async function () {
      const price = await this.chainlinkOracle.getPrice(await this.exampleSet.getAddress());
      expect(price).to.equal("1");
    });

    it("reverts if no price or feed has been set", async function () {
      await expect(this.chainlinkOracle.getPrice(await this.exampleUnset.getAddress())).to.revertedWith("can't be zero address");
    });
  });

  describe("setDirectPrice", () => {
    it("sets the direct price", async function () {
      await expect(this.chainlinkOracle.connect(this.vf.Bob).setDirectPrice(await this.xvs.getAddress(), 7)).to.be.revertedWith("Ownable: caller is not the owner");
      await expect(this.chainlinkOracle.connect(this.vf.Alice).setDirectPrice(await this.xvs.getAddress(), 7))
        .to.emit(this.chainlinkOracle, "PricePosted")
        .withArgs(await this.xvs.getAddress(), anyValue, 7);
      const price = await this.chainlinkOracle.prices(await this.xvs.getAddress());
      expect(price).to.be.equal(7);
    });
  });

  describe("stale price validation", () => {
    beforeEach(async function () {
      await this.chainlinkOracle.connect(this.vf.Alice).setTokenConfig({
        asset: this.bnbAddr,
        feed: await this.bnbFeed.getAddress(),
        maxStalePeriod: MAX_STALE_PERIOD,
      });
    });

    it("stale price period cannot be 0", async function () {
      await expect(
        this.chainlinkOracle.connect(this.vf.Alice).setTokenConfig({
          asset: this.bnbAddr,
          feed: await this.bnbFeed.getAddress(),
          maxStalePeriod: 0,
        }),
      ).to.revertedWith("stale period can't be zero");
    });

    it("modify stale price period will emit an event", async function () {
      const result = await this.chainlinkOracle.connect(this.vf.Alice).setTokenConfig({
        asset: this.bnbAddr,
        feed: await this.bnbFeed.getAddress(),
        maxStalePeriod: MAX_STALE_PERIOD,
      });
      await expect(result)
        .to.emit(this.chainlinkOracle, "TokenConfigAdded")
        .withArgs(this.bnbAddr, await this.bnbFeed.getAddress(), MAX_STALE_PERIOD);
    });

    it("revert when price stale", async function () {
      const ADVANCE_SECONDS = 90000;
      let price = await this.chainlinkOracle.getPrice(this.bnbAddr);
      expect(price).to.equal("300000000000000000000");

      const nowSeconds = await getTime();

      await increaseTime(ADVANCE_SECONDS);

      await expect(this.chainlinkOracle.getPrice(this.bnbAddr)).to.revertedWith("chainlink price expired");

      // update round data
      await this.bnbFeed.connect(this.vf.Alice).updateRoundData(1111, 12345, nowSeconds + ADVANCE_SECONDS, nowSeconds);
      price = await this.chainlinkOracle.getPrice(this.bnbAddr);
      expect(price).to.equal(12345n * (10n ** 10n));
    });

    it("if updatedAt is some time in the future, revert it", async function () {
      const nowSeconds = await getTime();
      await this.bnbFeed.connect(this.vf.Alice).updateRoundData(1111, 12345, nowSeconds + 900000, nowSeconds);

      await expect(this.chainlinkOracle.getPrice(this.bnbAddr)).to.revertedWith("updatedAt exceeds block time");
    });

    it("the chainlink anwser is 0, revert it", async function () {
      const nowSeconds = await getTime();
      await this.bnbFeed.connect(this.vf.Alice).updateRoundData(1111, 0, nowSeconds + 1000, nowSeconds);

      await expect(this.chainlinkOracle.getPrice(this.bnbAddr)).to.revertedWith("chainlink price must be positive");
    });
  });
});
