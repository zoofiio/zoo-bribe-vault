import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { makeToken, deployAllContractsFixture, getBoundValidator, addr0000, addr1111 } from "../utils";

const EXP_SCALE = 10n ** 18n;

describe("bound validator", () => {

  beforeEach(async function () {
    this.vf = await loadFixture(deployAllContractsFixture);
    this.boundValidator = await getBoundValidator(await this.vf.protocol.getAddress());
    this.token = await makeToken("Token", "Token");
  });

  describe("add validation config", () => {

    it("length check", async function () {
      await expect(this.boundValidator.connect(this.vf.Alice).setValidateConfigs([])).to.be.revertedWith("invalid validate config length");
    });

    it("validation config check", async function () {
      const config = {
        asset: addr0000,
        upperBoundRatio: 0,
        lowerBoundRatio: 0,
      };
      await expect(this.boundValidator.connect(this.vf.Alice).setValidateConfigs([config])).to.be.revertedWith("asset can't be zero address");

      config.asset = addr1111;
      await expect(this.boundValidator.connect(this.vf.Alice).setValidateConfigs([config])).to.be.revertedWith("bound must be positive");

      config.lowerBoundRatio = 100;
      config.upperBoundRatio = 80;
      await expect(this.boundValidator.connect(this.vf.Alice).setValidateConfigs([config])).to.be.revertedWith(
        "upper bound must be higher than lowner bound",
      );
    });

    it("config added successfully & event check", async function () {
      const config = {
        asset: await this.token.getAddress(),
        upperBoundRatio: 100,
        lowerBoundRatio: 80,
      };
      await expect(this.boundValidator.connect(this.vf.Bob).setValidateConfigs([config])).to.be.revertedWith("Ownable: caller is not the owner");
      const result = await this.boundValidator.connect(this.vf.Alice).setValidateConfigs([config]);
      await expect(result)
        .to.emit(this.boundValidator, "ValidateConfigAdded")
        .withArgs(await this.token.getAddress(), 100, 80);
      const savedConfig = await this.boundValidator.validateConfigs(await this.token.getAddress());
      expect(savedConfig.upperBoundRatio).to.equal(100);
      expect(savedConfig.lowerBoundRatio).to.equal(80);
      expect(savedConfig.asset).to.equal(await this.token.getAddress());
    });
  });

  describe("validate price", () => {

    it("validate price", async function () {
      const token0 = await makeToken("Token1", "Token1");
      const token1 = await makeToken("Token2", "Token2");
      const validationConfig = {
        asset: await token0.getAddress(),
        upperBoundRatio: EXP_SCALE * 12n / 10n,
        lowerBoundRatio: EXP_SCALE * 8n / 10n,
      };
      await this.boundValidator.connect(this.vf.Alice).setValidateConfigs([validationConfig]);

      const anchorPrice = EXP_SCALE;

      await expect(this.boundValidator.validatePriceWithAnchorPrice(await token1.getAddress(), 100, 0)).to.be.revertedWith(
        "validation config not exist",
      );

      await expect(this.boundValidator.validatePriceWithAnchorPrice(await token0.getAddress(), 100, 0)).to.be.revertedWith(
        "anchor price is not valid",
      );

      let validateResult = await this.boundValidator.validatePriceWithAnchorPrice(
        await token0.getAddress(),
        EXP_SCALE,
        anchorPrice,
      );
      expect(validateResult).to.equal(true);
      validateResult = await this.boundValidator.validatePriceWithAnchorPrice(
        await token0.getAddress(),
        EXP_SCALE  * 100n / 79n,
        anchorPrice,
      );
      expect(validateResult).to.equal(false);
      validateResult = await this.boundValidator.validatePriceWithAnchorPrice(
        await token0.getAddress(),
        EXP_SCALE * 100n / 121n,
        anchorPrice,
      );
      expect(validateResult).to.equal(false);
    });
  });
});