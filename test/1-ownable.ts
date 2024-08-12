import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { encodeBytes32String } from "ethers";
import { ethers } from "hardhat";
import { deployAllContractsFixture, nativeTokenAddress } from "./utils";
import {
  MockERC20__factory,
  MarginToken__factory,
  MockPriceFeed__factory,
  PtyPoolBuyLow__factory,
  PtyPoolSellHigh__factory
} from "../typechain";

const { provider } = ethers;

describe("Ownable", () => {

  it("Protocol ownable work", async () => {
    const {
      Alice, Bob, usd, protocol, settings, ethVault,
      ethx, ethVaultPtyPoolSellHigh, ethVaultPtyPoolBuyLow,
      usdcx, usdcVault
    } = await loadFixture(deployAllContractsFixture);

    let protocolOwner = await protocol.owner();
    expect(protocolOwner).to.equal(await protocol.protocolOwner(), "Protocol owner is Alice");
    expect(protocolOwner).to.equal(Alice.address, "Protocol owner is Alice");

    const contracts = [usd, settings, ethVault, ethx, ethVaultPtyPoolSellHigh, ethVaultPtyPoolBuyLow, usdcx, usdcVault];
    for (const contract of contracts) {
      const owner = await contract.owner();
      expect(owner).to.equal(protocolOwner, "Contract owner is protocol owner Alice");
    }
    
    await expect(protocol.connect(Bob).transferOwnership(Bob.address)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(protocol.connect(Alice).transferOwnership(Bob.address))
      .to.emit(protocol, "OwnershipTransferred")
      .withArgs(Alice.address, Bob.address);

    protocolOwner = await protocol.owner();
    expect(protocolOwner).to.equal(await protocol.protocolOwner(), "Protocol owner is Bob");
    expect(protocolOwner).to.equal(Bob.address, "Protocol owner is Bob");

    for (const contract of contracts) {
      const owner = await contract.owner();
      expect(owner).to.equal(Bob.address, "Contract owner is protocol owner Bob");
    }
  });

  it("Privileged operations", async () => {
    const {
      Alice, Bob, protocol, settings, vaultCalculator, ethVault, usd, ethx, usdcVault
    } = await loadFixture(deployAllContractsFixture);

    let protocolOwner = await protocol.owner();
    expect(protocolOwner).to.equal(await protocol.protocolOwner(), "Protocol owner is Alice");
    expect(protocolOwner).to.equal(Alice.address, "Protocol owner is Alice");

    // Create vault. Any one could deploy a Vault, but only protocol owner could register it to protocol
    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const MockERC20 = await MockERC20Factory.deploy("Dummy Token", "DMY");
    const dmy = MockERC20__factory.connect(await MockERC20.getAddress(), provider);
    const MockPriceFeedFactory = await ethers.getContractFactory("MockPriceFeed");
    const DmyPriceFeedMock = await MockPriceFeedFactory.deploy();
    const dmyPriceFeed = MockPriceFeed__factory.connect(await DmyPriceFeedMock.getAddress(), provider);
    const MarginTokenFactory = await ethers.getContractFactory("MarginToken");
    const Dmyx = await MarginTokenFactory.deploy(await protocol.getAddress(), await settings.getAddress(), "Dummy Margin Token", "DmyX");
    const dmyx = MarginToken__factory.connect(await Dmyx.getAddress(), provider);
    const Vault = await ethers.getContractFactory("Vault", {
      libraries: {
        VaultCalculator: await vaultCalculator.getAddress(),
      }
    });
    const dummyVault = await Vault.deploy(
      await protocol.getAddress(),
      await settings.getAddress(),
      await dmy.getAddress(),
      await dmyx.getAddress(),
      await dmyPriceFeed.getAddress()
    );
    await expect(protocol.connect(Bob).addVault(await dummyVault.getAddress())).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(protocol.connect(Alice).transferOwnership(Bob.address)).not.to.be.reverted;
    await expect(protocol.connect(Bob).addVault(await dummyVault.getAddress()))
      .to.emit(protocol, "VaultAdded")
      .withArgs(await dmy.getAddress(), await dummyVault.getAddress());
    expect(await protocol.isVault(await dummyVault.getAddress())).to.equal(true, "Vault is added");
    expect(await protocol.isVaultAsset(await dmy.getAddress())).to.equal(true, "Vault asset is added");
    expect(await protocol.getVaultAddresses(await dmy.getAddress())).to.deep.equal([await dummyVault.getAddress()], "Vault address is added");
    
    // Only admin could update params
    await expect(settings.connect(Alice).setTreasury(Bob.address)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(settings.connect(Alice).upsertParamConfig(encodeBytes32String("C"), 5 * 10 ** 8, 1 * 10 ** 8, 10 ** 10)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(settings.connect(Alice).updateVaultParamValue(await dummyVault.getAddress(), encodeBytes32String("C"), 10 ** 8)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(protocol.connect(Bob).transferOwnership(Alice.address)).not.to.be.reverted;
    await expect(settings.connect(Alice).setTreasury(Bob.address))
      .to.emit(settings, "UpdateTreasury")
      .withArgs(anyValue, Bob.address);

    await expect(settings.connect(Alice).upsertParamConfig(encodeBytes32String("C"), 5 * 10 ** 8, 1 * 10 ** 8, 10 ** 10))
      .to.emit(settings, "UpsertParamConfig")
      .withArgs(encodeBytes32String("C"), 5 * 10 ** 8, 1 * 10 ** 8, 10 ** 10);
    await expect(settings.connect(Alice).updateVaultParamValue(await dummyVault.getAddress(), encodeBytes32String("C"), 10 ** 7)).to.be.revertedWith("Invalid param or value");
    await expect(settings.connect(Alice).updateVaultParamValue(await dummyVault.getAddress(), encodeBytes32String("C"), 2 * 10 ** 8))
      .to.emit(settings, "UpdateVaultParamValue")
      .withArgs(await dummyVault.getAddress(), encodeBytes32String("C"), 2 * 10 ** 8);
    expect(await settings.treasury()).to.equal(Bob.address, "Treasury is Bob");
    expect(await settings.paramConfig(encodeBytes32String("C"))).to.deep.equal([5n * 10n ** 8n, 1n * 10n ** 8n, 10n ** 10n], "Param C is updated");
    expect(await settings.vaultParamValue(await dummyVault.getAddress(), encodeBytes32String("C"))).to.equal(2 * 10 ** 8, "Vault param C is updated");

    // Only admin could update price feed on emergency
    await expect(dummyVault.connect(Bob).updatePriceFeed(Alice.address)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(dummyVault.connect(Alice).updatePriceFeed(Alice.address)).not.to.be.reverted;
    await expect(ethVault.connect(Bob).updatePriceFeed(Alice.address)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(ethVault.connect(Alice).updatePriceFeed(Alice.address)).not.to.be.reverted;
    await expect(usdcVault.connect(Bob).updatePriceFeed(Alice.address)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(usdcVault.connect(Alice).updatePriceFeed(Alice.address)).not.to.be.reverted;

    // Only admin could pause a Vault
    await expect(dummyVault.connect(Bob).pauseMint()).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(dummyVault.connect(Bob).pauseRedeem()).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(dummyVault.connect(Bob).pauseUsdToMarginTokens()).to.be.revertedWith("Ownable: caller is not the owner"); 
    await expect(dummyVault.connect(Alice).pauseMint())
      .to.emit(dummyVault, "MintPaused")
      .withArgs();
    await expect(dummyVault.connect(Alice).pauseRedeem())
      .to.emit(dummyVault, "RedeemPaused")
      .withArgs();
    await expect(dummyVault.connect(Alice).pauseUsdToMarginTokens())
      .to.emit(dummyVault, "UsdToMarginTokensPaused")
      .withArgs();
    expect(await dummyVault.paused()).to.deep.equal([true, true, true], "Mint and redeem is paused");
    await expect(dummyVault.connect(Alice).unpauseMint())
      .to.emit(dummyVault, "MintUnpaused")
      .withArgs();
    await expect(dummyVault.connect(Alice).unpauseRedeem())
      .to.emit(dummyVault, "RedeemUnpaused")
      .withArgs();
    await expect(dummyVault.connect(Alice).unpauseUsdToMarginTokens())
      .to.emit(dummyVault, "UsdToMarginTokensUnpaused")
      .withArgs();
    expect(await dummyVault.paused()).to.deep.equal([false, false, false], "Mint and redeem is unpaused");

    // Only admin could rescue tokens
    const ptyPoolBuyLow = PtyPoolBuyLow__factory.connect(await ethVault.ptyPoolBuyLow(), provider);
    const ptyPoolSellHigh = PtyPoolSellHigh__factory.connect(await ethVault.ptyPoolSellHigh(), provider);
    await expect(ptyPoolBuyLow.connect(Bob).rescue(nativeTokenAddress, Alice.address)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(ptyPoolSellHigh.connect(Bob).rescue(nativeTokenAddress, Alice.address)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(ptyPoolBuyLow.connect(Alice).rescue(await usd.getAddress(), Alice.address)).to.be.revertedWith("Cannot rescue staking or yield tokens");
    await expect(ptyPoolSellHigh.connect(Alice).rescue(await ethx.getAddress(), Alice.address)).to.be.revertedWith("Cannot rescue staking or yield tokens");
    
    const amount = ethers.parseUnits("100", await dmy.decimals());
    await expect(dmy.connect(Alice).mint(Bob.address, amount)).not.to.be.reverted;
    await expect(dmy.connect(Bob).transfer(await ptyPoolBuyLow.getAddress(), amount)).not.to.be.reverted;
    expect(await dmy.balanceOf(await ptyPoolBuyLow.getAddress())).to.equal(amount, "PtyPoolBuyLow has DMY");
    await expect(ptyPoolBuyLow.connect(Alice).rescue(await dmy.getAddress(), Bob.address))
      .to.emit(ptyPoolBuyLow, "TokenRescued")
      .withArgs(await dmy.getAddress(), Bob.address, amount);

    // Only admin could update pty pools on emergency
    await expect(ethVault.connect(Bob).setPtyPools(Alice.address, Bob.address)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(ethVault.connect(Alice).setPtyPools(Alice.address, Bob.address)).to.be.reverted;

    const PtyPoolBuyLowFactory = await ethers.getContractFactory("PtyPoolBuyLow");
    const PtyPoolBuyLow = await PtyPoolBuyLowFactory.deploy(
      await protocol.getAddress(),
      await settings.getAddress(),
      await ethVault.getAddress(),
      await ethVault.marginToken(),
      await ethVault.assetToken()
    );
    const PtyPoolSellHighFactory = await ethers.getContractFactory("PtyPoolSellHigh");
    const PtyPoolSellHigh = await PtyPoolSellHighFactory.deploy(
      await protocol.getAddress(),
      await settings.getAddress(),
      await ethVault.getAddress(),
      await ethVault.assetToken(),
      await ethVault.marginToken(),
    );
    await expect(ethVault.connect(Alice).setPtyPools(PtyPoolBuyLow, PtyPoolSellHigh)).not.to.be.reverted;

    // Only admin could update margin token's name and symbol
    await expect(dmyx.connect(Bob).setName("Dummy Margin Token V2")).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(dmyx.connect(Bob).setSymbol("DmyX2")).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(dmyx.connect(Alice).setName("Dummy Margin Token V2")).not.to.be.reverted;
    await expect(dmyx.connect(Alice).setSymbol("DmyX2")).not.to.be.reverted;
    expect(await dmyx.name()).to.equal("Dummy Margin Token V2", "Margin token name is updated");
    expect(await dmyx.symbol()).to.equal("DmyX2", "Margin token symbol is updated");
  });

});
