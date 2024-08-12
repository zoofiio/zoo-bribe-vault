import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  nativeTokenAddress, makeToken, deployAllContractsFixture, increaseTime, getTime,
  addr0000, addr1111, getBytes32String, getSimpleAddress, getPythOracle
 } from "../utils";
import { BoundValidator__factory, MockAbsPyth__factory } from "../../typechain";

const { provider } = ethers;

const EXP_SCALE = 10n ** 18n;
const bnbAddr = nativeTokenAddress;

const getBoundValidator = async (protocolAddress: string) => {
  const BoundValidatorFactory = await ethers.getContractFactory("BoundValidator");
  const BoundValidator = await BoundValidatorFactory.deploy(protocolAddress);
  return BoundValidator__factory.connect(await BoundValidator.getAddress(), provider);
};

describe("Oracle plugin frame unit tests", () => {

  beforeEach(async function () {
    this.vf = await loadFixture(deployAllContractsFixture);
    this.boundValidator = await getBoundValidator(await this.vf.protocol.getAddress());
    this.pythOracle = await getPythOracle(await this.vf.protocol.getAddress());
  });

  describe("token config", () => {

    describe("add single token config", () => {
      it("token can\"t be zero & maxStalePeriod can't be zero", async function () {
        await expect(
          this.pythOracle.connect(this.vf.Alice).setTokenConfig({
            pythId: getBytes32String(2),
            asset: addr0000,
            maxStalePeriod: 10,
          }),
        ).to.be.revertedWith("can't be zero address");

        await expect(
          this.pythOracle.connect(this.vf.Alice).setTokenConfig({
            pythId: getBytes32String(2),
            asset: addr1111,
            maxStalePeriod: 0,
          }),
        ).to.be.revertedWith("max stale period cannot be 0");
      });

      it("token config added successfully & events check", async function () {
        const result = await this.pythOracle.connect(this.vf.Alice).setTokenConfig({
          asset: addr1111,
          pythId: getBytes32String(2),
          maxStalePeriod: 111,
        });
        await expect(result).to.emit(this.pythOracle, "TokenConfigAdded").withArgs(addr1111, getBytes32String(2), 111);
      });
    });

    describe("batch add token configs", () => {
      it("length check", async function () {
        await expect(this.pythOracle.connect(this.vf.Alice).setTokenConfigs([])).to.be.revertedWith("length can't be 0");
      });

      it("token config added successfully & data check", async function () {
        const tokenConfigs = [
          {
            asset: addr1111,
            pythId: getBytes32String(2),
            maxStalePeriod: 111,
          },
          {
            asset: getSimpleAddress(2),
            pythId: getBytes32String(3),
            maxStalePeriod: 222,
          },
        ];
        await expect(this.pythOracle.connect(this.vf.Bob).setTokenConfigs(tokenConfigs)).to.be.revertedWith("Ownable: caller is not the owner");
        await this.pythOracle.connect(this.vf.Alice).setTokenConfigs(tokenConfigs);

        expect((await this.pythOracle.tokenConfigs(addr1111)).asset).to.equal(addr1111);
        expect((await this.pythOracle.tokenConfigs(getSimpleAddress(2))).maxStalePeriod).to.equal(222);
      });
    });
  });

  describe("get underlying price", () => {

    beforeEach(async function () {
      const UnderlyingPythFactory = await ethers.getContractFactory("MockAbsPyth");
      this.underlyingPythOracle = UnderlyingPythFactory.attach(await this.pythOracle.underlyingPythOracle());
      
      // update some feeds
      const ts = await getTime();
      await this.underlyingPythOracle.connect(this.vf.Alice).updatePriceFeedsHarness([
        {
          id: getBytes32String(1),
          price: {
            price: 10000000n, // 10000000 * 10 ** -6 = $10
            conf: 10,
            expo: -6,
            publishTime: ts,
          },
          emaPrice: {
            price: 0,
            conf: 0,
            expo: 0,
            publishTime: 0,
          },
        },
        {
          id: getBytes32String(2),
          price: {
            price: 1n,
            conf: 10,
            expo: 2,
            publishTime: ts,
          },
          emaPrice: {
            price: 0,
            conf: 0,
            expo: 0,
            publishTime: 0,
          },
        },
      ]);

      this.eth = await makeToken("ETH", "ETH");
    });

    it("revert when asset not exist", async function () {
      await expect(this.pythOracle.getPrice(await this.eth.getAddress())).to.be.revertedWith("asset doesn't exist");
    });

    it("revert when price is expired", async function () {
      await this.pythOracle.connect(this.vf.Alice).setTokenConfig({
        asset: await await this.eth.getAddress(),
        pythId: getBytes32String(2),
        maxStalePeriod: 111,
      });
      await increaseTime(120);
      await expect(this.pythOracle.getPrice(await this.eth.getAddress())).to.be.reverted;
    });

    it("revert when price is not positive (just in case Pyth return insane data)", async function () {
      const ts = await getTime();
      const feed = {
        id: getBytes32String(3),
        price: {
          price: -10n,
          conf: 10,
          expo: -10n,
          publishTime: ts,
        },
        emaPrice: {
          price: 0,
          conf: 0,
          expo: 0,
          publishTime: 0,
        },
      };
      await this.underlyingPythOracle.connect(this.vf.Alice).updatePriceFeedsHarness([feed]);

      await this.pythOracle.connect(this.vf.Alice).setTokenConfig({
        asset: await await this.eth.getAddress(),
        pythId: getBytes32String(3),
        maxStalePeriod: 111,
      });

      // test negative price
      await expect(this.pythOracle.getPrice(await this.eth.getAddress())).to.be.revertedWith("SafeCast: value must be positive");

      feed.price.price = 0n;
      await this.underlyingPythOracle.connect(this.vf.Alice).updatePriceFeedsHarness([feed]);
      await expect(this.pythOracle.getPrice(await this.eth.getAddress())).to.be.revertedWith("invalid pyth oracle price");
    });

    it("price should be 18 decimals", async function () {
      let token = await makeToken("ETH", "ETH");

      await this.pythOracle.connect(this.vf.Alice).setTokenConfig({
        asset: await this.eth.getAddress(),
        pythId: getBytes32String(1),
        maxStalePeriod: 111,
      });

      let price = await this.pythOracle.getPrice(await this.eth.getAddress());
      // 10000000 * 10**-6 * 10**18 = 1e19
      expect(price).to.equal(10n ** 19n);

      token = await makeToken("BTC", "BTC", 8);

      // test another token
      await this.pythOracle.connect(this.vf.Alice).setTokenConfig({
        asset: await token.getAddress(),
        pythId: getBytes32String(2),
        maxStalePeriod: 111,
      });

      price = await this.pythOracle.getPrice(await token.getAddress());
      // 1 * 10**2 * 10**18 = 1e20
      expect(price).to.equal(10n ** 20n);
    });
  });

  describe("validation", () => {

    it("validate price", async function () {
      const token = await makeToken("ETH", "ETH");

      const validationConfig = {
        asset: await token.getAddress(),
        upperBoundRatio: EXP_SCALE * 12n / 10n,
        lowerBoundRatio: EXP_SCALE * 8n/ 10n
      };

      // set price
      await this.pythOracle.connect(this.vf.Alice).setTokenConfig({
        asset: await token.getAddress(),
        pythId: getBytes32String(3),
        maxStalePeriod: 111,
      });
      const feed = {
        id: getBytes32String(3),
        price: {
          price: 10n ** 6n,
          conf: 10,
          expo: -6n,
          publishTime: await getTime(),
        },
        emaPrice: {
          price: 0,
          conf: 0,
          expo: 0,
          publishTime: 0,
        },
      };

      const underlyingPythOracle = MockAbsPyth__factory.connect(await this.pythOracle.underlyingPythOracle(), provider);
      await underlyingPythOracle.connect(this.vf.Alice).updatePriceFeedsHarness([feed]);

      // sanity check
      await expect(this.boundValidator.validatePriceWithAnchorPrice(await token.getAddress(), 100, 0)).to.be.revertedWith(
        "validation config not exist",
      );

      await this.boundValidator.connect(this.vf.Alice).setValidateConfigs([validationConfig]);

      // no need to test this, Pyth price must be positive
      // await expect(
      //   this.pythOracle.validatePrice(token0, 100)
      // ).to.be.revertedWith("anchor price is not valid");

      let validateResult = await this.boundValidator.validatePriceWithAnchorPrice(
        await token.getAddress(),
        EXP_SCALE,
        await this.pythOracle.getPrice(await token.getAddress()),
      );
      expect(validateResult).to.equal(true);
      validateResult = await this.boundValidator.validatePriceWithAnchorPrice(
        await token.getAddress(),
        EXP_SCALE * 100n / 79n,
        await this.pythOracle.getPrice(await token.getAddress()),
      );
      expect(validateResult).to.equal(false);
      validateResult = await this.boundValidator.validatePriceWithAnchorPrice(
        await token.getAddress(),
        EXP_SCALE * 100n / 121n,
        await this.pythOracle.getPrice(await token.getAddress()),
      );
      expect(validateResult).to.equal(false);
    });

    it("validate BNB price", async function () {
      const validationConfig = {
        asset: bnbAddr,
        upperBoundRatio: EXP_SCALE * 12n / 10n,
        lowerBoundRatio: EXP_SCALE * 8n / 10n,
      };

      // set price
      await this.pythOracle.connect(this.vf.Alice).setTokenConfig({
        asset: bnbAddr,
        pythId: getBytes32String(3),
        maxStalePeriod: 111,
      });
      const feed = {
        id: getBytes32String(3),
        price: {
          price: 10n ** 6n,
          conf: 10,
          expo: -6n,
          publishTime: await getTime(),
        },
        emaPrice: {
          price: 0,
          conf: 0,
          expo: 0,
          publishTime: 0,
        },
      };

      const underlyingPythOracle = MockAbsPyth__factory.connect(await this.pythOracle.underlyingPythOracle(), provider);
      await underlyingPythOracle.connect(this.vf.Alice).updatePriceFeedsHarness([feed]);

      // sanity check
      await expect(this.boundValidator.validatePriceWithAnchorPrice(bnbAddr, 100, 0)).to.be.revertedWith(
        "validation config not exist",
      );

      await this.boundValidator.connect(this.vf.Alice).setValidateConfigs([validationConfig]);

      let validateResult = await this.boundValidator.validatePriceWithAnchorPrice(
        bnbAddr,
        EXP_SCALE,
        await this.pythOracle.getPrice(bnbAddr),
      );
      expect(validateResult).to.equal(true);
      validateResult = await this.boundValidator.validatePriceWithAnchorPrice(
        bnbAddr,
        EXP_SCALE * 100n / 79n,
        await this.pythOracle.getPrice(bnbAddr),
      );
      expect(validateResult).to.equal(false);
      validateResult = await this.boundValidator.validatePriceWithAnchorPrice(
        bnbAddr,
        EXP_SCALE * 100n / 121n,
        await this.pythOracle.getPrice(bnbAddr),
      );
      expect(validateResult).to.equal(false);
    });
  });
});