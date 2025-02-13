import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { 
  deployContractsFixture, ONE_DAY_IN_SECS, expectNumberEquals, expectBigNumberEquals, makeToken,
  expectedY, expectedInitSwapParams, expectedCalcSwap
} from './utils';
import { 
  RedeemPool__factory, PToken__factory,
  StakingBribesPool, StakingBribesPool__factory,
  AdhocBribesPool, AdhocBribesPool__factory
} from "../typechain";
import { formatUnits, parseUnits } from 'ethers';

const { provider } = ethers;

const BigNumber = require('bignumber.js');

describe('Infrared Bribe Vault', () => {

  it('Bribe Vault basic E2E works', async () => {
    const { protocol, settings, vault, stakingPool, iBGT, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const piBGT = PToken__factory.connect(await vault.pToken(), ethers.provider);

    await settings.connect(Alice).updateVaultParamValue(await vault.getAddress(), ethers.encodeBytes32String("D"), ONE_DAY_IN_SECS * 15); // 15 days
    await settings.connect(Alice).updateVaultParamValue(await vault.getAddress(), ethers.encodeBytes32String("f1"), 10 ** 9); // 10%
    await settings.connect(Alice).updateVaultParamValue(await vault.getAddress(), ethers.encodeBytes32String("f2"), 10 ** 9); // 10%

    await expect(iBGT.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(iBGT.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(iBGT.connect(Alice).mint(Caro.address, ethers.parseUnits("1000000", await iBGT.decimals()))).not.to.be.reverted;

    // PToken's decimals should be same to the underlying token
    expect(await piBGT.decimals()).to.equal(await iBGT.decimals());

    // Create some dummy bribe token
    const brbToken = await makeToken(await protocol.getAddress(), "Bribe Token", "BRB");
    await expect(brbToken.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await brbToken.decimals()))).not.to.be.reverted;
    const bribeAmountBRB = ethers.parseUnits("2000", await brbToken.decimals());

    // No epochs initially
    expect(await vault.epochIdCount()).to.equal(0);
    await expect(vault.epochIdAt(0)).to.be.reverted; // OutOfBounds
    await expect(vault.currentEpochId()).to.be.revertedWith("No epochs yet");
    await expect(vault.epochInfoById(0)).to.be.revertedWith("Invalid epoch id");

    // Could not swap before any deposits
    await expect(vault.connect(Alice).swap(100)).to.be.revertedWith("No principal tokens");

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
    // 3 days later, Alice 'swap' 100 $iBGT for yiBGT. => $piBGT is rebased by 100/1500
    await time.increaseTo(genesisTime! + ONE_DAY_IN_SECS * 3);

    let aliceSwapAmount = ethers.parseUnits("100", await iBGT.decimals());
    let aliceExpectedSwapResult = await expectedCalcSwap(vault, 100, Number(await iBGT.decimals()));  // 1463.1851649850014
    let aliceActualSwapResult = await vault.calcSwap(aliceSwapAmount);
    expectBigNumberEquals(parseUnits(aliceExpectedSwapResult.X_updated + "", await iBGT.decimals()), aliceActualSwapResult[0]);
    expectBigNumberEquals(parseUnits(aliceExpectedSwapResult.m + "", await iBGT.decimals()), aliceActualSwapResult[1]);

    let fees = aliceSwapAmount * 10n / 100n;
    let netSwapAmount = aliceSwapAmount - fees;
    await expect(iBGT.connect(Alice).approve(await vault.getAddress(), aliceSwapAmount)).not.to.be.reverted;
    trans = await vault.connect(Alice).swap(aliceSwapAmount);
    let aliceYTSwapTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    let aliceYTSwapAmount1 = await vault.yTokenUserBalance(currentEpochId, Alice.address);
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address, await settings.treasury(), await stakingPool.getAddress()],
      [-aliceSwapAmount, fees, netSwapAmount]
    );
    await expect(trans)
      .to.emit(piBGT, "Rebased").withArgs(netSwapAmount)
      .to.emit(vault, "Swap").withArgs(currentEpochId, Alice.address, aliceSwapAmount, fees, netSwapAmount, anyValue);
    
    // Add bribes
    const bribeAmountIBGT = ethers.parseUnits("1000", await iBGT.decimals());
    await expect(iBGT.connect(Alice).approve(await stakingPool.getAddress(), bribeAmountIBGT)).not.to.be.reverted;
    await expect(brbToken.connect(Alice).approve(await stakingPool.getAddress(), bribeAmountBRB)).not.to.be.reverted;
    await expect(stakingPool.connect(Alice).addReward(await iBGT.getAddress(), Alice.address, 10 * ONE_DAY_IN_SECS)).not.to.be.reverted;
    await expect(stakingPool.connect(Alice).addReward(await brbToken.getAddress(), Alice.address, 10 * ONE_DAY_IN_SECS)).not.to.be.reverted;
    await expect(stakingPool.connect(Alice).notifyRewardAmount(await iBGT.getAddress(), bribeAmountIBGT)).not.to.be.reverted;
    await expect(stakingPool.connect(Alice).notifyRewardAmount(await brbToken.getAddress(), bribeAmountBRB)).not.to.be.reverted;

    // Another 11 days later, all staking bribes are distributed
    await time.increase(ONE_DAY_IN_SECS * 11);

    // Bob swap 10 $iBGT for yTokens, which triggers bribes claimed
    console.log("\n========= Another 11 days later, Bob swaps 10 $iBGT for YTokens ===============");
    let swapAssetAmount = ethers.parseUnits("10", await iBGT.decimals());
    let swapResult = await expectedCalcSwap(vault, 10, Number(await iBGT.decimals())); 
    let actualResult = await vault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await iBGT.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await iBGT.decimals()), actualResult[1]);
    await expect(iBGT.connect(Bob).approve(await vault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await vault.connect(Bob).swap(swapAssetAmount);
    let bobYTSwapTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    let bobYTSwapAmount1 = await vault.yTokenUserBalance(currentEpochId, Bob.address);
    await expect(trans).to.changeTokenBalances(iBGT, [Bob.address], [-swapAssetAmount]);

    // 16 days later, epoch ends. And all staking bribes are distributed
    console.log("\n========= 16 days later, check bribes ===============");
    await time.increaseTo(genesisTime! + ONE_DAY_IN_SECS * 16);

    let vaultBribesIBGTAmount = bribeAmountIBGT;
    let vaultBribesBRBAmount = bribeAmountBRB;

    // Check YT balances
    const aliceYTokenBalance = await vault.yTokenUserBalance(currentEpochId, Alice.address);
    const bobYTokenBalance = await vault.yTokenUserBalance(currentEpochId, Bob.address);
    const vaultYTokenBalance = await vault.yTokenUserBalance(currentEpochId, await vault.getAddress());
    const totalYTokenBalance = await vault.yTokenTotalSupply(currentEpochId);
    console.log(
      ethers.formatUnits(aliceYTokenBalance), ethers.formatUnits(bobYTokenBalance),
      ethers.formatUnits(vaultYTokenBalance), ethers.formatUnits(totalYTokenBalance)
    );
    expectBigNumberEquals(aliceYTokenBalance + bobYTokenBalance + vaultYTokenBalance, totalYTokenBalance);

    const expectedAliceBribesIBGT = vaultBribesIBGTAmount * aliceYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);
    const expectedBobBribesIBGT = vaultBribesIBGTAmount * bobYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);

    const expectedAliceBribesBRB = vaultBribesBRBAmount * aliceYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);
    const expectedBobBribesBRB = vaultBribesBRBAmount * bobYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);

    let epochInfo = await vault.epochInfoById(currentEpochId);
    let stakingBribesPool = StakingBribesPool__factory.connect(epochInfo.stakingBribesPool, ethers.provider);
    let adhocBribesPool = AdhocBribesPool__factory.connect(epochInfo.adhocBribesPool, ethers.provider);

    expect(await stakingBribesPool.balanceOf(Alice.address)).to.equal(aliceYTokenBalance);
    expect(await stakingBribesPool.balanceOf(Bob.address)).to.equal(bobYTokenBalance);
    expect(await stakingBribesPool.totalSupply()).to.equal(aliceYTokenBalance + bobYTokenBalance);
    expectBigNumberEquals(await iBGT.balanceOf(await stakingBribesPool.getAddress()), vaultBribesIBGTAmount);

    let actualAliceBribesIBGT = await stakingBribesPool.earned(Alice.address, await iBGT.getAddress());
    let actualAliceBribesBRB = await stakingBribesPool.earned(Alice.address, await brbToken.getAddress());
    expectBigNumberEquals(actualAliceBribesIBGT, expectedAliceBribesIBGT);
    expectBigNumberEquals(await stakingBribesPool.earned(Bob.address, await iBGT.getAddress()), expectedBobBribesIBGT);
    expectBigNumberEquals(actualAliceBribesBRB, expectedAliceBribesBRB);
    expectBigNumberEquals(await stakingBribesPool.earned(Bob.address, await brbToken.getAddress()), expectedBobBribesBRB);

    console.log("\n========= Alice claimed bribes ===============");
    
    trans = await stakingBribesPool.connect(Alice).getBribes();
    await expect(trans)
      .to.emit(stakingBribesPool, 'BribesPaid').withArgs(Alice.address, await iBGT.getAddress(), actualAliceBribesIBGT)
      .to.emit(stakingBribesPool, 'BribesPaid').withArgs(Alice.address, await brbToken.getAddress(), actualAliceBribesBRB);
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address, await stakingBribesPool.getAddress()],
      [actualAliceBribesIBGT, -actualAliceBribesIBGT]
    );
    await expect(trans).to.changeTokenBalances(
      brbToken,
      [Alice.address, await stakingBribesPool.getAddress()],
      [actualAliceBribesBRB, -actualAliceBribesBRB]
    );
    expect(await stakingBribesPool.earned(Alice.address, await iBGT.getAddress())).to.equal(0);
    expect(await stakingBribesPool.earned(Alice.address, await brbToken.getAddress())).to.equal(0);

    // Alice add Bob as briber
    const brbToken2 = await makeToken(await protocol.getAddress(), "Bribe Token", "BRB2");
    await expect(brbToken2.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await brbToken2.decimals()))).not.to.be.reverted;
    let bribeAmountBRB2 = ethers.parseUnits("2000", await brbToken2.decimals());
    await expect(brbToken2.connect(Bob).approve(await vault.getAddress(), bribeAmountBRB2)).not.to.be.reverted;
    await expect(vault.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2)).to.be.revertedWith(/Not owner or briber/);

    // Bob add adhoc bribes
    console.log("\n========= Bob add $BRB2 bribes ===============");
    await expect(vault.connect(Alice).setBriber(Bob.address, true))
      .to.emit(vault, "UpdateBriber").withArgs(Bob.address, true);
    await expect(vault.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2)).to.be.revertedWith(/Cannot add bribes without YT staked/);

    // Alice & Bob connect YT to AdhocBribesPool
    let epochEndTimestamp = epochInfo.startTime + epochInfo.duration;
    trans = await adhocBribesPool.connect(Alice).collectYT();
    let aliceYTCollectTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    trans = await adhocBribesPool.connect(Bob).collectYT();
    let bobYTCollectTimestamp1 = BigInt((await trans.getBlock())!.timestamp);

    let aliceTimeWeightedYTBalance = aliceYTSwapAmount1 * (_.min([aliceYTCollectTimestamp1!, epochEndTimestamp!]) - aliceYTSwapTimestamp1);
    let bobTimeWeightedYTBalance = bobYTSwapAmount1 * (_.min([bobYTCollectTimestamp1!, epochEndTimestamp!]) - bobYTSwapTimestamp1);
    expect(await adhocBribesPool.balanceOf(Alice.address)).to.equal(aliceTimeWeightedYTBalance);
    expect(await adhocBribesPool.balanceOf(Bob.address)).to.equal(bobTimeWeightedYTBalance);
    console.log(`Time weighted YT, Alice: ${ethers.formatUnits(aliceTimeWeightedYTBalance)}, Bob: ${ethers.formatUnits(bobTimeWeightedYTBalance)}`);

    // Add adhoc bribes
    trans = await vault.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2);
    await expect(trans)
      .to.emit(adhocBribesPool, 'BribeTokenAdded').withArgs(await brbToken2.getAddress())
      .to.emit(adhocBribesPool, 'BribesAdded').withArgs(await brbToken2.getAddress(), bribeAmountBRB2);
    await expect(trans).to.changeTokenBalances(
      brbToken2,
      [Bob.address, await adhocBribesPool.getAddress()],
      [-bribeAmountBRB2, bribeAmountBRB2]
    );

    let aliceBribesBRB2 = bribeAmountBRB2 * aliceTimeWeightedYTBalance / (aliceTimeWeightedYTBalance + bobTimeWeightedYTBalance);
    let bobBribesBRB2 = bribeAmountBRB2 * bobTimeWeightedYTBalance / (aliceTimeWeightedYTBalance + bobTimeWeightedYTBalance);
    expectBigNumberEquals(await adhocBribesPool.earned(Alice.address, await brbToken2.getAddress()), aliceBribesBRB2);
    expectBigNumberEquals(await adhocBribesPool.earned(Bob.address, await brbToken2.getAddress()), bobBribesBRB2);

    // Deposit to trigger epoch end
    console.log("\n========= Alice deposit to trigger epoch end ===============");
    let redeemPoolPtBalanceBeforeSettlement = await piBGT.balanceOf(await redeemPool.getAddress());
    console.log(`Redeem Pool $piBGT balance before settlement: ${formatUnits(redeemPoolPtBalanceBeforeSettlement, await piBGT.decimals())}`);

    let aliceDepositAmount2 = ethers.parseUnits("1", await iBGT.decimals());
    await expect(iBGT.connect(Alice).approve(await vault.getAddress(), aliceDepositAmount2)).not.to.be.reverted;
    await expect(vault.connect(Alice).deposit(aliceDepositAmount2)).not.to.be.reverted;
    
    // Redeem Pool should be settled
    expect(await redeemPool.settled()).to.equal(true);
    let redeemPoolPtBalance = await piBGT.balanceOf(await redeemPool.getAddress());
    console.log(`Redeem Pool $piBGT balance after settlement: ${formatUnits(redeemPoolPtBalance, await piBGT.decimals())}`);
    
    const redeemPoolAssetBalance = await iBGT.balanceOf(await redeemPool.getAddress());
    console.log(`Redeem Pool $iBGT balance: ${formatUnits(redeemPoolAssetBalance, await iBGT.decimals())}`);
    expect(redeemPoolAssetBalance).to.equal(redeemPoolPtBalanceBeforeSettlement);

    const aliceEarnedAsset = await redeemPool.earnedAssetAmount(Alice.address);
    const expectedAliceEarnedAsset = redeemPoolAssetBalance * 2n / 3n;
    expect(aliceEarnedAsset).to.equal(expectedAliceEarnedAsset);

    fees = aliceEarnedAsset * 10n / 100n;
    let netAmount = aliceEarnedAsset - fees;
    trans = await redeemPool.connect(Alice).claimAssetToken();
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address, await settings.treasury(), await redeemPool.getAddress()],
      [netAmount, fees, -aliceEarnedAsset]
    );
    await expect(trans).to.emit(redeemPool, "AssetTokenClaimed").withArgs(Alice.address, aliceEarnedAsset, netAmount, fees);

    // Alice closes vault
    console.log("\n========= Alice closes vault ===============");
    let iBGTBalanceBeforeClose = await iBGT.balanceOf(await vault.getAddress());
    expect(iBGTBalanceBeforeClose).to.equal(0);
    console.log(`$iBGT balance before close: ${formatUnits(iBGTBalanceBeforeClose, await iBGT.decimals())}`);
    trans = await vault.connect(Alice).close();
    let closeTimestamp = BigInt((await trans.getBlock())!.timestamp);
    await expect(trans)
      .to.emit(vault, "Closed").withArgs();
    let iBGTBalanceAfterClose = await iBGT.balanceOf(await vault.getAddress());
    console.log(`$iBGT balance after close: ${formatUnits(iBGTBalanceAfterClose, await iBGT.decimals())}`);

    let alicePTokenBalance = await piBGT.balanceOf(Alice.address);
    let bobPTokenBalance = await piBGT.balanceOf(Bob.address);
    console.log(`Alice $piBGT balance: ${formatUnits(alicePTokenBalance, await piBGT.decimals())}`);
    console.log(`Bob $piBGT balance: ${formatUnits(bobPTokenBalance, await piBGT.decimals())}`);

    // Could not deposit or swap after vault is closed
    await expect(vault.connect(Alice).deposit(100)).to.be.reverted;
    await expect(vault.connect(Alice).swap(100)).to.be.reverted;

    epochInfo = await vault.epochInfoById(await vault.currentEpochId());
    expect(epochInfo.duration).to.equal(closeTimestamp - epochInfo.startTime);

    // Alice and Bob get their $iBGT back
    console.log("\n========= Alice and Bob get their $iBGT back ===============");
    await expect(vault.connect(Alice).redeem(alicePTokenBalance * 2n)).to.be.reverted;
    trans = await vault.connect(Alice).redeem(alicePTokenBalance);
    // await expect(trans).to.changeTokenBalances(
    //   piBGT,
    //   [Alice.address],
    //   [-alicePTokenBalance]
    // );
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address],
      [alicePTokenBalance]
    );
    await expect(trans)
      .to.emit(vault, "Redeem").withArgs(Alice.address, alicePTokenBalance, anyValue);
  });

  it('Bribe Vault with assets with 8 decimals basic E2E works', async () => {
    const { protocol, settings, vault8, stakingPool8, iBGT8, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const piBGT = PToken__factory.connect(await vault8.pToken(), ethers.provider);

    await settings.connect(Alice).updateVaultParamValue(await vault8.getAddress(), ethers.encodeBytes32String("D"), ONE_DAY_IN_SECS * 15); // 15 days
    await settings.connect(Alice).updateVaultParamValue(await vault8.getAddress(), ethers.encodeBytes32String("f1"), 10 ** 9); // 10%
    await settings.connect(Alice).updateVaultParamValue(await vault8.getAddress(), ethers.encodeBytes32String("f2"), 10 ** 9); // 10%

    await expect(iBGT8.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await iBGT8.decimals()))).not.to.be.reverted;
    await expect(iBGT8.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await iBGT8.decimals()))).not.to.be.reverted;
    await expect(iBGT8.connect(Alice).mint(Caro.address, ethers.parseUnits("1000000", await iBGT8.decimals()))).not.to.be.reverted;

    // PToken's decimals should be same to the underlying token
    expect(await piBGT.decimals()).to.equal(await iBGT8.decimals());

    // Create some dummy bribe token
    const brbToken8 = await makeToken(await protocol.getAddress(), "Bribe Token", "BRB", 8);
    await expect(brbToken8.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await brbToken8.decimals()))).not.to.be.reverted;
    const bribeAmountBRB = ethers.parseUnits("2000", await brbToken8.decimals());

    // No epochs initially
    expect(await vault8.epochIdCount()).to.equal(0);
    await expect(vault8.epochIdAt(0)).to.be.reverted; // OutOfBounds
    await expect(vault8.currentEpochId()).to.be.revertedWith("No epochs yet");
    await expect(vault8.epochInfoById(0)).to.be.revertedWith("Invalid epoch id");

    // Could not swap before any deposits
    await expect(vault8.connect(Alice).swap(100)).to.be.revertedWith("No principal tokens");

    // First deposit automaticaly starts a new epoch.
    // Alice deposits 1000 $iBGT, Bob deposits 500 $iBGT
    let aliceDepositAmount = ethers.parseUnits("1000", await iBGT8.decimals());
    await expect(iBGT8.connect(Alice).approve(await vault8.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    let trans = await vault8.connect(Alice).deposit(aliceDepositAmount);
    let currentEpochId = 1;
    await expect(trans).to.changeTokenBalances(
      iBGT8,
      [Alice.address, await stakingPool8.getAddress()],
      [-aliceDepositAmount, aliceDepositAmount]
    );
    await expect(trans)
      .to.emit(vault8, "PTokenMinted").withArgs(Alice.address, aliceDepositAmount, aliceDepositAmount, anyValue)
      .to.emit(vault8, "YTokenDummyMinted").withArgs(currentEpochId, await vault8.getAddress(), aliceDepositAmount, aliceDepositAmount)
      .to.emit(vault8, "Deposit").withArgs(currentEpochId, Alice.address, aliceDepositAmount, aliceDepositAmount, aliceDepositAmount);

    let bobDepositAmount = ethers.parseUnits("500", await iBGT8.decimals());
    await expect(iBGT8.connect(Bob).approve(await vault8.getAddress(), bobDepositAmount)).not.to.be.reverted;
    await expect(vault8.connect(Bob).deposit(bobDepositAmount)).not.to.be.reverted;

    // check epoch
    let currentEpochDuration = ONE_DAY_IN_SECS * 15;  // default to 15 days
    let currentEpochStartTime = (await provider.getBlock(trans.blockHash!))?.timestamp;
    const genesisTime = currentEpochStartTime;
    expect(await vault8.epochIdCount()).to.equal(1);
    expect(await vault8.epochIdAt(0)).to.equal(currentEpochId);
    expect(await vault8.currentEpochId()).to.equal(currentEpochId);
    let currentEpoch = await vault8.epochInfoById(currentEpochId);
    expect(currentEpoch.startTime).to.equal(currentEpochStartTime);
    expect(currentEpoch.duration).to.equal(currentEpochDuration);

    // check pToken and yToken balance
    expect(await vault8.assetBalance()).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await piBGT.balanceOf(Alice.address)).to.equal(aliceDepositAmount);
    expect(await piBGT.balanceOf(Bob.address)).to.equal(bobDepositAmount);
    expect(await piBGT.totalSupply()).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await vault8.yTokenUserBalance(currentEpochId, Alice.address)).to.equal(0);
    expect(await vault8.yTokenUserBalance(currentEpochId, Bob.address)).to.equal(0);
    expect(await vault8.yTokenUserBalance(currentEpochId, await vault8.getAddress())).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await vault8.yTokenTotalSupply(currentEpochId)).to.equal(aliceDepositAmount + bobDepositAmount);
    
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
    // 3 days later, Alice 'swap' 100 $iBGT for yiBGT. => $piBGT is rebased by 100/1500
    await time.increaseTo(genesisTime! + ONE_DAY_IN_SECS * 3);

    let aliceSwapAmount = ethers.parseUnits("100", await iBGT8.decimals());
    let aliceExpectedSwapResult = await expectedCalcSwap(vault8, 100, Number(await iBGT8.decimals()));  // 1463.1851649850014
    let aliceActualSwapResult = await vault8.calcSwap(aliceSwapAmount);
    expectBigNumberEquals(parseUnits(aliceExpectedSwapResult.X_updated.toFixed(Number(await iBGT8.decimals())), await iBGT8.decimals()), aliceActualSwapResult[0]);
    expectBigNumberEquals(parseUnits(aliceExpectedSwapResult.m.toFixed(Number(await iBGT8.decimals())), await iBGT8.decimals()), aliceActualSwapResult[1]);

    let fees = aliceSwapAmount * 10n / 100n;
    let netSwapAmount = aliceSwapAmount - fees;
    await expect(iBGT8.connect(Alice).approve(await vault8.getAddress(), aliceSwapAmount)).not.to.be.reverted;
    trans = await vault8.connect(Alice).swap(aliceSwapAmount);
    let aliceYTSwapTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    let aliceYTSwapAmount1 = await vault8.yTokenUserBalance(currentEpochId, Alice.address);
    await expect(trans).to.changeTokenBalances(
      iBGT8,
      [Alice.address, await settings.treasury(), await stakingPool8.getAddress()],
      [-aliceSwapAmount, fees, netSwapAmount]
    );
    await expect(trans)
      .to.emit(piBGT, "Rebased").withArgs(netSwapAmount)
      .to.emit(vault8, "Swap").withArgs(currentEpochId, Alice.address, aliceSwapAmount, fees, netSwapAmount, anyValue);
    
    // Add bribes
    const bribeAmountIBGT = ethers.parseUnits("1000", await iBGT8.decimals());
    await expect(iBGT8.connect(Alice).approve(await stakingPool8.getAddress(), bribeAmountIBGT)).not.to.be.reverted;
    await expect(brbToken8.connect(Alice).approve(await stakingPool8.getAddress(), bribeAmountBRB)).not.to.be.reverted;
    await expect(stakingPool8.connect(Alice).addReward(await iBGT8.getAddress(), Alice.address, 10 * ONE_DAY_IN_SECS)).not.to.be.reverted;
    await expect(stakingPool8.connect(Alice).addReward(await brbToken8.getAddress(), Alice.address, 10 * ONE_DAY_IN_SECS)).not.to.be.reverted;
    await expect(stakingPool8.connect(Alice).notifyRewardAmount(await iBGT8.getAddress(), bribeAmountIBGT)).not.to.be.reverted;
    await expect(stakingPool8.connect(Alice).notifyRewardAmount(await brbToken8.getAddress(), bribeAmountBRB)).not.to.be.reverted;

    // Another 11 days later, all staking bribes are distributed
    await time.increase(ONE_DAY_IN_SECS * 11);

    // Bob swap 10 $iBGT for yTokens, which triggers bribes claimed
    console.log("\n========= Another 11 days later, Bob swaps 10 $iBGT for YTokens ===============");
    let swapAssetAmount = ethers.parseUnits("10", await iBGT8.decimals());
    let swapResult = await expectedCalcSwap(vault8, 10, Number(await iBGT8.decimals())); 
    let actualResult = await vault8.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated.toFixed(Number(await iBGT8.decimals())), await iBGT8.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m.toFixed(Number(await iBGT8.decimals())), await iBGT8.decimals()), actualResult[1]);
    await expect(iBGT8.connect(Bob).approve(await vault8.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await vault8.connect(Bob).swap(swapAssetAmount);
    let bobYTSwapTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    let bobYTSwapAmount1 = await vault8.yTokenUserBalance(currentEpochId, Bob.address);
    await expect(trans).to.changeTokenBalances(iBGT8, [Bob.address], [-swapAssetAmount]);

    // 16 days later, epoch ends. And all staking bribes are distributed
    console.log("\n========= 16 days later, check bribes ===============");
    await time.increaseTo(genesisTime! + ONE_DAY_IN_SECS * 16);

    let vaultBribesIBGTAmount = bribeAmountIBGT;
    let vaultBribesBRBAmount = bribeAmountBRB;

    // Check YT balances
    const aliceYTokenBalance = await vault8.yTokenUserBalance(currentEpochId, Alice.address);
    const bobYTokenBalance = await vault8.yTokenUserBalance(currentEpochId, Bob.address);
    const vaultYTokenBalance = await vault8.yTokenUserBalance(currentEpochId, await vault8.getAddress());
    const totalYTokenBalance = await vault8.yTokenTotalSupply(currentEpochId);
    console.log(
      ethers.formatUnits(aliceYTokenBalance), ethers.formatUnits(bobYTokenBalance),
      ethers.formatUnits(vaultYTokenBalance), ethers.formatUnits(totalYTokenBalance)
    );
    expectBigNumberEquals(aliceYTokenBalance + bobYTokenBalance + vaultYTokenBalance, totalYTokenBalance);

    const expectedAliceBribesIBGT = vaultBribesIBGTAmount * aliceYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);
    const expectedBobBribesIBGT = vaultBribesIBGTAmount * bobYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);

    const expectedAliceBribesBRB = vaultBribesBRBAmount * aliceYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);
    const expectedBobBribesBRB = vaultBribesBRBAmount * bobYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);

    let epochInfo = await vault8.epochInfoById(currentEpochId);
    let stakingBribesPool = StakingBribesPool__factory.connect(epochInfo.stakingBribesPool, ethers.provider);
    let adhocBribesPool = AdhocBribesPool__factory.connect(epochInfo.adhocBribesPool, ethers.provider);

    expect(await stakingBribesPool.balanceOf(Alice.address)).to.equal(aliceYTokenBalance);
    expect(await stakingBribesPool.balanceOf(Bob.address)).to.equal(bobYTokenBalance);
    expect(await stakingBribesPool.totalSupply()).to.equal(aliceYTokenBalance + bobYTokenBalance);
    expectBigNumberEquals(await iBGT8.balanceOf(await stakingBribesPool.getAddress()), vaultBribesIBGTAmount);

    let actualAliceBribesIBGT = await stakingBribesPool.earned(Alice.address, await iBGT8.getAddress());
    let actualAliceBribesBRB = await stakingBribesPool.earned(Alice.address, await brbToken8.getAddress());
    expectBigNumberEquals(actualAliceBribesIBGT, expectedAliceBribesIBGT);
    expectBigNumberEquals(await stakingBribesPool.earned(Bob.address, await iBGT8.getAddress()), expectedBobBribesIBGT);
    expectBigNumberEquals(actualAliceBribesBRB, expectedAliceBribesBRB);
    expectBigNumberEquals(await stakingBribesPool.earned(Bob.address, await brbToken8.getAddress()), expectedBobBribesBRB);

    console.log("\n========= Alice claimed bribes ===============");
    trans = await stakingBribesPool.connect(Alice).getBribes();
    await expect(trans)
      .to.emit(stakingBribesPool, 'BribesPaid').withArgs(Alice.address, await iBGT8.getAddress(), actualAliceBribesIBGT)
      .to.emit(stakingBribesPool, 'BribesPaid').withArgs(Alice.address, await brbToken8.getAddress(), actualAliceBribesBRB);

    await expect(trans).to.changeTokenBalances(
      iBGT8,
      [Alice.address, await stakingBribesPool.getAddress()],
      [actualAliceBribesIBGT, -actualAliceBribesIBGT]
    );
    await expect(trans).to.changeTokenBalances(
      brbToken8,
      [Alice.address, await stakingBribesPool.getAddress()],
      [actualAliceBribesBRB, -actualAliceBribesBRB]
    );

    expect(await stakingBribesPool.earned(Alice.address, await iBGT8.getAddress())).to.equal(0);
    expect(await stakingBribesPool.earned(Alice.address, await brbToken8.getAddress())).to.equal(0);

    // Alice add Bob as briber
    const brbToken2 = await makeToken(await protocol.getAddress(), "Bribe Token", "BRB2");
    await expect(brbToken2.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await brbToken2.decimals()))).not.to.be.reverted;
    let bribeAmountBRB2 = ethers.parseUnits("2000", await brbToken2.decimals());
    await expect(brbToken2.connect(Bob).approve(await vault8.getAddress(), bribeAmountBRB2)).not.to.be.reverted;
    await expect(vault8.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2)).to.be.revertedWith(/Not owner or briber/);

    // Bob add adhoc bribes
    console.log("\n========= Bob add $BRB2 bribes ===============");
    await expect(vault8.connect(Alice).setBriber(Bob.address, true))
      .to.emit(vault8, "UpdateBriber").withArgs(Bob.address, true);

    await expect(vault8.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2)).to.be.revertedWith(/Cannot add bribes without YT staked/);

    // Alice & Bob connect YT to AdhocBribesPool
    let epochEndTimestamp = epochInfo.startTime + epochInfo.duration;
    trans = await adhocBribesPool.connect(Alice).collectYT();
    let aliceYTCollectTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    trans = await adhocBribesPool.connect(Bob).collectYT();
    let bobYTCollectTimestamp1 = BigInt((await trans.getBlock())!.timestamp);

    let aliceTimeWeightedYTBalance = aliceYTSwapAmount1 * (_.min([aliceYTCollectTimestamp1!, epochEndTimestamp!]) - aliceYTSwapTimestamp1);
    let bobTimeWeightedYTBalance = bobYTSwapAmount1 * (_.min([bobYTCollectTimestamp1!, epochEndTimestamp!]) - bobYTSwapTimestamp1);
    expect(await adhocBribesPool.balanceOf(Alice.address)).to.equal(aliceTimeWeightedYTBalance);
    expect(await adhocBribesPool.balanceOf(Bob.address)).to.equal(bobTimeWeightedYTBalance);
    console.log(`Time weighted YT, Alice: ${ethers.formatUnits(aliceTimeWeightedYTBalance)}, Bob: ${ethers.formatUnits(bobTimeWeightedYTBalance)}`);

    // Add adhoc bribes
    trans = await vault8.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2);
    await expect(trans)
      .to.emit(adhocBribesPool, 'BribeTokenAdded').withArgs(await brbToken2.getAddress())
      .to.emit(adhocBribesPool, 'BribesAdded').withArgs(await brbToken2.getAddress(), bribeAmountBRB2);
    await expect(trans).to.changeTokenBalances(
      brbToken2,
      [Bob.address, await adhocBribesPool.getAddress()],
      [-bribeAmountBRB2, bribeAmountBRB2]
    );

    let aliceBribesBRB2 = bribeAmountBRB2 * aliceTimeWeightedYTBalance / (aliceTimeWeightedYTBalance + bobTimeWeightedYTBalance);
    let bobBribesBRB2 = bribeAmountBRB2 * bobTimeWeightedYTBalance / (aliceTimeWeightedYTBalance + bobTimeWeightedYTBalance);
    expectBigNumberEquals(await adhocBribesPool.earned(Alice.address, await brbToken2.getAddress()), aliceBribesBRB2);
    expectBigNumberEquals(await adhocBribesPool.earned(Bob.address, await brbToken2.getAddress()), bobBribesBRB2);

    // Alice closes vault
    console.log("\n========= Alice closes vault ===============");
    let iBGTBalanceBeforeClose = await iBGT8.balanceOf(await vault8.getAddress());
    expect(iBGTBalanceBeforeClose).to.equal(0);
    console.log(`$iBGT balance before close: ${formatUnits(iBGTBalanceBeforeClose, await iBGT8.decimals())}`);
    await expect(vault8.connect(Alice).close())
      .to.emit(vault8, "Closed").withArgs();
    let iBGTBalanceAfterClose = await iBGT8.balanceOf(await vault8.getAddress());
    console.log(`$iBGT balance after close: ${formatUnits(iBGTBalanceAfterClose, await iBGT8.decimals())}`);

    let alicePTokenBalance = await piBGT.balanceOf(Alice.address);
    let bobPTokenBalance = await piBGT.balanceOf(Bob.address);
    console.log(`Alice $piBGT balance: ${formatUnits(alicePTokenBalance, await piBGT.decimals())}`);
    console.log(`Bob $piBGT balance: ${formatUnits(bobPTokenBalance, await piBGT.decimals())}`);

    // Could not deposit or swap after vault is closed
    await expect(vault8.connect(Alice).deposit(100)).to.be.reverted;
    await expect(vault8.connect(Alice).swap(100)).to.be.reverted;

    // Alice and Bob get their $iBGT back
    console.log("\n========= Alice and Bob get their $iBGT back ===============");
    await expect(vault8.connect(Alice).redeem(alicePTokenBalance * 2n)).to.be.reverted;
    trans = await vault8.connect(Alice).redeem(alicePTokenBalance);
    await expect(trans).to.changeTokenBalances(
      piBGT,
      [Alice.address],
      [-alicePTokenBalance]
    );
    await expect(trans).to.changeTokenBalances(
      iBGT8,
      [Alice.address],
      [alicePTokenBalance]
    );
    await expect(trans)
      .to.emit(vault8, "Redeem").withArgs(Alice.address, alicePTokenBalance, anyValue);
  });

  it('Bribe Vault with assets with 28 decimals basic E2E works', async () => {
    const { protocol, settings, vault28, stakingPool28, iBGT28, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const piBGT = PToken__factory.connect(await vault28.pToken(), ethers.provider);

    await settings.connect(Alice).updateVaultParamValue(await vault28.getAddress(), ethers.encodeBytes32String("D"), ONE_DAY_IN_SECS * 15); // 15 days
    await settings.connect(Alice).updateVaultParamValue(await vault28.getAddress(), ethers.encodeBytes32String("f1"), 10 ** 9); // 10%
    await settings.connect(Alice).updateVaultParamValue(await vault28.getAddress(), ethers.encodeBytes32String("f2"), 10 ** 9); // 10%

    await expect(iBGT28.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await iBGT28.decimals()))).not.to.be.reverted;
    await expect(iBGT28.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await iBGT28.decimals()))).not.to.be.reverted;
    await expect(iBGT28.connect(Alice).mint(Caro.address, ethers.parseUnits("1000000", await iBGT28.decimals()))).not.to.be.reverted;

    // PToken's decimals should be same to the underlying token
    expect(await piBGT.decimals()).to.equal(await iBGT28.decimals());

    // Create some dummy bribe token
    const brbToken18 = await makeToken(await protocol.getAddress(), "Bribe Token", "BRB", 18);
    await expect(brbToken18.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await brbToken18.decimals()))).not.to.be.reverted;
    const bribeAmountBRB = ethers.parseUnits("2000", await brbToken18.decimals());

    // No epochs initially
    expect(await vault28.epochIdCount()).to.equal(0);
    await expect(vault28.epochIdAt(0)).to.be.reverted; // OutOfBounds
    await expect(vault28.currentEpochId()).to.be.revertedWith("No epochs yet");
    await expect(vault28.epochInfoById(0)).to.be.revertedWith("Invalid epoch id");

    // Could not swap before any deposits
    await expect(vault28.connect(Alice).swap(100)).to.be.revertedWith("No principal tokens");

    // First deposit automaticaly starts a new epoch.
    // Alice deposits 1000 $iBGT, Bob deposits 500 $iBGT
    let aliceDepositAmount = ethers.parseUnits("1000", await iBGT28.decimals());
    await expect(iBGT28.connect(Alice).approve(await vault28.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    let trans = await vault28.connect(Alice).deposit(aliceDepositAmount);
    let currentEpochId = 1;
    await expect(trans).to.changeTokenBalances(
      iBGT28,
      [Alice.address, await stakingPool28.getAddress()],
      [-aliceDepositAmount, aliceDepositAmount]
    );
    await expect(trans)
      .to.emit(vault28, "PTokenMinted").withArgs(Alice.address, aliceDepositAmount, aliceDepositAmount, anyValue)
      .to.emit(vault28, "YTokenDummyMinted").withArgs(currentEpochId, await vault28.getAddress(), aliceDepositAmount, aliceDepositAmount)
      .to.emit(vault28, "Deposit").withArgs(currentEpochId, Alice.address, aliceDepositAmount, aliceDepositAmount, aliceDepositAmount);

    let bobDepositAmount = ethers.parseUnits("500", await iBGT28.decimals());
    await expect(iBGT28.connect(Bob).approve(await vault28.getAddress(), bobDepositAmount)).not.to.be.reverted;
    await expect(vault28.connect(Bob).deposit(bobDepositAmount)).not.to.be.reverted;

    // check epoch
    let currentEpochDuration = ONE_DAY_IN_SECS * 15;  // default to 15 days
    let currentEpochStartTime = (await provider.getBlock(trans.blockHash!))?.timestamp;
    const genesisTime = currentEpochStartTime;
    expect(await vault28.epochIdCount()).to.equal(1);
    expect(await vault28.epochIdAt(0)).to.equal(currentEpochId);
    expect(await vault28.currentEpochId()).to.equal(currentEpochId);
    let currentEpoch = await vault28.epochInfoById(currentEpochId);
    expect(currentEpoch.startTime).to.equal(currentEpochStartTime);
    expect(currentEpoch.duration).to.equal(currentEpochDuration);

    // check pToken and yToken balance
    expect(await vault28.assetBalance()).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await piBGT.balanceOf(Alice.address)).to.equal(aliceDepositAmount);
    expect(await piBGT.balanceOf(Bob.address)).to.equal(bobDepositAmount);
    expect(await piBGT.totalSupply()).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await vault28.yTokenUserBalance(currentEpochId, Alice.address)).to.equal(0);
    expect(await vault28.yTokenUserBalance(currentEpochId, Bob.address)).to.equal(0);
    expect(await vault28.yTokenUserBalance(currentEpochId, await vault28.getAddress())).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await vault28.yTokenTotalSupply(currentEpochId)).to.equal(aliceDepositAmount + bobDepositAmount);
    
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
    // 3 days later, Alice 'swap' 100 $iBGT for yiBGT. => $piBGT is rebased by 100/1500
    await time.increaseTo(genesisTime! + ONE_DAY_IN_SECS * 3);

    let aliceSwapAmount = ethers.parseUnits("100", await iBGT28.decimals());
    let aliceExpectedSwapResult = await expectedCalcSwap(vault28, 100, Number(await iBGT28.decimals()));  // 1463.1851649850014
    let aliceActualSwapResult = await vault28.calcSwap(aliceSwapAmount);
    expectBigNumberEquals(parseUnits(aliceExpectedSwapResult.X_updated.toFixed(Number(await iBGT28.decimals())), await iBGT28.decimals()), aliceActualSwapResult[0]);
    expectBigNumberEquals(parseUnits(aliceExpectedSwapResult.m.toFixed(Number(await iBGT28.decimals())), await iBGT28.decimals()), aliceActualSwapResult[1]);

    let fees = aliceSwapAmount * 10n / 100n;
    let netSwapAmount = aliceSwapAmount - fees;
    await expect(iBGT28.connect(Alice).approve(await vault28.getAddress(), aliceSwapAmount)).not.to.be.reverted;
    trans = await vault28.connect(Alice).swap(aliceSwapAmount);
    let aliceYTSwapTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    let aliceYTSwapAmount1 = await vault28.yTokenUserBalance(currentEpochId, Alice.address);
    await expect(trans).to.changeTokenBalances(
      iBGT28,
      [Alice.address, await settings.treasury(), await stakingPool28.getAddress()],
      [-aliceSwapAmount, fees, netSwapAmount]
    );
    await expect(trans)
      .to.emit(piBGT, "Rebased").withArgs(netSwapAmount)
      .to.emit(vault28, "Swap").withArgs(currentEpochId, Alice.address, aliceSwapAmount, fees, netSwapAmount, anyValue);
    
    // Add bribes
    const bribeAmountIBGT = ethers.parseUnits("1000", await iBGT28.decimals());
    await expect(iBGT28.connect(Alice).approve(await stakingPool28.getAddress(), bribeAmountIBGT)).not.to.be.reverted;
    await expect(brbToken18.connect(Alice).approve(await stakingPool28.getAddress(), bribeAmountBRB)).not.to.be.reverted;
    await expect(stakingPool28.connect(Alice).addReward(await iBGT28.getAddress(), Alice.address, 10 * ONE_DAY_IN_SECS)).not.to.be.reverted;
    await expect(stakingPool28.connect(Alice).addReward(await brbToken18.getAddress(), Alice.address, 10 * ONE_DAY_IN_SECS)).not.to.be.reverted;
    await expect(stakingPool28.connect(Alice).notifyRewardAmount(await iBGT28.getAddress(), bribeAmountIBGT)).not.to.be.reverted;
    await expect(stakingPool28.connect(Alice).notifyRewardAmount(await brbToken18.getAddress(), bribeAmountBRB)).not.to.be.reverted;

    // Another 11 days later, all staking bribes are distributed
    await time.increase(ONE_DAY_IN_SECS * 11);

    // Bob swap 10 $iBGT for yTokens, which triggers bribes claimed
    console.log("\n========= Another 11 days later, Bob swaps 10 $iBGT for YTokens ===============");
    let swapAssetAmount = ethers.parseUnits("10", await iBGT28.decimals());
    let swapResult = await expectedCalcSwap(vault28, 10, Number(await iBGT28.decimals())); 
    let actualResult = await vault28.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated.toFixed(Number(await iBGT28.decimals())), await iBGT28.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m.toFixed(Number(await iBGT28.decimals())), await iBGT28.decimals()), actualResult[1]);
    await expect(iBGT28.connect(Bob).approve(await vault28.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await vault28.connect(Bob).swap(swapAssetAmount);
    let bobYTSwapTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    let bobYTSwapAmount1 = await vault28.yTokenUserBalance(currentEpochId, Bob.address);
    await expect(trans).to.changeTokenBalances(iBGT28, [Bob.address], [-swapAssetAmount]);

    // 16 days later, epoch ends. And all staking bribes are distributed
    console.log("\n========= 16 days later, check bribes ===============");
    await time.increaseTo(genesisTime! + ONE_DAY_IN_SECS * 16);

    let vaultBribesIBGTAmount = bribeAmountIBGT;
    let vaultBribesBRBAmount = bribeAmountBRB;

    // Check YT balances
    const aliceYTokenBalance = await vault28.yTokenUserBalance(currentEpochId, Alice.address);
    const bobYTokenBalance = await vault28.yTokenUserBalance(currentEpochId, Bob.address);
    const vaultYTokenBalance = await vault28.yTokenUserBalance(currentEpochId, await vault28.getAddress());
    const totalYTokenBalance = await vault28.yTokenTotalSupply(currentEpochId);
    console.log(
      ethers.formatUnits(aliceYTokenBalance), ethers.formatUnits(bobYTokenBalance),
      ethers.formatUnits(vaultYTokenBalance), ethers.formatUnits(totalYTokenBalance)
    );
    expectBigNumberEquals(aliceYTokenBalance + bobYTokenBalance + vaultYTokenBalance, totalYTokenBalance);

    const expectedAliceBribesIBGT = vaultBribesIBGTAmount * aliceYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);
    const expectedBobBribesIBGT = vaultBribesIBGTAmount * bobYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);

    const expectedAliceBribesBRB = vaultBribesBRBAmount * aliceYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);
    const expectedBobBribesBRB = vaultBribesBRBAmount * bobYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);

    let epochInfo = await vault28.epochInfoById(currentEpochId);
    let stakingBribesPool = StakingBribesPool__factory.connect(epochInfo.stakingBribesPool, ethers.provider);
    let adhocBribesPool = AdhocBribesPool__factory.connect(epochInfo.adhocBribesPool, ethers.provider);

    expect(await stakingBribesPool.balanceOf(Alice.address)).to.equal(aliceYTokenBalance);
    expect(await stakingBribesPool.balanceOf(Bob.address)).to.equal(bobYTokenBalance);
    expect(await stakingBribesPool.totalSupply()).to.equal(aliceYTokenBalance + bobYTokenBalance);
    expectBigNumberEquals(await iBGT28.balanceOf(await stakingBribesPool.getAddress()), vaultBribesIBGTAmount);

    let actualAliceBribesIBGT = await stakingBribesPool.earned(Alice.address, await iBGT28.getAddress());
    let actualAliceBribesBRB = await stakingBribesPool.earned(Alice.address, await brbToken18.getAddress());
    expectBigNumberEquals(actualAliceBribesIBGT, expectedAliceBribesIBGT);
    expectBigNumberEquals(await stakingBribesPool.earned(Bob.address, await iBGT28.getAddress()), expectedBobBribesIBGT);
    expectBigNumberEquals(actualAliceBribesBRB, expectedAliceBribesBRB);
    expectBigNumberEquals(await stakingBribesPool.earned(Bob.address, await brbToken18.getAddress()), expectedBobBribesBRB);

    console.log("\n========= Alice claimed bribes ===============");
    trans = await stakingBribesPool.connect(Alice).getBribes();
    await expect(trans)
      .to.emit(stakingBribesPool, 'BribesPaid').withArgs(Alice.address, await iBGT28.getAddress(), actualAliceBribesIBGT)
      .to.emit(stakingBribesPool, 'BribesPaid').withArgs(Alice.address, await brbToken18.getAddress(), actualAliceBribesBRB);

    await expect(trans).to.changeTokenBalances(
      iBGT28,
      [Alice.address, await stakingBribesPool.getAddress()],
      [actualAliceBribesIBGT, -actualAliceBribesIBGT]
    );
    await expect(trans).to.changeTokenBalances(
      brbToken18,
      [Alice.address, await stakingBribesPool.getAddress()],
      [actualAliceBribesBRB, -actualAliceBribesBRB]
    );

    expect(await stakingBribesPool.earned(Alice.address, await iBGT28.getAddress())).to.equal(0);
    expect(await stakingBribesPool.earned(Alice.address, await brbToken18.getAddress())).to.equal(0);

    // Alice add Bob as briber
    const brbToken2 = await makeToken(await protocol.getAddress(), "Bribe Token", "BRB2");
    await expect(brbToken2.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await brbToken2.decimals()))).not.to.be.reverted;
    let bribeAmountBRB2 = ethers.parseUnits("2000", await brbToken2.decimals());
    await expect(brbToken2.connect(Bob).approve(await vault28.getAddress(), bribeAmountBRB2)).not.to.be.reverted;
    await expect(vault28.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2)).to.be.revertedWith(/Not owner or briber/);

    // Bob add adhoc bribes
    console.log("\n========= Bob add $BRB2 bribes ===============");
    await expect(vault28.connect(Alice).setBriber(Bob.address, true))
      .to.emit(vault28, "UpdateBriber").withArgs(Bob.address, true);

    await expect(vault28.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2)).to.be.revertedWith(/Cannot add bribes without YT staked/);

    // Alice & Bob connect YT to AdhocBribesPool
    let epochEndTimestamp = epochInfo.startTime + epochInfo.duration;
    trans = await adhocBribesPool.connect(Alice).collectYT();
    let aliceYTCollectTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    trans = await adhocBribesPool.connect(Bob).collectYT();
    let bobYTCollectTimestamp1 = BigInt((await trans.getBlock())!.timestamp);

    let aliceTimeWeightedYTBalance = aliceYTSwapAmount1 * (_.min([aliceYTCollectTimestamp1!, epochEndTimestamp!]) - aliceYTSwapTimestamp1);
    let bobTimeWeightedYTBalance = bobYTSwapAmount1 * (_.min([bobYTCollectTimestamp1!, epochEndTimestamp!]) - bobYTSwapTimestamp1);
    expect(await adhocBribesPool.balanceOf(Alice.address)).to.equal(aliceTimeWeightedYTBalance);
    expect(await adhocBribesPool.balanceOf(Bob.address)).to.equal(bobTimeWeightedYTBalance);
    console.log(`Time weighted YT, Alice: ${ethers.formatUnits(aliceTimeWeightedYTBalance)}, Bob: ${ethers.formatUnits(bobTimeWeightedYTBalance)}`);

    // Add adhoc bribes
    trans = await vault28.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2);
    await expect(trans)
      .to.emit(adhocBribesPool, 'BribeTokenAdded').withArgs(await brbToken2.getAddress())
      .to.emit(adhocBribesPool, 'BribesAdded').withArgs(await brbToken2.getAddress(), bribeAmountBRB2);
    await expect(trans).to.changeTokenBalances(
      brbToken2,
      [Bob.address, await adhocBribesPool.getAddress()],
      [-bribeAmountBRB2, bribeAmountBRB2]
    );

    let aliceBribesBRB2 = bribeAmountBRB2 * aliceTimeWeightedYTBalance / (aliceTimeWeightedYTBalance + bobTimeWeightedYTBalance);
    let bobBribesBRB2 = bribeAmountBRB2 * bobTimeWeightedYTBalance / (aliceTimeWeightedYTBalance + bobTimeWeightedYTBalance);
    expectBigNumberEquals(await adhocBribesPool.earned(Alice.address, await brbToken2.getAddress()), aliceBribesBRB2);
    expectBigNumberEquals(await adhocBribesPool.earned(Bob.address, await brbToken2.getAddress()), bobBribesBRB2);

    // Alice closes vault
    console.log("\n========= Alice closes vault ===============");
    let iBGTBalanceBeforeClose = await iBGT28.balanceOf(await vault28.getAddress());
    expect(iBGTBalanceBeforeClose).to.equal(0);
    console.log(`$iBGT balance before close: ${formatUnits(iBGTBalanceBeforeClose, await iBGT28.decimals())}`);
    await expect(vault28.connect(Alice).close())
      .to.emit(vault28, "Closed").withArgs();
    let iBGTBalanceAfterClose = await iBGT28.balanceOf(await vault28.getAddress());
    console.log(`$iBGT balance after close: ${formatUnits(iBGTBalanceAfterClose, await iBGT28.decimals())}`);

    let alicePTokenBalance = await piBGT.balanceOf(Alice.address);
    let bobPTokenBalance = await piBGT.balanceOf(Bob.address);
    console.log(`Alice $piBGT balance: ${formatUnits(alicePTokenBalance, await piBGT.decimals())}`);
    console.log(`Bob $piBGT balance: ${formatUnits(bobPTokenBalance, await piBGT.decimals())}`);

    // Could not deposit or swap after vault is closed
    await expect(vault28.connect(Alice).deposit(100)).to.be.reverted;
    await expect(vault28.connect(Alice).swap(100)).to.be.reverted;

    // Alice and Bob get their $iBGT back
    console.log("\n========= Alice and Bob get their $iBGT back ===============");
    await expect(vault28.connect(Alice).redeem(alicePTokenBalance * 2n)).to.be.reverted;
    trans = await vault28.connect(Alice).redeem(alicePTokenBalance);
    await expect(trans).to.changeTokenBalances(
      piBGT,
      [Alice.address],
      [-alicePTokenBalance]
    );
    await expect(trans).to.changeTokenBalances(
      iBGT28,
      [Alice.address],
      [alicePTokenBalance]
    );
    await expect(trans)
      .to.emit(vault28, "Redeem").withArgs(Alice.address, alicePTokenBalance, anyValue);
  });

  it('Swap works', async () => {
    const { protocol, settings, vault, stakingPool, iBGT, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const piBGT = PToken__factory.connect(await vault.pToken(), ethers.provider);

    await settings.connect(Alice).updateVaultParamValue(await vault.getAddress(), ethers.encodeBytes32String("D"), ONE_DAY_IN_SECS * 15); // 15 days
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
    let result = await expectedInitSwapParams(vault, 1000);
    let actualX = await vault.epochNextSwapX(epochId);
    let actualK0 = await vault.epochNextSwapK0(epochId);
    expectBigNumberEquals(parseUnits(result.X + "", await iBGT.decimals()), actualX);
    expectBigNumberEquals(parseUnits(result.k0 + "", await iBGT.decimals() + await iBGT.decimals()), actualK0);

    // check Y
    let actualY = await vault.Y();
    let expectedYValue = await expectedY(vault);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 1 hour later, Bob swaps 10 $iBGT for yTokens
    console.log("\n========= Bob swaps 10 $iBGT for YTokens ===============");

    await time.increaseTo(genesisTime + 3600);
    let swapAssetAmount = ethers.parseUnits("10", await iBGT.decimals());
    let swapResult = await expectedCalcSwap(vault, 10, Number(await iBGT.decimals()));  // m = 124.93874956948082
    let actualResult = await vault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await iBGT.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await iBGT.decimals()), actualResult[1]);

    console.log(`k0 before swap: ${await vault.epochNextSwapK0(epochId)}`);
    await expect(iBGT.connect(Bob).approve(await vault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    let trans = await vault.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT, [Bob.address, await stakingPool.getAddress()], [-swapAssetAmount, swapAssetAmount]);
    await expect(trans)
      .to.emit(piBGT, "Rebased").withArgs(swapAssetAmount)
      .to.emit(vault, "Swap").withArgs(epochId, Bob.address, swapAssetAmount, 0, swapAssetAmount, anyValue);

    // k0 not changed.
    let yTokenBalance = await vault.yTokenUserBalance(epochId, await vault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT.decimals())}`);  // 875.051905567315190927
    console.log(`k0 after swap: ${await vault.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await vault.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault.Y();
    expectedYValue = await expectedY(vault);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 1 day later, Bob swaps another 20 $iBGT for yTokens
    console.log("\n========= Bob swaps 10 $iBGT for YTokens ===============");
    await time.increaseTo(genesisTime + 3600 * 10);
    swapAssetAmount = ethers.parseUnits("10", await iBGT.decimals());
    swapResult = await expectedCalcSwap(vault, 10, Number(await iBGT.decimals()));  // 230.59904938282182
    actualResult = await vault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await iBGT.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await iBGT.decimals()), actualResult[1]);

    await expect(iBGT.connect(Bob).approve(await vault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await vault.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT, [Bob.address, await stakingPool.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    // k not changed.
    yTokenBalance = await vault.yTokenUserBalance(epochId, await vault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT.decimals())}`);  // 644.444278692315151251
    console.log(`k0: ${await vault.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await vault.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault.Y();
    expectedYValue = await expectedY(vault);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 10 days later, Alice deposits 100 $iBGT, k0 is updated
    console.log("\n========= Alice deposits 100 $iBGT ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 10);
    aliceDepositAmount = ethers.parseUnits("100", await iBGT.decimals());
    await expect(iBGT.connect(Alice).approve(await vault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    yTokenBalance = await vault.yTokenUserBalance(epochId, await vault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT.decimals())}`);  // 744.444278692315151251
    console.log(`k0: ${await vault.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await vault.epochNextSwapX(epochId)}`);

    console.log("\n========= Bob swaps 10 $iBGT for YTokens ===============");
    swapAssetAmount = ethers.parseUnits("10", await iBGT.decimals());
    swapResult = await expectedCalcSwap(vault, 10, Number(await iBGT.decimals()));  // 720.3778524226619
    actualResult = await vault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await iBGT.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await iBGT.decimals()), actualResult[1]);

    await expect(iBGT.connect(Bob).approve(await vault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await vault.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT, [Bob.address, await stakingPool.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    yTokenBalance = await vault.yTokenUserBalance(epochId, await vault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT.decimals())}`);  // 24.066323587412834713
    console.log(`k0: ${await vault.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await vault.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault.Y();
    expectedYValue = await expectedY(vault);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 16 days later, Alice deposits 1000 $iBGT, and starts a new epoch
    console.log("\n========= Alice deposits 1000 $iBGT to start epoch 2 ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 16);

    aliceDepositAmount = ethers.parseUnits("1000", await iBGT.decimals());
    await expect(iBGT.connect(Alice).approve(await vault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    epochId = 2;
    expect(await vault.currentEpochId()).to.equal(epochId);

    yTokenBalance = await vault.yTokenUserBalance(epochId, await vault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT.decimals())}`);    // 

    // check Y
    actualY = await vault.Y();
    expectedYValue = await expectedY(vault);
    expectNumberEquals(expectedYValue, Number(actualY));
  });

  it('Swap with assets with 8 decimals works', async () => {
    const { protocol, settings, vault8, stakingPool8, iBGT8, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const piBGT = PToken__factory.connect(await vault8.pToken(), ethers.provider);

    await settings.connect(Alice).updateVaultParamValue(await vault8.getAddress(), ethers.encodeBytes32String("D"), ONE_DAY_IN_SECS * 15); // 15 days
    await settings.connect(Alice).updateVaultParamValue(await vault8.getAddress(), ethers.encodeBytes32String("f1"), 0);
    await settings.connect(Alice).updateVaultParamValue(await vault8.getAddress(), ethers.encodeBytes32String("f2"), 0);

    await expect(iBGT8.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await iBGT8.decimals()))).not.to.be.reverted;
    await expect(iBGT8.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await iBGT8.decimals()))).not.to.be.reverted;
    await expect(iBGT8.connect(Alice).mint(Caro.address, ethers.parseUnits("1000000", await iBGT8.decimals()))).not.to.be.reverted;

    // First deposit automaticaly starts a new epoch.
    // Alice deposits 1000 $iBGT
    const genesisTime = await time.latest();
    let aliceDepositAmount = ethers.parseUnits("1000", await iBGT8.decimals());
    await expect(iBGT8.connect(Alice).approve(await vault8.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault8.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    let epochId = 1;
    let result = await expectedInitSwapParams(vault8, 1000);
    let actualX = await vault8.epochNextSwapX(epochId);
    let actualK0 = await vault8.epochNextSwapK0(epochId);
    expectBigNumberEquals(parseUnits(result.X + "", await iBGT8.decimals()), actualX);
    expectBigNumberEquals(parseUnits(result.k0 + "", await iBGT8.decimals() + await iBGT8.decimals()), actualK0);

    // check Y
    let actualY = await vault8.Y();
    let expectedYValue = await expectedY(vault8);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 1 hour later, Bob swaps 10 $iBGT for yTokens
    console.log("\n========= Bob swaps 10 $iBGT for YTokens ===============");

    await time.increaseTo(genesisTime + 3600);
    let swapAssetAmount = ethers.parseUnits("10", await iBGT8.decimals());
    let swapResult = await expectedCalcSwap(vault8, 10, Number(await iBGT8.decimals()));  // m = 124.93874956948082
    let actualResult = await vault8.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated.toFixed(Number(await iBGT8.decimals())), await iBGT8.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m.toFixed(Number(await iBGT8.decimals())), await iBGT8.decimals()), actualResult[1]);

    console.log(`k0 before swap: ${await vault8.epochNextSwapK0(epochId)}`);
    await expect(iBGT8.connect(Bob).approve(await vault8.getAddress(), swapAssetAmount)).not.to.be.reverted;
    let trans = await vault8.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT8, [Bob.address, await stakingPool8.getAddress()], [-swapAssetAmount, swapAssetAmount]);
    await expect(trans)
      .to.emit(piBGT, "Rebased").withArgs(swapAssetAmount)
      .to.emit(vault8, "Swap").withArgs(epochId, Bob.address, swapAssetAmount, 0, swapAssetAmount, anyValue);

    // k0 not changed.
    let yTokenBalance = await vault8.yTokenUserBalance(epochId, await vault8.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT8.decimals())}`);  // 875.051905567315190927
    console.log(`k0 after swap: ${await vault8.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await vault8.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault8.Y();
    expectedYValue = await expectedY(vault8);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 1 day later, Bob swaps another 20 $iBGT for yTokens
    console.log("\n========= Bob swaps 10 $iBGT for YTokens ===============");
    await time.increaseTo(genesisTime + 3600 * 10);
    swapAssetAmount = ethers.parseUnits("10", await iBGT8.decimals());
    swapResult = await expectedCalcSwap(vault8, 10, Number(await iBGT8.decimals()));  // 230.59904938282182
    actualResult = await vault8.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated.toFixed(Number(await iBGT8.decimals())), await iBGT8.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m.toFixed(Number(await iBGT8.decimals())), await iBGT8.decimals()), actualResult[1]);

    await expect(iBGT8.connect(Bob).approve(await vault8.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await vault8.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT8, [Bob.address, await stakingPool8.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    // k not changed.
    yTokenBalance = await vault8.yTokenUserBalance(epochId, await vault8.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT8.decimals())}`);  // 644.444278692315151251
    console.log(`k0: ${await vault8.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await vault8.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault8.Y();
    expectedYValue = await expectedY(vault8);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 10 days later, Alice deposits 100 $iBGT, k0 is updated
    console.log("\n========= Alice deposits 100 $iBGT ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 10);
    aliceDepositAmount = ethers.parseUnits("100", await iBGT8.decimals());
    await expect(iBGT8.connect(Alice).approve(await vault8.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault8.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    yTokenBalance = await vault8.yTokenUserBalance(epochId, await vault8.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT8.decimals())}`);  // 744.444278692315151251
    console.log(`k0: ${await vault8.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await vault8.epochNextSwapX(epochId)}`);

    console.log("\n========= Bob swaps 10 $iBGT for YTokens ===============");
    swapAssetAmount = ethers.parseUnits("10", await iBGT8.decimals());
    swapResult = await expectedCalcSwap(vault8, 10, Number(await iBGT8.decimals()));  // 720.3778524226619
    actualResult = await vault8.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated.toFixed(Number(await iBGT8.decimals())), await iBGT8.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m.toFixed(Number(await iBGT8.decimals())), await iBGT8.decimals()), actualResult[1]);

    await expect(iBGT8.connect(Bob).approve(await vault8.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await vault8.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT8, [Bob.address, await stakingPool8.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    yTokenBalance = await vault8.yTokenUserBalance(epochId, await vault8.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT8.decimals())}`);  // 24.066323587412834713
    console.log(`k0: ${await vault8.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await vault8.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault8.Y();
    expectedYValue = await expectedY(vault8);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 16 days later, Alice deposits 1000 $iBGT, and starts a new epoch
    console.log("\n========= Alice deposits 1000 $iBGT to start epoch 2 ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 16);

    aliceDepositAmount = ethers.parseUnits("1000", await iBGT8.decimals());
    await expect(iBGT8.connect(Alice).approve(await vault8.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault8.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    epochId = 2;
    expect(await vault8.currentEpochId()).to.equal(epochId);

    yTokenBalance = await vault8.yTokenUserBalance(epochId, await vault8.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT8.decimals())}`);    // 

    // check Y
    actualY = await vault8.Y();
    expectedYValue = await expectedY(vault8);
    expectNumberEquals(expectedYValue, Number(actualY));
  });

  it('Swap with assets with 28 decimals works', async () => {
    const { protocol, settings, vault28, stakingPool28, iBGT28, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const piBGT = PToken__factory.connect(await vault28.pToken(), ethers.provider);

    await settings.connect(Alice).updateVaultParamValue(await vault28.getAddress(), ethers.encodeBytes32String("D"), ONE_DAY_IN_SECS * 15); // 15 days
    await settings.connect(Alice).updateVaultParamValue(await vault28.getAddress(), ethers.encodeBytes32String("f1"), 0);
    await settings.connect(Alice).updateVaultParamValue(await vault28.getAddress(), ethers.encodeBytes32String("f2"), 0);

    await expect(iBGT28.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await iBGT28.decimals()))).not.to.be.reverted;
    await expect(iBGT28.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await iBGT28.decimals()))).not.to.be.reverted;
    await expect(iBGT28.connect(Alice).mint(Caro.address, ethers.parseUnits("1000000", await iBGT28.decimals()))).not.to.be.reverted;

    // First deposit automaticaly starts a new epoch.
    // Alice deposits 1000 $iBGT
    const genesisTime = await time.latest();
    let aliceDepositAmount = ethers.parseUnits("1000", await iBGT28.decimals());
    await expect(iBGT28.connect(Alice).approve(await vault28.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault28.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    let epochId = 1;
    let result = await expectedInitSwapParams(vault28, 1000);
    let actualX = await vault28.epochNextSwapX(epochId);
    let actualK0 = await vault28.epochNextSwapK0(epochId);
    expectBigNumberEquals(parseUnits(result.X + "", await iBGT28.decimals()), actualX);
    expectBigNumberEquals(parseUnits(result.k0 + "", await iBGT28.decimals() + await iBGT28.decimals()), actualK0);

    // check Y
    let actualY = await vault28.Y();
    let expectedYValue = await expectedY(vault28);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 1 hour later, Bob swaps 10 $iBGT for yTokens
    console.log("\n========= Bob swaps 10 $iBGT for YTokens ===============");

    await time.increaseTo(genesisTime + 3600);
    let swapAssetAmount = ethers.parseUnits("10", await iBGT28.decimals());
    let swapResult = await expectedCalcSwap(vault28, 10, Number(await iBGT28.decimals()));  // m = 124.93874956948082
    let actualResult = await vault28.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated.toFixed(Number(await iBGT28.decimals())), await iBGT28.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m.toFixed(Number(await iBGT28.decimals())), await iBGT28.decimals()), actualResult[1]);

    console.log(`k0 before swap: ${await vault28.epochNextSwapK0(epochId)}`);
    await expect(iBGT28.connect(Bob).approve(await vault28.getAddress(), swapAssetAmount)).not.to.be.reverted;
    let trans = await vault28.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT28, [Bob.address, await stakingPool28.getAddress()], [-swapAssetAmount, swapAssetAmount]);
    await expect(trans)
      .to.emit(piBGT, "Rebased").withArgs(swapAssetAmount)
      .to.emit(vault28, "Swap").withArgs(epochId, Bob.address, swapAssetAmount, 0, swapAssetAmount, anyValue);

    // k0 not changed.
    let yTokenBalance = await vault28.yTokenUserBalance(epochId, await vault28.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT28.decimals())}`);  // 875.051905567315190927
    console.log(`k0 after swap: ${await vault28.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await vault28.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault28.Y();
    expectedYValue = await expectedY(vault28);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 1 day later, Bob swaps another 20 $iBGT for yTokens
    console.log("\n========= Bob swaps 10 $iBGT for YTokens ===============");
    await time.increaseTo(genesisTime + 3600 * 10);
    swapAssetAmount = ethers.parseUnits("10", await iBGT28.decimals());
    swapResult = await expectedCalcSwap(vault28, 10, Number(await iBGT28.decimals()));  // 230.59904938282182
    actualResult = await vault28.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated.toFixed(Number(await iBGT28.decimals())), await iBGT28.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m.toFixed(Number(await iBGT28.decimals())), await iBGT28.decimals()), actualResult[1]);

    await expect(iBGT28.connect(Bob).approve(await vault28.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await vault28.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT28, [Bob.address, await stakingPool28.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    // k not changed.
    yTokenBalance = await vault28.yTokenUserBalance(epochId, await vault28.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT28.decimals())}`);  // 644.444278692315151251
    console.log(`k0: ${await vault28.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await vault28.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault28.Y();
    expectedYValue = await expectedY(vault28);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 10 days later, Alice deposits 100 $iBGT, k0 is updated
    console.log("\n========= Alice deposits 100 $iBGT ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 10);
    aliceDepositAmount = ethers.parseUnits("100", await iBGT28.decimals());
    await expect(iBGT28.connect(Alice).approve(await vault28.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault28.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    yTokenBalance = await vault28.yTokenUserBalance(epochId, await vault28.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT28.decimals())}`);  // 744.444278692315151251
    console.log(`k0: ${await vault28.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await vault28.epochNextSwapX(epochId)}`);

    console.log("\n========= Bob swaps 10 $iBGT for YTokens ===============");
    swapAssetAmount = ethers.parseUnits("10", await iBGT28.decimals());
    swapResult = await expectedCalcSwap(vault28, 10, Number(await iBGT28.decimals()));  // 720.3778524226619
    actualResult = await vault28.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated.toFixed(Number(await iBGT28.decimals())), await iBGT28.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m.toFixed(Number(await iBGT28.decimals())), await iBGT28.decimals()), actualResult[1]);

    await expect(iBGT28.connect(Bob).approve(await vault28.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await vault28.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT28, [Bob.address, await stakingPool28.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    yTokenBalance = await vault28.yTokenUserBalance(epochId, await vault28.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT28.decimals())}`);  // 24.066323587412834713
    console.log(`k0: ${await vault28.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await vault28.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault28.Y();
    expectedYValue = await expectedY(vault28);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 16 days later, Alice deposits 1000 $iBGT, and starts a new epoch
    console.log("\n========= Alice deposits 1000 $iBGT to start epoch 2 ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 16);

    aliceDepositAmount = ethers.parseUnits("1000", await iBGT28.decimals());
    await expect(iBGT28.connect(Alice).approve(await vault28.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault28.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    epochId = 2;
    expect(await vault28.currentEpochId()).to.equal(epochId);

    yTokenBalance = await vault28.yTokenUserBalance(epochId, await vault28.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT28.decimals())}`);    // 

    // check Y
    actualY = await vault28.Y();
    expectedYValue = await expectedY(vault28);
    expectNumberEquals(expectedYValue, Number(actualY));
  });

  it('Swap with big numbers works', async () => {
    const { settings, vault, stakingPool, iBGT, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const piBGT = PToken__factory.connect(await vault.pToken(), ethers.provider);

    await settings.connect(Alice).updateVaultParamValue(await vault.getAddress(), ethers.encodeBytes32String("D"), ONE_DAY_IN_SECS * 15); // 15 days
    await settings.connect(Alice).updateVaultParamValue(await vault.getAddress(), ethers.encodeBytes32String("f1"), 0);
    await settings.connect(Alice).updateVaultParamValue(await vault.getAddress(), ethers.encodeBytes32String("f2"), 0);

    // 10^19
    await expect(iBGT.connect(Alice).mint(Alice.address, ethers.parseUnits("10000000000000000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(iBGT.connect(Alice).mint(Bob.address, ethers.parseUnits("10000000000000000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(iBGT.connect(Alice).mint(Caro.address, ethers.parseUnits("10000000000000000000", await iBGT.decimals()))).not.to.be.reverted;

    // First deposit automaticaly starts a new epoch.
    // Alice deposits 1000000000000000000 (10^18) $iBGT
    const genesisTime = await time.latest();
    let aliceDepositAmount = ethers.parseUnits("1000000000000000000", await iBGT.decimals());
    await expect(iBGT.connect(Alice).approve(await vault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    let epochId = 1;
    let result = await expectedInitSwapParams(vault, 1000000000000000000);
    let actualX = await vault.epochNextSwapX(epochId);
    let actualK0 = await vault.epochNextSwapK0(epochId);
    expectBigNumberEquals(parseUnits(result.X + "", await iBGT.decimals()), actualX);
    expectBigNumberEquals(parseUnits((new BigNumber(result.k0)).toFixed(), await iBGT.decimals() + await iBGT.decimals()), actualK0);

    // check Y
    let actualY = await vault.Y();
    let expectedYValue = await expectedY(vault);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);

    // 1 hour later, Bob swaps 100000000000000000 $iBGT for yTokens
    console.log("\n========= Bob swaps 100000000000000000 (10^17) $iBGT for YTokens ===============");

    await time.increaseTo(genesisTime + 3600);
    let swapAssetAmount = ethers.parseUnits("100000000000000000", await iBGT.decimals());
    let swapResult = await expectedCalcSwap(vault, 100000000000000000, Number(await iBGT.decimals()));
    let actualResult = await vault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await iBGT.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await iBGT.decimals()), actualResult[1]);

    console.log(`k0 before swap: ${await vault.epochNextSwapK0(epochId)}`);
    await expect(iBGT.connect(Bob).approve(await vault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    let trans = await vault.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT, [Bob.address, await stakingPool.getAddress()], [-swapAssetAmount, swapAssetAmount]);
    await expect(trans)
      .to.emit(piBGT, "Rebased").withArgs(swapAssetAmount)
      .to.emit(vault, "Swap").withArgs(epochId, Bob.address, swapAssetAmount, 0, swapAssetAmount, anyValue);

    // k0 not changed.
    let yTokenBalance = await vault.yTokenUserBalance(epochId, await vault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT.decimals())}`);
    console.log(`k0 after swap: ${await vault.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await vault.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault.Y();
    expectedYValue = await expectedY(vault);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);

    // 1 day later, Bob swaps another 10 $iBGT for yTokens
    console.log("\n========= Bob swaps 1000000 $iBGT for YTokens ===============");
    await time.increaseTo(genesisTime + 3600 * 10);
    swapAssetAmount = ethers.parseUnits("1000000", await iBGT.decimals());
    swapResult = await expectedCalcSwap(vault, 1000000, Number(await iBGT.decimals()));
    actualResult = await vault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await iBGT.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await iBGT.decimals()), actualResult[1]);

    await expect(iBGT.connect(Bob).approve(await vault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await vault.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT, [Bob.address, await stakingPool.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    // k not changed.
    yTokenBalance = await vault.yTokenUserBalance(epochId, await vault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT.decimals())}`);  // 644.444278692315151251
    console.log(`k0: ${await vault.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await vault.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault.Y();
    expectedYValue = await expectedY(vault);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);

    // 10 days later, Alice deposits 100 $iBGT, k0 is updated
    console.log("\n========= Alice deposits 100 $iBGT ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 10);
    aliceDepositAmount = ethers.parseUnits("100", await iBGT.decimals());
    await expect(iBGT.connect(Alice).approve(await vault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    yTokenBalance = await vault.yTokenUserBalance(epochId, await vault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT.decimals())}`); 
    console.log(`k0: ${await vault.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await vault.epochNextSwapX(epochId)}`);

    console.log("\n========= Bob swaps 1000000 $iBGT for YTokens ===============");
    swapAssetAmount = ethers.parseUnits("1000000", await iBGT.decimals());
    swapResult = await expectedCalcSwap(vault, 1000000, Number(await iBGT.decimals()));  
    actualResult = await vault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await iBGT.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await iBGT.decimals()), actualResult[1]);

    await expect(iBGT.connect(Bob).approve(await vault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await vault.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT, [Bob.address, await stakingPool.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    yTokenBalance = await vault.yTokenUserBalance(epochId, await vault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT.decimals())}`); 
    console.log(`k0: ${await vault.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await vault.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault.Y();
    expectedYValue = await expectedY(vault);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);

    // 16 days later, Alice deposits 1000 $iBGT, and starts a new epoch
    console.log("\n========= Alice deposits 1000 $iBGT to start epoch 2 ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 16);

    aliceDepositAmount = ethers.parseUnits("1000", await iBGT.decimals());
    await expect(iBGT.connect(Alice).approve(await vault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    epochId = 2;
    expect(await vault.currentEpochId()).to.equal(epochId);

    yTokenBalance = await vault.yTokenUserBalance(epochId, await vault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT.decimals())}`);

    // check Y
    actualY = await vault.Y();
    expectedYValue = await expectedY(vault);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);
  });

  it('Swap with big numbers works', async () => {
    const { settings, vault28, stakingPool28, iBGT28, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const piBGT = PToken__factory.connect(await vault28.pToken(), ethers.provider);

    await settings.connect(Alice).updateVaultParamValue(await vault28.getAddress(), ethers.encodeBytes32String("D"), ONE_DAY_IN_SECS * 15); // 15 days
    await settings.connect(Alice).updateVaultParamValue(await vault28.getAddress(), ethers.encodeBytes32String("f1"), 0);
    await settings.connect(Alice).updateVaultParamValue(await vault28.getAddress(), ethers.encodeBytes32String("f2"), 0);

    // 10^19
    await expect(iBGT28.connect(Alice).mint(Alice.address, ethers.parseUnits("10000000000000000000", await iBGT28.decimals()))).not.to.be.reverted;
    await expect(iBGT28.connect(Alice).mint(Bob.address, ethers.parseUnits("10000000000000000000", await iBGT28.decimals()))).not.to.be.reverted;
    await expect(iBGT28.connect(Alice).mint(Caro.address, ethers.parseUnits("10000000000000000000", await iBGT28.decimals()))).not.to.be.reverted;

    // First deposit automaticaly starts a new epoch.
    // Alice deposits 10000000000 (10^10) $iBGT
    const genesisTime = await time.latest();
    let aliceDepositAmount = ethers.parseUnits("10000000000", await iBGT28.decimals());
    await expect(iBGT28.connect(Alice).approve(await vault28.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault28.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    let epochId = 1;
    let result = await expectedInitSwapParams(vault28, 10000000000);
    let actualX = await vault28.epochNextSwapX(epochId);
    let actualK0 = await vault28.epochNextSwapK0(epochId);
    expectBigNumberEquals(parseUnits(result.X + "", await iBGT28.decimals()), actualX);
    expectBigNumberEquals(parseUnits((new BigNumber(result.k0)).toFixed(), await iBGT28.decimals() + await iBGT28.decimals()), actualK0);

    // check Y
    let actualY = await vault28.Y();
    let expectedYValue = await expectedY(vault28);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);

    // 1 hour later, Bob swaps 10000000000 $iBGT for yTokens
    console.log("\n========= Bob swaps 10000000000 (10^10) $iBGT for YTokens ===============");

    await time.increaseTo(genesisTime + 3600);
    let swapAssetAmount = ethers.parseUnits("10000000000", await iBGT28.decimals());
    let swapResult = await expectedCalcSwap(vault28, 10000000000, Number(await iBGT28.decimals()));
    let actualResult = await vault28.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await iBGT28.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await iBGT28.decimals()), actualResult[1]);

    console.log(`k0 before swap: ${await vault28.epochNextSwapK0(epochId)}`);
    await expect(iBGT28.connect(Bob).approve(await vault28.getAddress(), swapAssetAmount)).not.to.be.reverted;
    let trans = await vault28.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT28, [Bob.address, await stakingPool28.getAddress()], [-swapAssetAmount, swapAssetAmount]);
    await expect(trans)
      .to.emit(piBGT, "Rebased").withArgs(swapAssetAmount)
      .to.emit(vault28, "Swap").withArgs(epochId, Bob.address, swapAssetAmount, 0, swapAssetAmount, anyValue);

    // k0 not changed.
    let yTokenBalance = await vault28.yTokenUserBalance(epochId, await vault28.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT28.decimals())}`);
    console.log(`k0 after swap: ${await vault28.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await vault28.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault28.Y();
    expectedYValue = await expectedY(vault28);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);

    // 1 day later, Bob swaps another 10 $iBGT for yTokens
    console.log("\n========= Bob swaps 1000000 $iBGT for YTokens ===============");
    await time.increaseTo(genesisTime + 3600 * 10);
    swapAssetAmount = ethers.parseUnits("1000000", await iBGT28.decimals());
    swapResult = await expectedCalcSwap(vault28, 1000000, Number(await iBGT28.decimals()));
    actualResult = await vault28.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await iBGT28.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await iBGT28.decimals()), actualResult[1]);

    await expect(iBGT28.connect(Bob).approve(await vault28.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await vault28.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT28, [Bob.address, await stakingPool28.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    // k not changed.
    yTokenBalance = await vault28.yTokenUserBalance(epochId, await vault28.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT28.decimals())}`);  // 644.444278692315151251
    console.log(`k0: ${await vault28.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await vault28.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault28.Y();
    expectedYValue = await expectedY(vault28);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);

    // 10 days later, Alice deposits 100 $iBGT, k0 is updated
    console.log("\n========= Alice deposits 100 $iBGT ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 10);
    aliceDepositAmount = ethers.parseUnits("100", await iBGT28.decimals());
    await expect(iBGT28.connect(Alice).approve(await vault28.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault28.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    yTokenBalance = await vault28.yTokenUserBalance(epochId, await vault28.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT28.decimals())}`); 
    console.log(`k0: ${await vault28.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await vault28.epochNextSwapX(epochId)}`);

    console.log("\n========= Bob swaps 1000000 $iBGT for YTokens ===============");
    swapAssetAmount = ethers.parseUnits("1000000", await iBGT28.decimals());
    swapResult = await expectedCalcSwap(vault28, 1000000, Number(await iBGT28.decimals()));  
    actualResult = await vault28.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await iBGT28.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await iBGT28.decimals()), actualResult[1]);

    await expect(iBGT28.connect(Bob).approve(await vault28.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await vault28.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT28, [Bob.address, await stakingPool28.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    yTokenBalance = await vault28.yTokenUserBalance(epochId, await vault28.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT28.decimals())}`); 
    console.log(`k0: ${await vault28.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await vault28.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await vault28.Y();
    expectedYValue = await expectedY(vault28);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);

    // 16 days later, Alice deposits 1000 $iBGT, and starts a new epoch
    console.log("\n========= Alice deposits 1000 $iBGT to start epoch 2 ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 16);

    aliceDepositAmount = ethers.parseUnits("1000", await iBGT28.decimals());
    await expect(iBGT28.connect(Alice).approve(await vault28.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(vault28.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    epochId = 2;
    expect(await vault28.currentEpochId()).to.equal(epochId);

    yTokenBalance = await vault28.yTokenUserBalance(epochId, await vault28.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT28.decimals())}`);

    // check Y
    actualY = await vault28.Y();
    expectedYValue = await expectedY(vault28);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);
  });

});
