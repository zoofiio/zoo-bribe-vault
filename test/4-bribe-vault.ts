import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { 
  deployContractsFixture, ONE_DAY_IN_SECS, expectNumberEquals, expectBigNumberEquals, makeToken,
  expectedY, expectedInitSwapParams, expectedSwapParamsOnDeposit, expectedCalcSwap
} from './utils';
import { RedeemPool__factory, PToken__factory } from "../typechain";
import { formatUnits, parseUnits } from 'ethers';

const { provider } = ethers;

const BigNumber = require('bignumber.js');

describe('Bribe Vault', () => {

  it('Bribe Vault basic E2E works', async () => {
    const { protocol, settings, vault, stakingPool, iBGT, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const piBGT = PToken__factory.connect(await vault.pToken(), ethers.provider);

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
    let aliceExpectedSwapResult = await expectedCalcSwap(vault, 100);  // 1463.1851649850014
    let aliceActualSwapResult = await vault.calcSwap(aliceSwapAmount);
    expectBigNumberEquals(parseUnits(aliceExpectedSwapResult.X_updated + "", 18), aliceActualSwapResult[0]);
    expectBigNumberEquals(parseUnits(aliceExpectedSwapResult.m + "", 18), aliceActualSwapResult[1]);

    let fees = aliceSwapAmount * 10n / 100n;
    let netSwapAmount = aliceSwapAmount - fees;
    await expect(iBGT.connect(Alice).approve(await vault.getAddress(), aliceSwapAmount)).not.to.be.reverted;
    trans = await vault.connect(Alice).swap(aliceSwapAmount);
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address, await settings.treasury(), await stakingPool.getAddress()],
      [-aliceSwapAmount, fees, netSwapAmount]
    );
    await expect(trans)
      .to.emit(piBGT, "Rebased").withArgs(netSwapAmount)
      .to.emit(vault, "Swap").withArgs(currentEpochId, Alice.address, aliceSwapAmount, fees, netSwapAmount, anyValue);
    
    // No bribes now
    // console.log(ethers.formatUnits(await iBGT.balanceOf(Alice.address), await iBGT.decimals()));
    const bribeAmountIBGT = ethers.parseUnits("1000", await iBGT.decimals());

    // Add bribes
    await expect(iBGT.connect(Alice).approve(await stakingPool.getAddress(), bribeAmountIBGT)).not.to.be.reverted;
    await expect(brbToken.connect(Alice).approve(await stakingPool.getAddress(), bribeAmountBRB)).not.to.be.reverted;
    await expect(stakingPool.connect(Alice).notifyRewardAmount(await iBGT.getAddress(), bribeAmountIBGT)).not.to.be.reverted;
    await expect(stakingPool.connect(Alice).notifyRewardAmount(await brbToken.getAddress(), bribeAmountBRB)).not.to.be.reverted;

    // Could not claim bribes, since current epoch is not over
    await expect(vault.connect(Alice).claimBribes(currentEpochId)).to.be.revertedWith("Epoch not ended yet");

    // Another 11 days later, all bribes are distributed
    await time.increase(ONE_DAY_IN_SECS * 11);

    // Bob swap 10 $iBGT for yTokens, which triggers bribes claimed
    console.log("\n========= Another 11 days later, Bob swaps 10 $iBGT for YTokens ===============");
    let swapAssetAmount = ethers.parseUnits("10", await iBGT.decimals());
    let swapResult = await expectedCalcSwap(vault, 10); 
    let actualResult = await vault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", 18), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", 18), actualResult[1]);
    await expect(iBGT.connect(Bob).approve(await vault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await vault.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(iBGT, [Bob.address], [-swapAssetAmount]);

    // 16 days later, epoch ends. And all bribes are distributed
    console.log("\n========= 16 days later, check bribes ===============");
    await time.increaseTo(genesisTime! + ONE_DAY_IN_SECS * 16);
    let vaultBribesIBGTAmount = bribeAmountIBGT;
    let vaultBribesBRBAmount = bribeAmountBRB;

    // Check YT balances
    const aliceYTokenBalance = await vault.yTokenUserBalance(currentEpochId, Alice.address);
    const bobYTokenBalance = await vault.yTokenUserBalance(currentEpochId, Bob.address);
    const vaultYTokenBalance = await vault.yTokenUserBalance(currentEpochId, await vault.getAddress());
    const totalYTokenBalance = await vault.yTokenTotalSupply(currentEpochId);
    console.log(aliceYTokenBalance, bobYTokenBalance, totalYTokenBalance);
    expectBigNumberEquals(aliceYTokenBalance + bobYTokenBalance + vaultYTokenBalance, totalYTokenBalance);

    const aliceYTokenBalanceSynthetic = await vault.yTokenUserBalanceSynthetic(currentEpochId, Alice.address);
    const bobYTokenBalanceSynthetic = await vault.yTokenUserBalanceSynthetic(currentEpochId, Bob.address);
    // const vaultYTokenBalanceSynthetic = await vault.yTokenUserBalanceSynthetic(currentEpochId, await vault.getAddress());
    const totalYTokenBalanceSynthetic = await vault.yTokenTotalSupplySynthetic(currentEpochId);
    console.log(aliceYTokenBalanceSynthetic, bobYTokenBalanceSynthetic, totalYTokenBalanceSynthetic);
    // expect(vaultYTokenBalanceSynthetic).to.equal(0);
    await expect(vault.yTokenUserBalanceSynthetic(currentEpochId, await vault.getAddress())).to.be.reverted;
    expectBigNumberEquals(aliceYTokenBalanceSynthetic + bobYTokenBalanceSynthetic, totalYTokenBalanceSynthetic);

    const expectedAliceBribesIBGT = vaultBribesIBGTAmount * aliceYTokenBalanceSynthetic / (totalYTokenBalanceSynthetic);
    const expectedBobBribesIBGT = vaultBribesIBGTAmount * bobYTokenBalanceSynthetic / (totalYTokenBalanceSynthetic);

    const expectedAliceBribesBRB = vaultBribesBRBAmount * aliceYTokenBalanceSynthetic / (totalYTokenBalanceSynthetic);
    const expectedBobBribesBRB = vaultBribesBRBAmount * bobYTokenBalanceSynthetic / (totalYTokenBalanceSynthetic);

    let actualAliceBribes = await vault.calcBribes(currentEpochId, Alice.address);
    let actualBobBribes = await vault.calcBribes(currentEpochId, Bob.address);
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

    console.log("\n========= Alice claimed bribes ===============");
    trans = await vault.connect(Alice).claimBribes(currentEpochId);
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address, await vault.getAddress()],
      [actualAliceBribes[0][2], -actualAliceBribes[0][2]]
    );
    await expect(trans).to.changeTokenBalances(
      brbToken,
      [Alice.address, await vault.getAddress()],
      [actualAliceBribes[1][2], -actualAliceBribes[1][2]]
    );
    await expect(trans)
      .to.emit(vault, "BribesClaimed").withArgs(await iBGT.getAddress(), Alice.address, actualAliceBribes[0][2])
      .to.emit(vault, "BribesClaimed").withArgs(await brbToken.getAddress(), Alice.address, actualAliceBribes[1][2])
      .to.emit(vault, "YTokenDummyBurned").withArgs(currentEpochId, Alice.address, anyValue);
    
    // Now Alice could not claim bribes again
    actualAliceBribes = await vault.calcBribes(currentEpochId, Alice.address);
    expect(actualAliceBribes.length).to.equal(2);
    expect(actualAliceBribes[0][1]).to.equal(await iBGT.getAddress());
    expect(actualAliceBribes[0][2]).to.equal(0);
    expect(actualAliceBribes[1][1]).to.equal(await brbToken.getAddress());
    expect(actualAliceBribes[1][2]).to.equal(0);

    // Alice add Bob as briber
    const brbToken2 = await makeToken(await protocol.getAddress(), "Bribe Token", "BRB2");
    await expect(brbToken2.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await brbToken2.decimals()))).not.to.be.reverted;
    let bribeAmountBRB2 = ethers.parseUnits("2000", await brbToken2.decimals());
    await expect(brbToken2.connect(Bob).approve(await vault.getAddress(), bribeAmountBRB2)).not.to.be.reverted;
    await expect(vault.connect(Bob).addBribeToken(await brbToken2.getAddress())).to.be.reverted;
    await expect(vault.connect(Bob).addBribes(await brbToken2.getAddress(), bribeAmountBRB2)).to.be.reverted;

    // Bob add new bribes
    console.log("\n========= Bob add $BRB2 bribes ===============");
    await expect(vault.connect(Alice).setBriber(Bob.address, true))
      .to.emit(vault, "UpdateBriber").withArgs(Bob.address, true);
    await expect(vault.connect(Bob).addBribeToken(await brbToken2.getAddress()))
      .to.emit(vault, "BribeTokenAdded").withArgs(currentEpochId, await brbToken2.getAddress(), Bob.address);
    await expect(vault.connect(Bob).addBribes(await brbToken2.getAddress(), bribeAmountBRB2))
      .to.emit(vault, "BribesAdded").withArgs(currentEpochId, await brbToken2.getAddress(), bribeAmountBRB2, Bob.address);
    
    actualAliceBribes = await vault.calcBribes(currentEpochId, Alice.address);
    actualBobBribes = await vault.calcBribes(currentEpochId, Bob.address);
    console.log(actualAliceBribes);
    console.log(actualBobBribes);

    // Alice get no bribes
    expect(actualAliceBribes.length).to.equal(3);
    expect(actualAliceBribes[0][1]).to.equal(await iBGT.getAddress());
    expect(actualAliceBribes[0][2]).to.equal(0);
    expect(actualAliceBribes[1][1]).to.equal(await brbToken.getAddress());
    expect(actualAliceBribes[1][2]).to.equal(0);
    expect(actualAliceBribes[2][1]).to.equal(await brbToken2.getAddress());
    expect(actualAliceBribes[2][2]).to.equal(0);

    // Bob get all bribes for $BRB2
    expect(actualBobBribes.length).to.equal(3);
    expect(actualBobBribes[0][1]).to.equal(await iBGT.getAddress());
    expectBigNumberEquals(expectedBobBribesIBGT, actualBobBribes[0][2]);
    expect(actualBobBribes[1][1]).to.equal(await brbToken.getAddress());
    expectBigNumberEquals(expectedBobBribesBRB, actualBobBribes[1][2]);
    expect(actualBobBribes[2][1]).to.equal(await brbToken2.getAddress());
    expectBigNumberEquals(bribeAmountBRB2, actualBobBribes[2][2]);

    // Alice closes vault
    console.log("\n========= Alice closes vault ===============");
    let iBGTBalanceBeforeClose = await iBGT.balanceOf(await vault.getAddress());
    // expect(iBGTBalanceBeforeClose).to.equal(0);
    console.log(`$iBGT balance before close: ${formatUnits(iBGTBalanceBeforeClose, await iBGT.decimals())}`);
    await expect(vault.connect(Alice).close())
      .to.emit(vault, "VaultClosed").withArgs();
    let iBGTBalanceAfterClose = await iBGT.balanceOf(await vault.getAddress());
    console.log(`$iBGT balance after close: ${formatUnits(iBGTBalanceAfterClose, await iBGT.decimals())}`);

    let alicePTokenBalance = await piBGT.balanceOf(Alice.address);
    let bobPTokenBalance = await piBGT.balanceOf(Bob.address);
    console.log(`Alice $piBGT balance: ${formatUnits(alicePTokenBalance, await piBGT.decimals())}`);
    console.log(`Bob $piBGT balance: ${formatUnits(bobPTokenBalance, await piBGT.decimals())}`);

    // Could not deposit or swap after vault is closed
    await expect(vault.connect(Alice).deposit(100)).to.be.reverted;
    await expect(vault.connect(Alice).swap(100)).to.be.reverted;

    // Alice and Bob get their $iBGT back
    console.log("\n========= Alice and Bob get their $iBGT back ===============");
    await expect(vault.connect(Alice).redeem(alicePTokenBalance * 2n)).to.be.reverted;
    trans = await vault.connect(Alice).redeem(alicePTokenBalance);
    await expect(trans).to.changeTokenBalances(
      piBGT,
      [Alice.address],
      [-alicePTokenBalance]
    );
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address],
      [alicePTokenBalance]
    );
    await expect(trans)
      .to.emit(vault, "Redeem").withArgs(Alice.address, alicePTokenBalance, anyValue);
  });

  it('Swap works', async () => {
    const { protocol, settings, vault, stakingPool, iBGT, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const piBGT = PToken__factory.connect(await vault.pToken(), ethers.provider);

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
    expectBigNumberEquals(parseUnits(result.X + "", 18), actualX);
    expectBigNumberEquals(parseUnits(result.k0 + "", 18 + 18), actualK0);

    // check Y
    let actualY = await vault.Y();
    let expectedYValue = await expectedY(vault);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 1 hour later, Bob swaps 10 $iBGT for yTokens
    console.log("\n========= Bob swaps 10 $iBGT for YTokens ===============");

    await time.increaseTo(genesisTime + 3600);
    let swapAssetAmount = ethers.parseUnits("10", await iBGT.decimals());
    let swapResult = await expectedCalcSwap(vault, 10);  // m = 124.93874956948082
    let actualResult = await vault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", 18), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", 18), actualResult[1]);

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
    swapResult = await expectedCalcSwap(vault, 10);  // 230.59904938282182
    actualResult = await vault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", 18), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", 18), actualResult[1]);

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
    swapResult = await expectedCalcSwap(vault, 10);  // 720.3778524226619
    actualResult = await vault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", 18), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", 18), actualResult[1]);

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

  it('Swap with big numbers works', async () => {
    const { protocol, settings, vault, stakingPool, iBGT, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const piBGT = PToken__factory.connect(await vault.pToken(), ethers.provider);

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
    expectBigNumberEquals(parseUnits(result.X + "", 18), actualX);
    expectBigNumberEquals(parseUnits((new BigNumber(result.k0)).toFixed(), 18 + 18), actualK0);

    // check Y
    let actualY = await vault.Y();
    let expectedYValue = await expectedY(vault);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);

    // 1 hour later, Bob swaps 100000000000000000 $iBGT for yTokens
    console.log("\n========= Bob swaps 100000000000000000 (10^17) $iBGT for YTokens ===============");

    await time.increaseTo(genesisTime + 3600);
    let swapAssetAmount = ethers.parseUnits("100000000000000000", await iBGT.decimals());
    let swapResult = await expectedCalcSwap(vault, 100000000000000000);
    let actualResult = await vault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", 18), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", 18), actualResult[1]);

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
    swapResult = await expectedCalcSwap(vault, 1000000);
    actualResult = await vault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", 18), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", 18), actualResult[1]);

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
    swapResult = await expectedCalcSwap(vault, 1000000);  
    actualResult = await vault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", 18), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", 18), actualResult[1]);

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
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await iBGT.decimals())}`);    // 

    // check Y
    actualY = await vault.Y();
    expectedYValue = await expectedY(vault);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);
  });

});
