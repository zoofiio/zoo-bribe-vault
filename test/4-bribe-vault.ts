import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { deployContractsFixture, ONE_DAY_IN_SECS, expectedSwapForYTokens, expectBigNumberEquals, makeToken } from './utils';
import { 
  Vault, RedeemPool, PToken, MockERC20,
  MockVault__factory, RedeemPool__factory, PToken__factory,
  MockERC20__factory
} from "../typechain";

const { provider } = ethers;

describe('Bribe Vault', () => {

  it('Bribe Vault works', async () => {
    const { protocol, settings, iBGTVault, stakingPool, iBGT, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const piBGT = PToken__factory.connect(await iBGTVault.pToken(), ethers.provider);

    await expect(iBGT.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(iBGT.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(iBGT.connect(Alice).mint(Caro.address, ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;

    // PToken's decimals should be same to the underlying token
    expect(await piBGT.decimals()).to.equal(await iBGT.decimals());

    // No epochs initially
    expect(await iBGTVault.epochIdCount()).to.equal(0);
    await expect(iBGTVault.epochIdAt(0)).to.be.reverted; // OutOfBounds
    await expect(iBGTVault.currentEpochId()).to.be.revertedWith("No epochs yet");
    await expect(iBGTVault.epochInfoById(0)).to.be.revertedWith("Invalid epoch id");

    // Could not swap before any deposits
    await expect(iBGTVault.connect(Alice).swapForYTokens(100)).to.be.revertedWith("No primary token minted yet");

    // First deposit automaticaly starts a new epoch.
    // Alice deposits 1000 $iBGT, Bob deposits 500 $iBGT
    let aliceDepositAmount = ethers.parseUnits("1000", await iBGT.decimals());
    await expect(iBGT.connect(Alice).approve(await iBGTVault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    let trans = await iBGTVault.connect(Alice).deposit(aliceDepositAmount);
    let currentEpochId = 1;
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address, await stakingPool.getAddress()],
      [-aliceDepositAmount, aliceDepositAmount]
    );
    await expect(trans)
      .to.emit(iBGTVault, "PTokenMinted").withArgs(Alice.address, aliceDepositAmount, aliceDepositAmount, anyValue)
      .to.emit(iBGTVault, "YTokenDummyMinted").withArgs(currentEpochId, await iBGTVault.getAddress(), aliceDepositAmount, aliceDepositAmount)
      .to.emit(iBGTVault, "Deposit").withArgs(currentEpochId, Alice.address, aliceDepositAmount, aliceDepositAmount, aliceDepositAmount);

    let bobDepositAmount = ethers.parseUnits("500", await iBGT.decimals());
    await expect(iBGT.connect(Bob).approve(await iBGTVault.getAddress(), bobDepositAmount)).not.to.be.reverted;
    await expect(iBGTVault.connect(Bob).deposit(bobDepositAmount)).not.to.be.reverted;

    // check epoch
    let currentEpochDuration = ONE_DAY_IN_SECS * 15;  // default to 15 days
    let currentEpochStartTime = (await provider.getBlock(trans.blockHash!))?.timestamp;
    const genesisTime = currentEpochStartTime;
    expect(await iBGTVault.epochIdCount()).to.equal(1);
    expect(await iBGTVault.epochIdAt(0)).to.equal(currentEpochId);
    expect(await iBGTVault.currentEpochId()).to.equal(currentEpochId);
    let currentEpoch = await iBGTVault.epochInfoById(currentEpochId);
    expect(currentEpoch.startTime).to.equal(currentEpochStartTime);
    expect(currentEpoch.duration).to.equal(currentEpochDuration);

    // check pToken and yToken balance
    expect(await iBGTVault.assetBalance()).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await piBGT.balanceOf(Alice.address)).to.equal(aliceDepositAmount);
    expect(await piBGT.balanceOf(Bob.address)).to.equal(bobDepositAmount);
    expect(await piBGT.totalSupply()).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await iBGTVault.yTokenUserBalance(currentEpochId, Alice.address)).to.equal(0);
    expect(await iBGTVault.yTokenUserBalance(currentEpochId, Bob.address)).to.equal(0);
    expect(await iBGTVault.yTokenUserBalance(currentEpochId, await iBGTVault.getAddress())).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await iBGTVault.yTokenTotalSupply(currentEpochId)).to.equal(aliceDepositAmount + bobDepositAmount);
    
    // Alice redeem 100 $piBGT; Bob redeem 50 $piBGT
    const aliceRedeemAmount = ethers.parseUnits("100", await piBGT.decimals());
    const bobRedeemAmount = ethers.parseUnits("50", await piBGT.decimals());
    const redeemPool = RedeemPool__factory.connect(currentEpoch.redeemPool, ethers.provider);
    await expect(piBGT.connect(Alice).approve(await redeemPool.getAddress(), aliceRedeemAmount)).not.to.be.reverted;
    await expect(redeemPool.connect(Alice).redeem(aliceRedeemAmount)).not.to.be.reverted;
    await expect(piBGT.connect(Bob).approve(await redeemPool.getAddress(), bobRedeemAmount)).not.to.be.reverted;
    await expect(redeemPool.connect(Bob).redeem(bobRedeemAmount)).not.to.be.reverted;

    // Total deposit: 
    //   Alice 1000 $iBGT; Bob 500 $iBGT
    // 3 days later, Alice 'swap' 150 $iBGT for yiBGT. => $piBGT is rebased by 150/1500 = 10%
    await time.increase(ONE_DAY_IN_SECS * 3);
    let aliceSwapAmount = ethers.parseUnits("150", await iBGT.decimals());
    let aliceExpectedYTokenAmount = await expectedSwapForYTokens(iBGTVault, 150);  // 11699.44489270558
    let aliceActualSwapForYTokenResult = await iBGTVault.calcSwapForYTokens(aliceSwapAmount);
    expectBigNumberEquals(ethers.parseUnits(aliceExpectedYTokenAmount+'', await iBGT.decimals()), aliceActualSwapForYTokenResult.Y);
    await expect(iBGT.connect(Alice).approve(await iBGTVault.getAddress(), aliceSwapAmount)).not.to.be.reverted;
    trans = await iBGTVault.connect(Alice).swapForYTokens(aliceSwapAmount);
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address, await stakingPool.getAddress()],
      [-aliceSwapAmount, aliceSwapAmount]
    );
    await expect(trans)
      .to.emit(piBGT, "Rebased").withArgs(aliceSwapAmount)
      .to.emit(iBGTVault, "YTokenDummyMinted").withArgs(currentEpochId, Alice.address, aliceSwapAmount, anyValue)
      .to.emit(iBGTVault, "Swap").withArgs(currentEpochId, Alice.address, aliceSwapAmount, aliceSwapAmount, anyValue);

    const swapTimestamp = (await provider.getBlock(trans.blockHash!))?.timestamp;
    expectBigNumberEquals(aliceActualSwapForYTokenResult.P_scaled, await iBGTVault.epochLastSwapPriceScaled(currentEpochId));
    expectBigNumberEquals(BigInt(swapTimestamp!), await iBGTVault.epochLastSwapTimestamp(currentEpochId));
    
    // No bribes now
    // console.log(ethers.formatUnits(await iBGT.balanceOf(Alice.address), await iBGT.decimals()));
    const bribeAmountIBGT = ethers.parseUnits("1000", await iBGT.decimals());

    // Create some dummy bribe token
    const brbToken = await makeToken("Bribe Token", "BRB");
    await expect(brbToken.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await brbToken.decimals()))).not.to.be.reverted;
    const bribeAmountBRB = ethers.parseUnits("2000", await brbToken.decimals());

    // Add bribe tokens to StakingPool
    await expect(stakingPool.connect(Alice).addReward(await iBGT.getAddress(), Alice.address, 10 * ONE_DAY_IN_SECS)).not.to.be.reverted;
    await expect(stakingPool.connect(Alice).addReward(await brbToken.getAddress(), Alice.address, 10 * ONE_DAY_IN_SECS)).not.to.be.reverted;

    // Add bribes
    await expect(iBGT.connect(Alice).approve(await stakingPool.getAddress(), bribeAmountIBGT)).not.to.be.reverted;
    await expect(brbToken.connect(Alice).approve(await stakingPool.getAddress(), bribeAmountBRB)).not.to.be.reverted;
    await expect(stakingPool.connect(Alice).notifyRewardAmount(await iBGT.getAddress(), bribeAmountIBGT)).not.to.be.reverted;
    await expect(stakingPool.connect(Alice).notifyRewardAmount(await brbToken.getAddress(), bribeAmountBRB)).not.to.be.reverted;

    // One day passes. Our vault should get all the bribes
    await time.increase(ONE_DAY_IN_SECS);
    const vaultBribesIBGTAmount = bribeAmountIBGT / 10n;
    const vaultBribesBRBAmount = bribeAmountBRB / 10n;

    // Bob could not claim bribes, since he did not have yTokens
    expect(await iBGTVault.yTokenUserBalance(currentEpochId, Bob.address)).to.equal(0);





  });


});
