import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { deployContractsFixture } from './utils';
import { 
  MockVault, RedeemPool, PToken,
  MockVault__factory, RedeemPool__factory, PToken__factory,
  MockERC20__factory
} from "../typechain";

describe('RedeemPool', () => {

  let mockVault: MockVault;
  let redeemPool: RedeemPool;
  let piBGT: PToken;

  beforeEach(async () => {
    const { protocol, settings, stakingPool, iBGT, Alice, Bob } = await loadFixture(deployContractsFixture);

    const MockVaultFactory = await ethers.getContractFactory("MockVault");
    const MockVault = await MockVaultFactory.deploy(
      await protocol.getAddress(), await settings.getAddress(), await stakingPool.getAddress(),
      await iBGT.getAddress(), "Zoo piBGT", "piBGT"
    );
    mockVault = MockVault__factory.connect(await MockVault.getAddress(), ethers.provider);
    piBGT = PToken__factory.connect(await mockVault.pToken(), ethers.provider);

    let trans = await protocol.connect(Alice).addVault(await mockVault.getAddress());
    await trans.wait();
    await settings.connect(Alice).updateVaultParamValue(await mockVault.getAddress(), ethers.encodeBytes32String("f1"), 0);
    await settings.connect(Alice).updateVaultParamValue(await mockVault.getAddress(), ethers.encodeBytes32String("f2"), 0);

    const RedeemPoolFactory = await ethers.getContractFactory("RedeemPool");
    const RedeemPool = await RedeemPoolFactory.deploy(await mockVault.getAddress());
    redeemPool = RedeemPool__factory.connect(await RedeemPool.getAddress(), ethers.provider);

    // Alice and Bob each gets 1000000 $piBGT by depositing 1000000 $iBGT to the vault
    await expect(iBGT.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(iBGT.connect(Alice).approve(await mockVault.getAddress(), ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(mockVault.connect(Alice).mockDepoit(ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;
    expect(await piBGT.balanceOf(Alice.address)).to.equal(ethers.parseUnits("1000000", await piBGT.decimals()));
    await expect(piBGT.connect(Alice).approve(await redeemPool.getAddress(), ethers.parseUnits("1000000", await piBGT.decimals()))).not.to.be.reverted;

    await expect(iBGT.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(iBGT.connect(Bob).approve(await mockVault.getAddress(), ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(mockVault.connect(Bob).mockDepoit(ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;
    expect(await piBGT.balanceOf(Bob.address)).to.equal(ethers.parseUnits("1000000", await piBGT.decimals()));
    await expect(piBGT.connect(Bob).approve(await redeemPool.getAddress(), ethers.parseUnits("1000000", await piBGT.decimals()))).not.to.be.reverted;
  });

  it('RedeemPool works with iBGT', async () => {
    const [Alice, Bob, Caro] = await ethers.getSigners();
    const iBGT = MockERC20__factory.connect(await mockVault.assetToken(), ethers.provider);
    
    // Alice stakes 0.1 $piBGT, Bob stakes 0.2 $piBGT
    await expect(redeemPool.connect(Alice).redeem(0)).to.be.rejectedWith('Cannot redeem 0');
    await expect(redeemPool.connect(Alice).redeem(ethers.parseUnits("0.1"), {value: ethers.parseUnits("0.001"),})).to.be.rejectedWith(/Transaction reverted/);
    await expect(redeemPool.connect(Alice).redeem(ethers.parseUnits("0.1"), {value: ethers.parseUnits("1"),})).to.be.rejectedWith(/Transaction reverted/);
    
    let trans = await redeemPool.connect(Alice).redeem(ethers.parseUnits("0.1", await piBGT.decimals()));
    await expect(trans).to.changeTokenBalances(
      piBGT,
      [Alice.address, await redeemPool.getAddress()],
      [ethers.parseUnits("-0.1"), ethers.parseUnits("0.1")]
    );
    await expect(trans).to.emit(redeemPool, "Redeem").withArgs(Alice.address, ethers.parseEther("0.1"));
    trans = await redeemPool.connect(Bob).redeem(ethers.parseUnits("0.2", await piBGT.decimals()));
    expect(await redeemPool.userRedeemingBalance(Alice.address)).to.equal(ethers.parseUnits("0.1", await piBGT.decimals()));
    expect(await redeemPool.userRedeemingBalance(Bob.address)).to.equal(ethers.parseUnits("0.2", await piBGT.decimals()));
    expect(await redeemPool.totalRedeemingBalance()).to.equal(ethers.parseUnits("0.3", await piBGT.decimals()));

    // Bob withdraw 0.05 $piBGT
    await expect(redeemPool.connect(Bob).withdrawRedeem(0)).to.be.rejectedWith('Cannot withdraw 0');
    await expect(redeemPool.connect(Bob).withdrawRedeem(ethers.parseUnits("1", await piBGT.decimals()))).to.be.rejectedWith('Insufficient redeeming balance');
    trans = await redeemPool.connect(Bob).withdrawRedeem(ethers.parseUnits("0.05", await piBGT.decimals()));
    await expect(trans).to.changeTokenBalances(
      piBGT,
      [Bob.address, await redeemPool.getAddress()],
      [ethers.parseUnits("0.05", await piBGT.decimals()), ethers.parseUnits("-0.05", await piBGT.decimals())]
    );
    await expect(trans).to.emit(redeemPool, "WithdrawRedeem").withArgs(Bob.address, ethers.parseUnits("0.05", await piBGT.decimals()));
    expect(await redeemPool.userRedeemingBalance(Bob.address)).to.equal(ethers.parseUnits("0.15", await piBGT.decimals()));
    expect(await redeemPool.totalRedeemingBalance()).to.equal(ethers.parseUnits("0.25", await piBGT.decimals()));

    // Bob exit all
    trans = await redeemPool.connect(Bob).exit();
    await expect(trans).to.changeTokenBalances(
      piBGT,
      [Bob.address, await redeemPool.getAddress()],
      [ethers.parseUnits("0.15", await piBGT.decimals()), ethers.parseUnits("-0.15", await piBGT.decimals())]
    );
    await expect(trans).to.emit(redeemPool, "WithdrawRedeem").withArgs(Bob.address, ethers.parseUnits("0.15", await piBGT.decimals()));
    expect(await redeemPool.userRedeemingBalance(Bob.address)).to.equal(0);
    expect(await redeemPool.userRedeemingBalance(Alice.address)).to.equal(ethers.parseUnits("0.1", await piBGT.decimals()));
    expect(await redeemPool.totalRedeemingBalance()).to.equal(ethers.parseUnits("0.1", await piBGT.decimals()));

    // Alice withdraw all, and re-redeem 0.001 $piBGT
    await expect(redeemPool.connect(Alice).exit()).not.to.be.rejected;
    expect(await redeemPool.totalRedeemingBalance()).to.equal(0);
    trans = await redeemPool.connect(Alice).redeem(ethers.parseUnits("0.001", await piBGT.decimals()));
    await expect(trans).not.to.be.reverted;
    expect(await redeemPool.userRedeemingBalance(Alice.address)).to.equal(ethers.parseUnits("0.001", await piBGT.decimals()));
    expect(await redeemPool.totalRedeemingBalance()).to.equal(ethers.parseUnits("0.001", await piBGT.decimals()));

    // Bob re-redeem 0.002 $piBGT
    await expect(await redeemPool.connect(Bob).redeem(ethers.parseUnits("0.002", await piBGT.decimals()))).not.to.be.reverted;
    expect(await redeemPool.userRedeemingBalance(Bob.address)).to.equal(ethers.parseUnits("0.002", await piBGT.decimals()));
    expect(await redeemPool.totalRedeemingBalance()).to.equal(ethers.parseUnits("0.003", await piBGT.decimals()));

    // Cannot claim assets before settlement
    await expect(redeemPool.connect(Alice).claimAssetToken()).to.be.rejectedWith('Not settled');
    expect(await redeemPool.earnedAssetAmount(Alice.address)).to.equal(0);
    expect(await redeemPool.earnedAssetAmount(Bob.address)).to.equal(0);

    // Mock piBGT rebase. Increase total supply by 10%
    const currentTotalSupply = ethers.parseUnits("2000000", await iBGT.decimals());
    const rebaseAmount = ethers.parseUnits("200000", await iBGT.decimals());
    await expect(iBGT.connect(Alice).mint(Alice.address, rebaseAmount)).not.to.be.reverted;
    await expect(iBGT.connect(Alice).approve(await mockVault.getAddress(), rebaseAmount)).not.to.be.reverted;
    await expect(mockVault.connect(Alice).mockSwap(rebaseAmount)).not.to.be.reverted;

    expect(await redeemPool.userRedeemingBalance(Alice.address)).to.equal(ethers.parseUnits("0.0011", await piBGT.decimals()));
    expect(await redeemPool.userRedeemingBalance(Bob.address)).to.equal(ethers.parseUnits("0.0022", await piBGT.decimals()));
    expect(await redeemPool.totalRedeemingBalance()).to.equal(ethers.parseUnits("0.0033", await piBGT.decimals()));

    // Update redeems
    await expect(piBGT.connect(Alice).transfer(Caro.address, ethers.parseUnits("100000", await piBGT.decimals()))).not.to.be.reverted;
    await expect(piBGT.connect(Caro).approve(await redeemPool.getAddress(), ethers.parseUnits("100000", await piBGT.decimals()))).not.to.be.reverted;
    await expect(await redeemPool.connect(Alice).redeem(ethers.parseUnits("0.0011", await piBGT.decimals()))).not.to.be.reverted;
    await expect(await redeemPool.connect(Bob).redeem(ethers.parseUnits("0.0011", await piBGT.decimals()))).not.to.be.reverted;
    await expect(await redeemPool.connect(Caro).redeem(ethers.parseUnits("0.0011", await piBGT.decimals()))).not.to.be.reverted;
    expect(await redeemPool.userRedeemingBalance(Alice.address)).to.equal(ethers.parseUnits("0.0022", await piBGT.decimals()));
    expect(await redeemPool.userRedeemingBalance(Bob.address)).to.equal(ethers.parseUnits("0.0033", await piBGT.decimals()));
    expect(await redeemPool.userRedeemingBalance(Caro.address)).to.equal(ethers.parseUnits("0.0011", await piBGT.decimals()));
    expect(await redeemPool.totalRedeemingBalance()).to.equal(ethers.parseUnits("0.0066", await piBGT.decimals()));

    // Mock settlement
    const totalRedeemAmount = await redeemPool.totalRedeemingBalance();
    const totalAssetAmount = totalRedeemAmount;  // 1:1 ratio
    await expect(iBGT.connect(Alice).mint(await mockVault.getAddress(), totalAssetAmount)).not.to.be.reverted;
    trans = await mockVault.connect(Alice).mockEndEpoch(await redeemPool.getAddress());
    await expect(trans).to.changeTokenBalances(
      piBGT,
      [await redeemPool.getAddress()],
      [-totalRedeemAmount]
    );
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [await mockVault.getAddress(), await redeemPool.getAddress()],
      [-totalAssetAmount, totalAssetAmount]
    );

    // Check state
    expect(await piBGT.balanceOf(await redeemPool.getAddress())).to.equal(0);
    expect(await iBGT.balanceOf(await redeemPool.getAddress())).to.equal(totalAssetAmount);
    await expect(redeemPool.totalRedeemingBalance()).to.be.revertedWith('Already settled');
    await expect(redeemPool.userRedeemingBalance(Alice.address)).to.be.revertedWith('Already settled');

    // Cannot redeem or withdraw redeem now
    await expect(redeemPool.connect(Alice).redeem(ethers.parseUnits("0.001", await piBGT.decimals()))).to.be.revertedWith('Already settled');
    await expect(redeemPool.connect(Alice).withdrawRedeem(ethers.parseUnits("0.001", await piBGT.decimals()))).to.be.revertedWith('Already settled');

    // Cannot settle again
    await expect(mockVault.connect(Alice).mockEndEpoch(await redeemPool.getAddress())).to.be.revertedWith('Already settled');

    // Check earned asset amount
    expect(await redeemPool.earnedAssetAmount(Alice.address)).to.equal(ethers.parseUnits("0.0022", await iBGT.decimals()));
    expect(await redeemPool.earnedAssetAmount(Bob.address)).to.equal(ethers.parseUnits("0.0033", await iBGT.decimals()));
    expect(await redeemPool.earnedAssetAmount(Caro.address)).to.equal(ethers.parseUnits("0.0011", await iBGT.decimals()));
    trans = await redeemPool.connect(Alice).claimAssetToken();
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address, await redeemPool.getAddress()],
      [ethers.parseUnits("0.0022", await iBGT.decimals()), -ethers.parseUnits("0.0022", await iBGT.decimals())]
    );
    await expect(trans).to.emit(redeemPool, "AssetTokenClaimed").withArgs(Alice.address, ethers.parseUnits("0.0022", await iBGT.decimals()), ethers.parseUnits("0.0022", await iBGT.decimals()), 0);

    // Bob exit
    trans = await redeemPool.connect(Bob).exit();
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Bob.address, await redeemPool.getAddress()],
      [ethers.parseUnits("0.0033", await iBGT.decimals()), -ethers.parseUnits("0.0033", await iBGT.decimals())]
    );
    await expect(trans).to.emit(redeemPool, "AssetTokenClaimed").withArgs(Bob.address, ethers.parseUnits("0.0033", await iBGT.decimals()), ethers.parseUnits("0.0033", await iBGT.decimals()), 0);

  });

  it('RedeemPool settlement works even if nobody redeems', async () => {
    const [Alice, Bob, Caro] = await ethers.getSigners();
    const iBGT = MockERC20__factory.connect(await mockVault.assetToken(), ethers.provider);

    expect(await redeemPool.totalRedeemingBalance()).to.equal(0);

    const totalRedeemAmount = 0;
    const totalAssetAmount = 0;
    let trans = await mockVault.connect(Alice).mockEndEpoch(await redeemPool.getAddress());
    await expect(trans).to.changeTokenBalances(
      piBGT,
      [await redeemPool.getAddress()],
      [-totalRedeemAmount]
    );
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [await mockVault.getAddress(), await redeemPool.getAddress()],
      [-totalAssetAmount, totalAssetAmount]
    );

    expect(await redeemPool.earnedAssetAmount(Alice.address)).to.equal(0);

    // Cannot redeem or withdraw redeem now
    await expect(redeemPool.connect(Alice).redeem(ethers.parseUnits("0.001", await piBGT.decimals()))).to.be.revertedWith('Already settled');
    await expect(redeemPool.connect(Alice).withdrawRedeem(ethers.parseUnits("0.001", await piBGT.decimals()))).to.be.revertedWith('Already settled');

    // Cannot settle again
    await expect(mockVault.connect(Alice).mockEndEpoch(await redeemPool.getAddress())).to.be.revertedWith('Already settled');
  });

});
