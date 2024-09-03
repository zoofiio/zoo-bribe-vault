import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { 
  deployContractsFixture, ONE_DAY_IN_SECS, expectedSwapForYTokensF0, expectBigNumberEquals, makeToken,
  expectedNextSwapK0, expectedUpdateNextSwapK0, expectedCalcSwap
} from './utils';
import { RedeemPool__factory, PToken__factory } from "../typechain";
import { formatUnits, parseUnits } from 'ethers';

const { provider } = ethers;

describe('Bribe Vault', () => {

  it('Bribe Vault basic functionality works', async () => {
    const { protocol, settings, vault, stakingPool, iBGT, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const piBGT = PToken__factory.connect(await vault.pToken(), ethers.provider);

    await settings.connect(Alice).updateVaultParamValue(await vault.getAddress(), ethers.encodeBytes32String("SwapF"), 0);
    await settings.connect(Alice).updateVaultParamValue(await vault.getAddress(), ethers.encodeBytes32String("f1"), 0);
    await settings.connect(Alice).updateVaultParamValue(await vault.getAddress(), ethers.encodeBytes32String("f2"), 0);

    await expect(iBGT.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(iBGT.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(iBGT.connect(Alice).mint(Caro.address, ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;

    // PToken's decimals should be same to the underlying token
    expect(await piBGT.decimals()).to.equal(await iBGT.decimals());

    // Create some dummy bribe token
    const brbToken = await makeToken(await protocol.getAddress(), "Bribe Token", "BRB");
    await expect(brbToken.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await brbToken.decimals()))).not.to.be.reverted;
    const bribeAmountBRB = ethers.parseUnits("2000", await brbToken.decimals());

    // Add bribe tokens to StakingPool
    await expect(stakingPool.connect(Alice).addReward(await iBGT.getAddress(), Alice.address, 10 * ONE_DAY_IN_SECS)).not.to.be.reverted;
    await expect(stakingPool.connect(Alice).addReward(await brbToken.getAddress(), Alice.address, 10 * ONE_DAY_IN_SECS)).not.to.be.reverted;
    // expect(await stakingPool.rewardTokensLength()).to.equal(2);

    // No epochs initially
    expect(await vault.epochIdCount()).to.equal(0);
    await expect(vault.epochIdAt(0)).to.be.reverted; // OutOfBounds
    await expect(vault.currentEpochId()).to.be.revertedWith("No epochs yet");
    await expect(vault.epochInfoById(0)).to.be.revertedWith("Invalid epoch id");

    // Could not swap before any deposits
    await expect(vault.connect(Alice).swap(100)).to.be.revertedWith("No principal token minted yet");

    // First deposit automaticaly starts a new epoch.
    // Alice deposits 1000 $iBGT, Bob deposits 500 $iBGT
    let aliceDepositAmount = ethers.parseUnits("1000", await iBGT.decimals());
    await expect(iBGT.connect(Alice).approve(await vault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    let trans = await vault.connect(Alice).deposit(aliceDepositAmount);
    let currentEpochId = 1;
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address, await stakingPool.getAddress()],
      [-aliceDepositAmount, aliceDepositAmount]
    );
    await expect(trans)
      .to.emit(vault, "PTokenMinted").withArgs(Alice.address, aliceDepositAmount, aliceDepositAmount, anyValue)
      .to.emit(vault, "YTokenDummyMinted").withArgs(currentEpochId, await vault.getAddress(), aliceDepositAmount, aliceDepositAmount)
      .to.emit(vault, "Deposit").withArgs(currentEpochId, Alice.address, aliceDepositAmount, aliceDepositAmount, aliceDepositAmount);

    let bobDepositAmount = ethers.parseUnits("500", await iBGT.decimals());
    await expect(iBGT.connect(Bob).approve(await vault.getAddress(), bobDepositAmount)).not.to.be.reverted;
    await expect(vault.connect(Bob).deposit(bobDepositAmount)).not.to.be.reverted;

    // check epoch
    let currentEpochDuration = ONE_DAY_IN_SECS * 15;  // default to 15 days
    let currentEpochStartTime = (await provider.getBlock(trans.blockHash!))?.timestamp;
    const genesisTime = currentEpochStartTime;
    expect(await vault.epochIdCount()).to.equal(1);
    expect(await vault.epochIdAt(0)).to.equal(currentEpochId);
    expect(await vault.currentEpochId()).to.equal(currentEpochId);
    let currentEpoch = await vault.epochInfoById(currentEpochId);
    expect(currentEpoch.startTime).to.equal(currentEpochStartTime);
    expect(currentEpoch.duration).to.equal(currentEpochDuration);

    // check pToken and yToken balance
    expect(await vault.assetBalance()).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await piBGT.balanceOf(Alice.address)).to.equal(aliceDepositAmount);
    expect(await piBGT.balanceOf(Bob.address)).to.equal(bobDepositAmount);
    expect(await piBGT.totalSupply()).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await vault.yTokenUserBalance(currentEpochId, Alice.address)).to.equal(0);
    expect(await vault.yTokenUserBalance(currentEpochId, Bob.address)).to.equal(0);
    expect(await vault.yTokenUserBalance(currentEpochId, await vault.getAddress())).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await vault.yTokenTotalSupply(currentEpochId)).to.equal(aliceDepositAmount + bobDepositAmount);
    
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
    await time.increaseTo(genesisTime! + ONE_DAY_IN_SECS * 3);
    let aliceSwapAmount = ethers.parseUnits("1", await iBGT.decimals());
    let aliceExpectedYTokenAmount = await expectedSwapForYTokensF0(vault, 1);  // 955.248658753
    let aliceActualSwapForYTokenResult = await vault.calcSwapResultF0(aliceSwapAmount);
    expectBigNumberEquals(ethers.parseUnits(aliceExpectedYTokenAmount+'', await iBGT.decimals()), aliceActualSwapForYTokenResult.Y);
    await expect(iBGT.connect(Alice).approve(await vault.getAddress(), aliceSwapAmount)).not.to.be.reverted;
    trans = await vault.connect(Alice).swap(aliceSwapAmount);
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address, await stakingPool.getAddress()],
      [-aliceSwapAmount, aliceSwapAmount]
    );
    await expect(trans)
      .to.emit(piBGT, "Rebased").withArgs(aliceSwapAmount)
      // .to.emit(vault, "YTokenDummyMinted").withArgs(currentEpochId, Alice.address, aliceSwapAmount, anyValue)
      .to.emit(vault, "Swap").withArgs(currentEpochId, Alice.address, aliceSwapAmount, 0, aliceSwapAmount, anyValue);

    const swapTimestamp = (await provider.getBlock(trans.blockHash!))?.timestamp;
    expectBigNumberEquals(aliceActualSwapForYTokenResult.P_floor_scaled, await vault.epochLastSwapPriceScaledF0(currentEpochId));
    expectBigNumberEquals(BigInt(swapTimestamp!), await vault.epochLastSwapTimestampF0(currentEpochId));
    
    // No bribes now
    // console.log(ethers.formatUnits(await iBGT.balanceOf(Alice.address), await iBGT.decimals()));
    const bribeAmountIBGT = ethers.parseUnits("1000", await iBGT.decimals());

    // Add bribes
    await expect(iBGT.connect(Alice).approve(await stakingPool.getAddress(), bribeAmountIBGT)).not.to.be.reverted;
    await expect(brbToken.connect(Alice).approve(await stakingPool.getAddress(), bribeAmountBRB)).not.to.be.reverted;
    await expect(stakingPool.connect(Alice).notifyRewardAmount(await iBGT.getAddress(), bribeAmountIBGT)).not.to.be.reverted;
    await expect(stakingPool.connect(Alice).notifyRewardAmount(await brbToken.getAddress(), bribeAmountBRB)).not.to.be.reverted;

    // Bob could not claim bribes, since he did not have yTokens
    expect(await vault.yTokenUserBalance(currentEpochId, Bob.address)).to.equal(0);
    expect(await vault.yTokenUserBalanceSynthetic(currentEpochId, Bob.address)).to.equal(0);
    await expect(vault.connect(Bob).claimBribes(currentEpochId)).to.be.revertedWith("No yToken balance");

    // Could not claim bribes, since current epoch is not over
    await expect(vault.connect(Alice).claimBribes(currentEpochId)).to.be.revertedWith("Epoch not ended yet");

    // Another 10 days later, Bob swaps 50 $iBGT for y tokens. And bribes are auto claimed for this epoch
    console.log("\n========= Bob Swaps for YTokens ===============");
    // await time.increaseTo(genesisTime! + ONE_DAY_IN_SECS * 13);
    // let bobSwapAmount = ethers.parseUnits("1", await iBGT.decimals());
    // let bobExpectedYTokenAmount = await expectedSwapForYTokensF0(vault, 1);
    // let bobActualSwapForYTokenResult = await vault.calcSwapResultF0(bobSwapAmount);
    // expectBigNumberEquals(ethers.parseUnits(bobExpectedYTokenAmount+'', await iBGT.decimals()), bobActualSwapForYTokenResult.Y);
    // await expect(iBGT.connect(Bob).approve(await vault.getAddress(), bobSwapAmount)).not.to.be.reverted;
    // trans = await vault.connect(Bob).swap(bobSwapAmount);
    // await expect(trans).to.changeTokenBalances(
    //   iBGT,
    //   [Bob.address], // New $iBGT is added to staking pool; but $iBGT bribe is also withdrawn
    //   [-bobSwapAmount]
    // );
    // await expect(trans)
    //   .to.emit(piBGT, "Rebased").withArgs(bobSwapAmount)
    //   // .to.emit(vault, "YTokenDummyMinted").withArgs(currentEpochId, Bob.address, bobSwapAmount, anyValue)
    //   .to.emit(vault, "Swap").withArgs(currentEpochId, Bob.address, bobSwapAmount, 0, bobSwapAmount, anyValue);

    // 16 days later, epoch ends. And all bribes are distributed
    await time.increaseTo(genesisTime! + ONE_DAY_IN_SECS * 16);
    // let vaultBribesIBGTAmount = bribeAmountIBGT;
    // let vaultBribesBRBAmount = bribeAmountBRB;
    let vaultBribesIBGTAmount = 0n;
    let vaultBribesBRBAmount = 0n;

    // Check alice's bribes.
    // Alice yToken balance: 11699.3876024; Bob yToken balance: 111673.028751; vault ytoken balance: ?
    const aliceYTokenBalanceSynthetic = await vault.yTokenUserBalanceSynthetic(currentEpochId, Alice.address);
    const bobYTokenBalanceSynthetic = await vault.yTokenUserBalanceSynthetic(currentEpochId, Bob.address);
    const vaultYTokenBalanceSynthetic = await vault.yTokenUserBalanceSynthetic(currentEpochId, await vault.getAddress());
    const totalYTokenBalanceSynthetic = await vault.yTokenTotalSupplySynthetic(currentEpochId);
    console.log(aliceYTokenBalanceSynthetic, bobYTokenBalanceSynthetic, totalYTokenBalanceSynthetic);
    expectBigNumberEquals(aliceYTokenBalanceSynthetic + bobYTokenBalanceSynthetic + vaultYTokenBalanceSynthetic, totalYTokenBalanceSynthetic);

    const expectedAliceBribesIBGT = vaultBribesIBGTAmount * aliceYTokenBalanceSynthetic / totalYTokenBalanceSynthetic;
    const expectedBobBribesIBGT = vaultBribesIBGTAmount * bobYTokenBalanceSynthetic / totalYTokenBalanceSynthetic;

    const expectedAliceBribesBRB = vaultBribesBRBAmount * aliceYTokenBalanceSynthetic / totalYTokenBalanceSynthetic;
    const expectedBobBribesBRB = vaultBribesBRBAmount * bobYTokenBalanceSynthetic / totalYTokenBalanceSynthetic;

    const actualAliceBribes = await vault.calcBribes(currentEpochId, Alice.address);
    const actualBobBribes = await vault.calcBribes(currentEpochId, Bob.address);
    console.log(actualAliceBribes);
    console.log(actualBobBribes);

    expect(actualAliceBribes.length).to.equal(2);
    expect(actualAliceBribes[0][1]).to.equal(await iBGT.getAddress());
    expectBigNumberEquals(expectedAliceBribesIBGT, actualAliceBribes[0][2]);
    expect(actualAliceBribes[1][1]).to.equal(await brbToken.getAddress());
    expectBigNumberEquals(expectedAliceBribesBRB, actualAliceBribes[1][2]);

    expect(actualBobBribes.length).to.equal(2);
    expect(actualBobBribes[0][1]).to.equal(await iBGT.getAddress());
    expectBigNumberEquals(expectedBobBribesIBGT, actualBobBribes[0][2]);
    expect(actualBobBribes[1][1]).to.equal(await brbToken.getAddress());
    expectBigNumberEquals(expectedBobBribesBRB, actualBobBribes[1][2]);


  });

  it.only('Swap formula 1 works', async () => {
    const { protocol, settings, vault, stakingPool, iBGT, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const piBGT = PToken__factory.connect(await vault.pToken(), ethers.provider);

    await settings.connect(Alice).updateVaultParamValue(await vault.getAddress(), ethers.encodeBytes32String("SwapF"), 1);
    await settings.connect(Alice).updateVaultParamValue(await vault.getAddress(), ethers.encodeBytes32String("f1"), 0);
    await settings.connect(Alice).updateVaultParamValue(await vault.getAddress(), ethers.encodeBytes32String("f2"), 0);

    await expect(iBGT.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(iBGT.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(iBGT.connect(Alice).mint(Caro.address, ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;

    // First deposit automaticaly starts a new epoch.
    // Alice deposits 1000 $iBGT
    const genesisTime = await time.latest();
    let aliceDepositAmount = ethers.parseUnits("1000", await iBGT.decimals());
    await expect(iBGT.connect(Alice).approve(await vault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    let epochId = 1;
    let expectedK0 = await expectedNextSwapK0(vault, 1000);
    let actualK0 = await vault.epochNextSwapK0(epochId);
    expectBigNumberEquals(parseUnits(expectedK0+"", 18 + 18 + 10), actualK0);

    // 1 hour later, Bob swaps 10 $iBGT for yTokens
    await time.increaseTo(genesisTime + 3600);
    let swapAssetAmount = ethers.parseUnits("10", await iBGT.decimals());
    let expectedYTokenAmount = await expectedCalcSwap(vault, 10);  // 32.670532239252
    let actualYTokenAmount = await vault.calcSwapResult(swapAssetAmount);
    expectBigNumberEquals(parseUnits(expectedYTokenAmount+"", 18), actualYTokenAmount);

    await expect(iBGT.connect(Bob).approve(await vault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    let trans = await vault.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT, [Bob.address, await stakingPool.getAddress()], [-swapAssetAmount, swapAssetAmount]);
    await expect(trans)
      .to.emit(piBGT, "Rebased").withArgs(swapAssetAmount)
      .to.emit(vault, "Swap").withArgs(epochId, Bob.address, swapAssetAmount, 0, swapAssetAmount, anyValue);

    // k not changed.
    let yTokenBalance = await vault.yTokenUserBalance(epochId, await vault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT.decimals())}`);  // 967.372461614660721892
    console.log(`k0: ${await vault.epochNextSwapK0(epochId)}`);

    // 1 day later, Bob swaps another 100 $iBGT for yTokens
    console.log("\n========= Bob Swaps 100 $iBGT for YTokens ===============");
    await time.increaseTo(genesisTime + 3600 * 10);
    swapAssetAmount = ethers.parseUnits("100", await iBGT.decimals());
    expectedYTokenAmount = await expectedCalcSwap(vault, 100);  //
    actualYTokenAmount = await vault.calcSwapResult(swapAssetAmount);
    expectBigNumberEquals(parseUnits(expectedYTokenAmount+"", 18), actualYTokenAmount);




  });

});
