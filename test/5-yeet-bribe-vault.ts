import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { 
  deployContractsFixture, ONE_DAY_IN_SECS, expectNumberEquals, expectBigNumberEquals, makeToken,
  expectedY, expectedInitSwapParams, expectedCalcSwap,
  SETTINGS_DECIMALS
} from './utils';
import { 
  RedeemPool__factory, PToken__factory,
  StakingBribesPool__factory,
  AdhocBribesPool__factory,
  ERC4626__factory
} from "../typechain";
import { formatUnits, parseUnits } from 'ethers';
import { ERC20__factory } from '../typechain/factories/contracts/BQuery.sol';

const { provider } = ethers;

const BigNumber = require('bignumber.js');

describe('Yeet Bribe Vault', () => {

  it('Bribe Vault basic E2E works', async () => {
    const { protocol, settings, yeetVault, trifectaVault, yeetLp, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const pToken = PToken__factory.connect(await yeetVault.pToken(), ethers.provider);
    const yeetFeeBps = await trifectaVault.exitFeeBasisPoints();
    const maxYeetFeeBps = await trifectaVault._BASIS_POINT_SCALE();

    await settings.connect(Alice).updateVaultParamValue(await yeetVault.getAddress(), ethers.encodeBytes32String("D"), ONE_DAY_IN_SECS * 15); // 15 days
    await settings.connect(Alice).updateVaultParamValue(await yeetVault.getAddress(), ethers.encodeBytes32String("f1"), 10 ** 9); // 10%
    await settings.connect(Alice).updateVaultParamValue(await yeetVault.getAddress(), ethers.encodeBytes32String("f2"), 10 ** 9); // 10%
    const f2 = await yeetVault.paramValue(ethers.encodeBytes32String("f2"));

    await expect(yeetLp.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await yeetLp.decimals()))).not.to.be.reverted;
    await expect(yeetLp.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await yeetLp.decimals()))).not.to.be.reverted;
    await expect(yeetLp.connect(Alice).mint(Caro.address, ethers.parseUnits("1000000", await yeetLp.decimals()))).not.to.be.reverted;

    // PToken's decimals should be same to the underlying token
    expect(await pToken.decimals()).to.equal(await yeetLp.decimals());

    // No epochs initially
    expect(await yeetVault.epochIdCount()).to.equal(0);
    await expect(yeetVault.epochIdAt(0)).to.be.reverted; // OutOfBounds
    await expect(yeetVault.currentEpochId()).to.be.revertedWith("No epochs yet");
    await expect(yeetVault.epochInfoById(0)).to.be.revertedWith("Invalid epoch id");

    // Could not swap before any deposits
    await expect(yeetVault.connect(Alice).swap(100)).to.be.revertedWith("No principal tokens");

    // First deposit automaticaly starts a new epoch.
    // Alice deposits 1000 $yeetLp, Bob deposits 500 $yeetLp
    let aliceDepositAmount = ethers.parseUnits("1000", await yeetLp.decimals());
    await expect(yeetLp.connect(Alice).approve(await yeetVault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    let trans = await yeetVault.connect(Alice).deposit(aliceDepositAmount);
    let currentEpochId = 1;
    await expect(trans).to.changeTokenBalances(
      yeetLp,
      [Alice.address, await trifectaVault.getAddress()],
      [-aliceDepositAmount, aliceDepositAmount]
    );
    await expect(trans)
      .to.emit(yeetVault, "PTokenMinted").withArgs(Alice.address, aliceDepositAmount, aliceDepositAmount, anyValue)
      .to.emit(yeetVault, "YTokenDummyMinted").withArgs(currentEpochId, await yeetVault.getAddress(), aliceDepositAmount, aliceDepositAmount)
      .to.emit(yeetVault, "Deposit").withArgs(currentEpochId, Alice.address, aliceDepositAmount, aliceDepositAmount, aliceDepositAmount);

    let bobDepositAmount = ethers.parseUnits("500", await yeetLp.decimals());
    await expect(yeetLp.connect(Bob).approve(await yeetVault.getAddress(), bobDepositAmount)).not.to.be.reverted;
    await expect(yeetVault.connect(Bob).deposit(bobDepositAmount)).not.to.be.reverted;

    // check epoch
    let currentEpochDuration = ONE_DAY_IN_SECS * 15;  // default to 15 days
    let currentEpochStartTime = (await provider.getBlock(trans.blockHash!))?.timestamp;
    const genesisTime = currentEpochStartTime;
    expect(await yeetVault.epochIdCount()).to.equal(1);
    expect(await yeetVault.epochIdAt(0)).to.equal(currentEpochId);
    expect(await yeetVault.currentEpochId()).to.equal(currentEpochId);
    let currentEpoch = await yeetVault.epochInfoById(currentEpochId);
    expect(currentEpoch.startTime).to.equal(currentEpochStartTime);
    expect(currentEpoch.duration).to.equal(currentEpochDuration);

    // check pToken and yToken balance
    // expect(await yeetVault.assetBalance()).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await pToken.balanceOf(Alice.address)).to.equal(aliceDepositAmount);
    expect(await pToken.balanceOf(Bob.address)).to.equal(bobDepositAmount);
    expect(await pToken.totalSupply()).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await yeetVault.yTokenUserBalance(currentEpochId, Alice.address)).to.equal(0);
    expect(await yeetVault.yTokenUserBalance(currentEpochId, Bob.address)).to.equal(0);
    expect(await yeetVault.yTokenUserBalance(currentEpochId, await yeetVault.getAddress())).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await yeetVault.yTokenTotalSupply(currentEpochId)).to.equal(aliceDepositAmount + bobDepositAmount);
    
    // Alice redeem 100 $pToken; Bob redeem 50 $pToken
    const aliceRedeemAmount = ethers.parseUnits("100", await pToken.decimals());
    const bobRedeemAmount = ethers.parseUnits("50", await pToken.decimals());
    const redeemPool = RedeemPool__factory.connect(currentEpoch.redeemPool, ethers.provider);
    await expect(pToken.connect(Alice).approve(await redeemPool.getAddress(), aliceRedeemAmount)).not.to.be.reverted;
    await expect(redeemPool.connect(Alice).redeem(aliceRedeemAmount)).not.to.be.reverted;
    await expect(pToken.connect(Bob).approve(await redeemPool.getAddress(), bobRedeemAmount)).not.to.be.reverted;
    await expect(redeemPool.connect(Bob).redeem(bobRedeemAmount)).not.to.be.reverted;

    // Total deposit: 
    //   Alice 1000 $yeetLp; Bob 500 $yeetLp
    // 3 days later, Alice 'swap' 100 $yeetLp for yt. => $pt is rebased by 100/1500
    await time.increaseTo(genesisTime! + ONE_DAY_IN_SECS * 3);

    let aliceSwapAmount = ethers.parseUnits("100", await yeetLp.decimals());
    let aliceExpectedSwapResult = await expectedCalcSwap(yeetVault, 100, Number(await yeetLp.decimals()));  // 1463.1851649850014
    let aliceActualSwapResult = await yeetVault.calcSwap(aliceSwapAmount);
    expectBigNumberEquals(parseUnits(aliceExpectedSwapResult.X_updated + "", await yeetLp.decimals()), aliceActualSwapResult[0]);
    expectBigNumberEquals(parseUnits(aliceExpectedSwapResult.m + "", await yeetLp.decimals()), aliceActualSwapResult[1]);

    let fees = aliceSwapAmount * 10n / 100n;
    let netSwapAmount = aliceSwapAmount - fees;
    await expect(yeetLp.connect(Alice).approve(await yeetVault.getAddress(), aliceSwapAmount)).not.to.be.reverted;
    trans = await yeetVault.connect(Alice).swap(aliceSwapAmount);
    let aliceYTSwapTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    let aliceYTSwapAmount1 = await yeetVault.yTokenUserBalance(currentEpochId, Alice.address);
    await expect(trans).to.changeTokenBalances(
      yeetLp,
      [Alice.address, await settings.treasury(), await trifectaVault.getAddress()],
      [-aliceSwapAmount, fees, netSwapAmount]
    );
    await expect(trans)
      .to.emit(pToken, "Rebased").withArgs(netSwapAmount)
      .to.emit(yeetVault, "Swap").withArgs(currentEpochId, Alice.address, aliceSwapAmount, fees, netSwapAmount, anyValue);
    
    let erc4626TotalShares = await trifectaVault.totalSupply();
    console.log(`ERC4626 total shares: ${ethers.formatUnits(erc4626TotalShares, await trifectaVault.decimals())}`);
    let erc4626TotalAssets = await trifectaVault.totalAssets();
    console.log(`ERC4626 total assets: ${ethers.formatUnits(erc4626TotalAssets, await yeetLp.decimals())}`);
    let erc4626Shares = await trifectaVault.balanceOf(await yeetVault.getAddress());
    console.log(`B-Vault $ERC4626 shares: ${ethers.formatUnits(erc4626Shares, await trifectaVault.decimals())}`);

    // Add bribes
    const bribeAmountYeetLp = ethers.parseUnits("300", await yeetLp.decimals());
    await expect(yeetLp.connect(Alice).transfer(await trifectaVault.getAddress(), bribeAmountYeetLp)).not.to.be.reverted;

    console.log(`====== ERC4626 compounds yields ======`);
    erc4626TotalShares = await trifectaVault.totalSupply();
    console.log(`ERC4626 total shares: ${ethers.formatUnits(erc4626TotalShares, await trifectaVault.decimals())}`);
    erc4626TotalAssets = await trifectaVault.totalAssets();
    console.log(`ERC4626 total assets: ${ethers.formatUnits(erc4626TotalAssets, await yeetLp.decimals())}`);
    erc4626Shares = await trifectaVault.balanceOf(await yeetVault.getAddress());
    console.log(`B-Vault $ERC4626 shares: ${ethers.formatUnits(erc4626Shares, await trifectaVault.decimals())}`);

    // Bob swap 10 $yeetLp for yTokens, which triggers bribes claimed
    console.log("\n========= Another 11 days later, Bob swaps 10 $yeetLp for YTokens ===============");
    let swapAssetAmount = ethers.parseUnits("10", await yeetLp.decimals());
    let swapResult = await expectedCalcSwap(yeetVault, 10, Number(await yeetLp.decimals())); 
    let actualResult = await yeetVault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await yeetLp.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await yeetLp.decimals()), actualResult[1]);
    await expect(yeetLp.connect(Bob).approve(await yeetVault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await yeetVault.connect(Bob).swap(swapAssetAmount);
    let bobYTSwapTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    let bobYTSwapAmount1 = await yeetVault.yTokenUserBalance(currentEpochId, Bob.address);
    await expect(trans).to.changeTokenBalances(yeetLp, [Bob.address], [-swapAssetAmount]);

    erc4626TotalShares = await trifectaVault.totalSupply();
    console.log(`ERC4626 total shares: ${ethers.formatUnits(erc4626TotalShares, await trifectaVault.decimals())}`);
    erc4626TotalAssets = await trifectaVault.totalAssets();
    console.log(`ERC4626 total assets: ${ethers.formatUnits(erc4626TotalAssets, await yeetLp.decimals())}`);
    let erc4626SharesAfterSwap = await trifectaVault.balanceOf(await yeetVault.getAddress());
    console.log(`B-Vault $ERC4626 shares: ${ethers.formatUnits(erc4626Shares, await trifectaVault.decimals())}`);

    // 16 days later, epoch ends. 
    console.log("\n========= 16 days later, check bribes ===============");
    await time.increaseTo(genesisTime! + ONE_DAY_IN_SECS * 16);

    // Check YT balances
    const aliceYTokenBalance = await yeetVault.yTokenUserBalance(currentEpochId, Alice.address);
    const bobYTokenBalance = await yeetVault.yTokenUserBalance(currentEpochId, Bob.address);
    const vaultYTokenBalance = await yeetVault.yTokenUserBalance(currentEpochId, await yeetVault.getAddress());
    const totalYTokenBalance = await yeetVault.yTokenTotalSupply(currentEpochId);
    console.log(
      ethers.formatUnits(aliceYTokenBalance), ethers.formatUnits(bobYTokenBalance),
      ethers.formatUnits(vaultYTokenBalance), ethers.formatUnits(totalYTokenBalance)
    );
    expectBigNumberEquals(aliceYTokenBalance + bobYTokenBalance + vaultYTokenBalance, totalYTokenBalance);

    let epochInfo = await yeetVault.epochInfoById(currentEpochId);
    let stakingBribesPool = StakingBribesPool__factory.connect(epochInfo.stakingBribesPool, ethers.provider);
    let adhocBribesPool = AdhocBribesPool__factory.connect(epochInfo.adhocBribesPool, ethers.provider);

    expect(await stakingBribesPool.balanceOf(Alice.address)).to.equal(aliceYTokenBalance);
    expect(await stakingBribesPool.balanceOf(Bob.address)).to.equal(bobYTokenBalance);
    expect(await stakingBribesPool.totalSupply()).to.equal(aliceYTokenBalance + bobYTokenBalance);

    let vaultBribesERC4626SharesAmount = await trifectaVault.balanceOf(await stakingBribesPool.getAddress());
    const expectedAliceBribesYeetLp = vaultBribesERC4626SharesAmount * aliceYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);
    const expectedBobBribesYeetLp = vaultBribesERC4626SharesAmount * bobYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);

    let actualAliceBribes = await stakingBribesPool.earned(Alice.address, await trifectaVault.getAddress());
    let actualBobBribes = await stakingBribesPool.earned(Bob.address, await trifectaVault.getAddress());
    expectBigNumberEquals(actualAliceBribes, expectedAliceBribesYeetLp);
    expectBigNumberEquals(actualBobBribes, expectedBobBribesYeetLp);

    console.log("\n========= Alice claimed bribes ===============");

    trans = await stakingBribesPool.connect(Alice).getBribes();
    await expect(trans)
      .to.emit(stakingBribesPool, 'BribesPaid').withArgs(Alice.address, await trifectaVault.getAddress(), actualAliceBribes);
    await expect(trans).to.changeTokenBalances(
      trifectaVault,
      [Alice.address, await stakingBribesPool.getAddress()],
      [actualAliceBribes, -actualAliceBribes]
    );

    // Alice add Bob as briber
    const brbToken2 = await makeToken(await protocol.getAddress(), "Bribe Token", "BRB2");
    await expect(brbToken2.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await brbToken2.decimals()))).not.to.be.reverted;
    let bribeAmountBRB2 = ethers.parseUnits("2000", await brbToken2.decimals());
    await expect(brbToken2.connect(Bob).approve(await yeetVault.getAddress(), bribeAmountBRB2)).not.to.be.reverted;
    await expect(yeetVault.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2)).to.be.revertedWith(/Not owner or briber/);

    // Bob add adhoc bribes
    console.log("\n========= Bob add $BRB2 bribes ===============");
    await expect(yeetVault.connect(Alice).setBriber(Bob.address, true))
      .to.emit(yeetVault, "UpdateBriber").withArgs(Bob.address, true);
    await expect(yeetVault.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2)).to.be.revertedWith(/Cannot add bribes without YT staked/);

    // Alice & Bob collect YT to AdhocBribesPool
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
    trans = await yeetVault.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2);
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
    let redeemPoolPtBalanceBeforeSettlement = await pToken.balanceOf(await redeemPool.getAddress());
    console.log(`Redeem Pool pToken balance before settlement: ${formatUnits(redeemPoolPtBalanceBeforeSettlement, await pToken.decimals())}`);

    let aliceDepositAmount2 = ethers.parseUnits("1", await yeetLp.decimals());
    await expect(yeetLp.connect(Alice).approve(await yeetVault.getAddress(), aliceDepositAmount2)).not.to.be.reverted;
    await expect(yeetVault.connect(Alice).deposit(aliceDepositAmount2)).not.to.be.reverted;
    
    // Redeem Pool should be settled
    expect(await redeemPool.settled()).to.equal(true);
    let redeemPoolPtBalance = await pToken.balanceOf(await redeemPool.getAddress());
    console.log(`Redeem Pool pToken balance after settlement: ${formatUnits(redeemPoolPtBalance, await pToken.decimals())}`);
    
    const redeemAsset = ERC4626__factory.connect(await redeemPool.assetToken(), ethers.provider);
    const redeemPoolAssetBalance = await redeemAsset.balanceOf(await redeemPool.getAddress());
    console.log(`Redeem Pool redeem asset balance: ${formatUnits(redeemPoolAssetBalance, await redeemAsset.decimals())}`);
    // expect(redeemPoolAssetBalance).to.equal(redeemPoolPtBalanceBeforeSettlement);

    const aliceEarnedAsset = await redeemPool.earnedAssetAmount(Alice.address);
    const expectedAliceEarnedAsset = redeemPoolAssetBalance * 2n / 3n;
    expect(aliceEarnedAsset).to.equal(expectedAliceEarnedAsset);

    fees = aliceEarnedAsset * 10n / 100n;
    let netAmount = aliceEarnedAsset - fees;
    trans = await redeemPool.connect(Alice).claimAssetToken();
    await expect(trans).to.changeTokenBalances(
      redeemAsset,
      [Alice.address, await settings.treasury(), await redeemPool.getAddress()],
      [netAmount, fees, -aliceEarnedAsset]
    );
    await expect(trans).to.emit(redeemPool, "AssetTokenClaimed").withArgs(Alice.address, aliceEarnedAsset, netAmount, fees);

    // Alice closes yeetVault
    console.log("\n========= Alice closes yeetVault ===============");
    let yeetLpBalanceBeforeClose = await yeetLp.balanceOf(await yeetVault.getAddress());
    expect(yeetLpBalanceBeforeClose).to.equal(0);
    console.log(`$yeetLp balance before close: ${formatUnits(yeetLpBalanceBeforeClose, await yeetLp.decimals())}`);
    await expect(yeetVault.connect(Alice).close())
      .to.emit(yeetVault, "Closed").withArgs();
    let iBGTBalanceAfterClose = await yeetLp.balanceOf(await yeetVault.getAddress());
    console.log(`$yeetLp balance after close: ${formatUnits(iBGTBalanceAfterClose, await yeetLp.decimals())}`);

    let pTokenTotalSupply = await pToken.totalSupply();
    let alicePTokenBalance = await pToken.balanceOf(Alice.address);
    let bobPTokenBalance = await pToken.balanceOf(Bob.address);
    console.log(`$pToken total supply: ${formatUnits(pTokenTotalSupply, await pToken.decimals())}`);
    console.log(`Alice $pToken balance: ${formatUnits(alicePTokenBalance, await pToken.decimals())}`);
    console.log(`Bob $pToken balance: ${formatUnits(bobPTokenBalance, await pToken.decimals())}`);

    erc4626Shares = await trifectaVault.balanceOf(await yeetVault.getAddress());
    console.log(`B-Vault $ERC4626 shares: ${ethers.formatUnits(erc4626Shares, await trifectaVault.decimals())}`);

    // Could not deposit or swap after yeetVault is closed
    await expect(yeetVault.connect(Alice).deposit(100)).to.be.reverted;
    await expect(yeetVault.connect(Alice).swap(100)).to.be.reverted;

    // Alice and Bob get their $yeetLp back
    console.log("\n========= Alice and Bob get their ERC4626 shares back ===============");
    await expect(yeetVault.connect(Alice).redeem(alicePTokenBalance * 2n)).to.be.reverted;
    trans = await yeetVault.connect(Alice).redeem(alicePTokenBalance);
    // await expect(trans).to.changeTokenBalances(
    //   pToken,
    //   [Alice.address],
    //   [-alicePTokenBalance]
    // );

    let aliceERC4626Shares = erc4626Shares * alicePTokenBalance / pTokenTotalSupply;
    await expect(trans).to.changeTokenBalances(
      trifectaVault,
      [Alice.address],
      [aliceERC4626Shares]
    );
    await expect(trans)
      .to.emit(yeetVault, "Redeem").withArgs(Alice.address, alicePTokenBalance, anyValue);
  });

  it('Bribe Vault with assets other than 18 decimals basic E2E works', async () => {
    const { protocol, settings, yeetVault8, trifectaVault8, yeetLp8, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const pToken = PToken__factory.connect(await yeetVault8.pToken(), ethers.provider);
    const yeetFeeBps = await trifectaVault8.exitFeeBasisPoints();
    const maxYeetFeeBps = await trifectaVault8._BASIS_POINT_SCALE();

    await settings.connect(Alice).updateVaultParamValue(await yeetVault8.getAddress(), ethers.encodeBytes32String("D"), ONE_DAY_IN_SECS * 15); // 15 days
    await settings.connect(Alice).updateVaultParamValue(await yeetVault8.getAddress(), ethers.encodeBytes32String("f1"), 10 ** 9); // 10%
    await settings.connect(Alice).updateVaultParamValue(await yeetVault8.getAddress(), ethers.encodeBytes32String("f2"), 10 ** 9); // 10%
    const f2 = await yeetVault8.paramValue(ethers.encodeBytes32String("f2"));

    await expect(yeetLp8.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await yeetLp8.decimals()))).not.to.be.reverted;
    await expect(yeetLp8.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await yeetLp8.decimals()))).not.to.be.reverted;
    await expect(yeetLp8.connect(Alice).mint(Caro.address, ethers.parseUnits("1000000", await yeetLp8.decimals()))).not.to.be.reverted;

    // PToken's decimals should be same to the underlying token
    expect(await pToken.decimals()).to.equal(await yeetLp8.decimals());

    // No epochs initially
    expect(await yeetVault8.epochIdCount()).to.equal(0);
    await expect(yeetVault8.epochIdAt(0)).to.be.reverted; // OutOfBounds
    await expect(yeetVault8.currentEpochId()).to.be.revertedWith("No epochs yet");
    await expect(yeetVault8.epochInfoById(0)).to.be.revertedWith("Invalid epoch id");

    // Could not swap before any deposits
    await expect(yeetVault8.connect(Alice).swap(100)).to.be.revertedWith("No principal tokens");

    // First deposit automaticaly starts a new epoch.
    // Alice deposits 1000 $yeetLp, Bob deposits 500 $yeetLp
    let aliceDepositAmount = ethers.parseUnits("1000", await yeetLp8.decimals());
    await expect(yeetLp8.connect(Alice).approve(await yeetVault8.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    let trans = await yeetVault8.connect(Alice).deposit(aliceDepositAmount);
    let currentEpochId = 1;
    await expect(trans).to.changeTokenBalances(
      yeetLp8,
      [Alice.address, await trifectaVault8.getAddress()],
      [-aliceDepositAmount, aliceDepositAmount]
    );
    await expect(trans)
      .to.emit(yeetVault8, "PTokenMinted").withArgs(Alice.address, aliceDepositAmount, aliceDepositAmount, anyValue)
      .to.emit(yeetVault8, "YTokenDummyMinted").withArgs(currentEpochId, await yeetVault8.getAddress(), aliceDepositAmount, aliceDepositAmount)
      .to.emit(yeetVault8, "Deposit").withArgs(currentEpochId, Alice.address, aliceDepositAmount, aliceDepositAmount, aliceDepositAmount);

    let bobDepositAmount = ethers.parseUnits("500", await yeetLp8.decimals());
    await expect(yeetLp8.connect(Bob).approve(await yeetVault8.getAddress(), bobDepositAmount)).not.to.be.reverted;
    await expect(yeetVault8.connect(Bob).deposit(bobDepositAmount)).not.to.be.reverted;

    // check epoch
    let currentEpochDuration = ONE_DAY_IN_SECS * 15;  // default to 15 days
    let currentEpochStartTime = (await provider.getBlock(trans.blockHash!))?.timestamp;
    const genesisTime = currentEpochStartTime;
    expect(await yeetVault8.epochIdCount()).to.equal(1);
    expect(await yeetVault8.epochIdAt(0)).to.equal(currentEpochId);
    expect(await yeetVault8.currentEpochId()).to.equal(currentEpochId);
    let currentEpoch = await yeetVault8.epochInfoById(currentEpochId);
    expect(currentEpoch.startTime).to.equal(currentEpochStartTime);
    expect(currentEpoch.duration).to.equal(currentEpochDuration);

    // check pToken and yToken balance
    // expect(await yeetVault.assetBalance()).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await pToken.balanceOf(Alice.address)).to.equal(aliceDepositAmount);
    expect(await pToken.balanceOf(Bob.address)).to.equal(bobDepositAmount);
    expect(await pToken.totalSupply()).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await yeetVault8.yTokenUserBalance(currentEpochId, Alice.address)).to.equal(0);
    expect(await yeetVault8.yTokenUserBalance(currentEpochId, Bob.address)).to.equal(0);
    expect(await yeetVault8.yTokenUserBalance(currentEpochId, await yeetVault8.getAddress())).to.equal(aliceDepositAmount + bobDepositAmount);
    expect(await yeetVault8.yTokenTotalSupply(currentEpochId)).to.equal(aliceDepositAmount + bobDepositAmount);
    
    // Alice redeem 100 $pToken; Bob redeem 50 $pToken
    const aliceRedeemAmount = ethers.parseUnits("100", await pToken.decimals());
    const bobRedeemAmount = ethers.parseUnits("50", await pToken.decimals());
    const redeemPool = RedeemPool__factory.connect(currentEpoch.redeemPool, ethers.provider);
    await expect(pToken.connect(Alice).approve(await redeemPool.getAddress(), aliceRedeemAmount)).not.to.be.reverted;
    await expect(redeemPool.connect(Alice).redeem(aliceRedeemAmount)).not.to.be.reverted;
    await expect(pToken.connect(Bob).approve(await redeemPool.getAddress(), bobRedeemAmount)).not.to.be.reverted;
    await expect(redeemPool.connect(Bob).redeem(bobRedeemAmount)).not.to.be.reverted;

    // Total deposit: 
    //   Alice 1000 $yeetLp; Bob 500 $yeetLp
    // 3 days later, Alice 'swap' 100 $yeetLp for yt. => $pt is rebased by 100/1500
    await time.increaseTo(genesisTime! + ONE_DAY_IN_SECS * 3);

    let aliceSwapAmount = ethers.parseUnits("100", await yeetLp8.decimals());
    let aliceExpectedSwapResult = await expectedCalcSwap(yeetVault8, 100, Number(await yeetLp8.decimals()));  // 1463.1851649850014
    let aliceActualSwapResult = await yeetVault8.calcSwap(aliceSwapAmount);
    expectBigNumberEquals(parseUnits(aliceExpectedSwapResult.X_updated.toFixed(Number(await yeetLp8.decimals())) + "", await yeetLp8.decimals()), aliceActualSwapResult[0]);
    expectBigNumberEquals(parseUnits(aliceExpectedSwapResult.m.toFixed(Number(await yeetLp8.decimals())) + "", await yeetLp8.decimals()), aliceActualSwapResult[1]);

    let fees = aliceSwapAmount * 10n / 100n;
    let netSwapAmount = aliceSwapAmount - fees;
    await expect(yeetLp8.connect(Alice).approve(await yeetVault8.getAddress(), aliceSwapAmount)).not.to.be.reverted;
    trans = await yeetVault8.connect(Alice).swap(aliceSwapAmount);
    let aliceYTSwapTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    let aliceYTSwapAmount1 = await yeetVault8.yTokenUserBalance(currentEpochId, Alice.address);
    await expect(trans).to.changeTokenBalances(
      yeetLp8,
      [Alice.address, await settings.treasury(), await trifectaVault8.getAddress()],
      [-aliceSwapAmount, fees, netSwapAmount]
    );
    await expect(trans)
      .to.emit(pToken, "Rebased").withArgs(netSwapAmount)
      .to.emit(yeetVault8, "Swap").withArgs(currentEpochId, Alice.address, aliceSwapAmount, fees, netSwapAmount, anyValue);
    
    let erc4626TotalShares = await trifectaVault8.totalSupply();
    console.log(`ERC4626 total shares: ${ethers.formatUnits(erc4626TotalShares, await trifectaVault8.decimals())}`);
    let erc4626TotalAssets = await trifectaVault8.totalAssets();
    console.log(`ERC4626 total assets: ${ethers.formatUnits(erc4626TotalAssets, await yeetLp8.decimals())}`);
    let erc4626Shares = await trifectaVault8.balanceOf(await yeetVault8.getAddress());
    console.log(`B-Vault $ERC4626 shares: ${ethers.formatUnits(erc4626Shares, await trifectaVault8.decimals())}`);

    // Add bribes
    const bribeAmountYeetLp = ethers.parseUnits("300", await yeetLp8.decimals());
    await expect(yeetLp8.connect(Alice).transfer(await trifectaVault8.getAddress(), bribeAmountYeetLp)).not.to.be.reverted;

    console.log(`====== ERC4626 compounds yields ======`);
    erc4626TotalShares = await trifectaVault8.totalSupply();
    console.log(`ERC4626 total shares: ${ethers.formatUnits(erc4626TotalShares, await trifectaVault8.decimals())}`);
    erc4626TotalAssets = await trifectaVault8.totalAssets();
    console.log(`ERC4626 total assets: ${ethers.formatUnits(erc4626TotalAssets, await yeetLp8.decimals())}`);
    erc4626Shares = await trifectaVault8.balanceOf(await yeetVault8.getAddress());
    console.log(`B-Vault $ERC4626 shares: ${ethers.formatUnits(erc4626Shares, await trifectaVault8.decimals())}`);

    // Bob swap 10 $yeetLp for yTokens, which triggers bribes claimed
    console.log("\n========= Another 11 days later, Bob swaps 10 $yeetLp for YTokens ===============");
    let swapAssetAmount = ethers.parseUnits("10", await yeetLp8.decimals());
    let swapResult = await expectedCalcSwap(yeetVault8, 10, Number(await yeetLp8.decimals())); 
    let actualResult = await yeetVault8.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated.toFixed(Number(await yeetLp8.decimals())), await yeetLp8.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m.toFixed(Number(await yeetLp8.decimals())), await yeetLp8.decimals()), actualResult[1]);
    await expect(yeetLp8.connect(Bob).approve(await yeetVault8.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await yeetVault8.connect(Bob).swap(swapAssetAmount);
    let bobYTSwapTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    let bobYTSwapAmount1 = await yeetVault8.yTokenUserBalance(currentEpochId, Bob.address);
    await expect(trans).to.changeTokenBalances(yeetLp8, [Bob.address], [-swapAssetAmount]);

    erc4626TotalShares = await trifectaVault8.totalSupply();
    console.log(`ERC4626 total shares: ${ethers.formatUnits(erc4626TotalShares, await trifectaVault8.decimals())}`);
    erc4626TotalAssets = await trifectaVault8.totalAssets();
    console.log(`ERC4626 total assets: ${ethers.formatUnits(erc4626TotalAssets, await yeetLp8.decimals())}`);
    let erc4626SharesAfterSwap = await trifectaVault8.balanceOf(await yeetVault8.getAddress());
    console.log(`B-Vault $ERC4626 shares: ${ethers.formatUnits(erc4626Shares, await trifectaVault8.decimals())}`);

    // 16 days later, epoch ends. 
    console.log("\n========= 16 days later, check bribes ===============");
    await time.increaseTo(genesisTime! + ONE_DAY_IN_SECS * 16);

    // Check YT balances
    const aliceYTokenBalance = await yeetVault8.yTokenUserBalance(currentEpochId, Alice.address);
    const bobYTokenBalance = await yeetVault8.yTokenUserBalance(currentEpochId, Bob.address);
    const vaultYTokenBalance = await yeetVault8.yTokenUserBalance(currentEpochId, await yeetVault8.getAddress());
    const totalYTokenBalance = await yeetVault8.yTokenTotalSupply(currentEpochId);
    console.log(
      ethers.formatUnits(aliceYTokenBalance), ethers.formatUnits(bobYTokenBalance),
      ethers.formatUnits(vaultYTokenBalance), ethers.formatUnits(totalYTokenBalance)
    );
    expectBigNumberEquals(aliceYTokenBalance + bobYTokenBalance + vaultYTokenBalance, totalYTokenBalance);

    let epochInfo = await yeetVault8.epochInfoById(currentEpochId);
    let stakingBribesPool = StakingBribesPool__factory.connect(epochInfo.stakingBribesPool, ethers.provider);
    let adhocBribesPool = AdhocBribesPool__factory.connect(epochInfo.adhocBribesPool, ethers.provider);

    expect(await stakingBribesPool.balanceOf(Alice.address)).to.equal(aliceYTokenBalance);
    expect(await stakingBribesPool.balanceOf(Bob.address)).to.equal(bobYTokenBalance);
    expect(await stakingBribesPool.totalSupply()).to.equal(aliceYTokenBalance + bobYTokenBalance);

    let vaultBribesERC4626SharesAmount = await trifectaVault8.balanceOf(await stakingBribesPool.getAddress());
    const expectedAliceBribesYeetLp = vaultBribesERC4626SharesAmount * aliceYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);
    const expectedBobBribesYeetLp = vaultBribesERC4626SharesAmount * bobYTokenBalance / (aliceYTokenBalance + bobYTokenBalance);

    let actualAliceBribes = await stakingBribesPool.earned(Alice.address, await trifectaVault8.getAddress());
    let actualBobBribes = await stakingBribesPool.earned(Bob.address, await trifectaVault8.getAddress());
    expectBigNumberEquals(actualAliceBribes, expectedAliceBribesYeetLp);
    expectBigNumberEquals(actualBobBribes, expectedBobBribesYeetLp);

    console.log("\n========= Alice claimed bribes ===============");

    trans = await stakingBribesPool.connect(Alice).getBribes();
    await expect(trans)
      .to.emit(stakingBribesPool, 'BribesPaid').withArgs(Alice.address, await trifectaVault8.getAddress(), actualAliceBribes);
    await expect(trans).to.changeTokenBalances(
      trifectaVault8,
      [Alice.address, await stakingBribesPool.getAddress()],
      [actualAliceBribes, -actualAliceBribes]
    );

    // Alice add Bob as briber
    const brbToken2 = await makeToken(await protocol.getAddress(), "Bribe Token", "BRB2");
    await expect(brbToken2.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await brbToken2.decimals()))).not.to.be.reverted;
    let bribeAmountBRB2 = ethers.parseUnits("2000", await brbToken2.decimals());
    await expect(brbToken2.connect(Bob).approve(await yeetVault8.getAddress(), bribeAmountBRB2)).not.to.be.reverted;
    await expect(yeetVault8.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2)).to.be.revertedWith(/Not owner or briber/);

    // Bob add adhoc bribes
    console.log("\n========= Bob add $BRB2 bribes ===============");
    await expect(yeetVault8.connect(Alice).setBriber(Bob.address, true))
      .to.emit(yeetVault8, "UpdateBriber").withArgs(Bob.address, true);
    await expect(yeetVault8.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2)).to.be.revertedWith(/Cannot add bribes without YT staked/);

    // Alice & Bob collect YT to AdhocBribesPool
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
    trans = await yeetVault8.connect(Bob).addAdhocBribes(await brbToken2.getAddress(), bribeAmountBRB2);
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

    // Alice closes yeetVault
    console.log("\n========= Alice closes yeetVault ===============");
    let yeetLpBalanceBeforeClose = await yeetLp8.balanceOf(await yeetVault8.getAddress());
    expect(yeetLpBalanceBeforeClose).to.equal(0);
    console.log(`$yeetLp balance before close: ${formatUnits(yeetLpBalanceBeforeClose, await yeetLp8.decimals())}`);
    await expect(yeetVault8.connect(Alice).close())
      .to.emit(yeetVault8, "Closed").withArgs();
    let iBGTBalanceAfterClose = await yeetLp8.balanceOf(await yeetVault8.getAddress());
    console.log(`$yeetLp balance after close: ${formatUnits(iBGTBalanceAfterClose, await yeetLp8.decimals())}`);

    let pTokenTotalSupply = await pToken.totalSupply();
    let alicePTokenBalance = await pToken.balanceOf(Alice.address);
    let bobPTokenBalance = await pToken.balanceOf(Bob.address);
    console.log(`$pToken total supply: ${formatUnits(pTokenTotalSupply, await pToken.decimals())}`);
    console.log(`Alice $pToken balance: ${formatUnits(alicePTokenBalance, await pToken.decimals())}`);
    console.log(`Bob $pToken balance: ${formatUnits(bobPTokenBalance, await pToken.decimals())}`);

    erc4626Shares = await trifectaVault8.balanceOf(await yeetVault8.getAddress());
    console.log(`B-Vault $ERC4626 shares: ${ethers.formatUnits(erc4626Shares, await trifectaVault8.decimals())}`);

    // Could not deposit or swap after yeetVault is closed
    await expect(yeetVault8.connect(Alice).deposit(100)).to.be.reverted;
    await expect(yeetVault8.connect(Alice).swap(100)).to.be.reverted;

    // Alice and Bob get their $yeetLp back
    console.log("\n========= Alice and Bob get their ERC4626 shares back ===============");
    await expect(yeetVault8.connect(Alice).redeem(alicePTokenBalance * 2n)).to.be.reverted;
    trans = await yeetVault8.connect(Alice).redeem(alicePTokenBalance);
    await expect(trans).to.changeTokenBalances(
      pToken,
      [Alice.address],
      [-alicePTokenBalance]
    );

    let aliceERC4626Shares = erc4626Shares * alicePTokenBalance / pTokenTotalSupply;
    await expect(trans).to.changeTokenBalances(
      trifectaVault8,
      [Alice.address],
      [aliceERC4626Shares]
    );
    await expect(trans)
      .to.emit(yeetVault8, "Redeem").withArgs(Alice.address, alicePTokenBalance, anyValue);
  });

  it('Swap works', async () => {
    const { protocol, settings, yeetVault, trifectaVault, yeetLp, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const pToken = PToken__factory.connect(await yeetVault.pToken(), ethers.provider);

    await settings.connect(Alice).updateVaultParamValue(await yeetVault.getAddress(), ethers.encodeBytes32String("D"), ONE_DAY_IN_SECS * 15); // 15 days
    await settings.connect(Alice).updateVaultParamValue(await yeetVault.getAddress(), ethers.encodeBytes32String("f1"), 0);
    await settings.connect(Alice).updateVaultParamValue(await yeetVault.getAddress(), ethers.encodeBytes32String("f2"), 0);

    await expect(yeetLp.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await yeetLp.decimals()))).not.to.be.reverted;
    await expect(yeetLp.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await yeetLp.decimals()))).not.to.be.reverted;
    await expect(yeetLp.connect(Alice).mint(Caro.address, ethers.parseUnits("1000000", await yeetLp.decimals()))).not.to.be.reverted;

    // First deposit automaticaly starts a new epoch.
    // Alice deposits 1000 $yeetLp
    const genesisTime = await time.latest();
    let aliceDepositAmount = ethers.parseUnits("1000", await yeetLp.decimals());
    await expect(yeetLp.connect(Alice).approve(await yeetVault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(yeetVault.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    let epochId = 1;
    let result = await expectedInitSwapParams(yeetVault, 1000);
    let actualX = await yeetVault.epochNextSwapX(epochId);
    let actualK0 = await yeetVault.epochNextSwapK0(epochId);
    expectBigNumberEquals(parseUnits(result.X + "", await yeetLp.decimals()), actualX);
    expectBigNumberEquals(parseUnits(result.k0 + "", await yeetLp.decimals() + await yeetLp.decimals()), actualK0);

    // check Y
    let actualY = await yeetVault.Y();
    let expectedYValue = await expectedY(yeetVault);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 1 hour later, Bob swaps 10 $yeetLp for yTokens
    console.log("\n========= Bob swaps 10 $yeetLp for YTokens ===============");

    await time.increaseTo(genesisTime + 3600);
    let swapAssetAmount = ethers.parseUnits("10", await yeetLp.decimals());
    let swapResult = await expectedCalcSwap(yeetVault, 10, Number(await yeetLp.decimals()));  // m = 124.93874956948082
    let actualResult = await yeetVault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await yeetLp.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await yeetLp.decimals()), actualResult[1]);

    console.log(`k0 before swap: ${await yeetVault.epochNextSwapK0(epochId)}`);
    await expect(yeetLp.connect(Bob).approve(await yeetVault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    let trans = await yeetVault.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(yeetLp, [Bob.address, await trifectaVault.getAddress()], [-swapAssetAmount, swapAssetAmount]);
    await expect(trans)
      .to.emit(pToken, "Rebased").withArgs(swapAssetAmount)
      .to.emit(yeetVault, "Swap").withArgs(epochId, Bob.address, swapAssetAmount, 0, swapAssetAmount, anyValue);

    // k0 not changed.
    let yTokenBalance = await yeetVault.yTokenUserBalance(epochId, await yeetVault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp.decimals())}`);  // 875.051905567315190927
    console.log(`k0 after swap: ${await yeetVault.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await yeetVault.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await yeetVault.Y();
    expectedYValue = await expectedY(yeetVault);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 1 day later, Bob swaps another 20 $yeetLp for yTokens
    console.log("\n========= Bob swaps 10 $yeetLp for YTokens ===============");
    await time.increaseTo(genesisTime + 3600 * 10);
    swapAssetAmount = ethers.parseUnits("10", await yeetLp.decimals());
    swapResult = await expectedCalcSwap(yeetVault, 10, Number(await yeetLp.decimals()));  // 230.59904938282182
    actualResult = await yeetVault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await yeetLp.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await yeetLp.decimals()), actualResult[1]);

    await expect(yeetLp.connect(Bob).approve(await yeetVault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await yeetVault.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(yeetLp, [Bob.address, await trifectaVault.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    // k not changed.
    yTokenBalance = await yeetVault.yTokenUserBalance(epochId, await yeetVault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp.decimals())}`);  // 644.444278692315151251
    console.log(`k0: ${await yeetVault.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await yeetVault.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await yeetVault.Y();
    expectedYValue = await expectedY(yeetVault);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 10 days later, Alice deposits 100 $yeetLp, k0 is updated
    console.log("\n========= Alice deposits 100 $yeetLp ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 10);
    aliceDepositAmount = ethers.parseUnits("100", await yeetLp.decimals());
    await expect(yeetLp.connect(Alice).approve(await yeetVault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(yeetVault.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    yTokenBalance = await yeetVault.yTokenUserBalance(epochId, await yeetVault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp.decimals())}`);  // 744.444278692315151251
    console.log(`k0: ${await yeetVault.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await yeetVault.epochNextSwapX(epochId)}`);

    console.log("\n========= Bob swaps 10 $yeetLp for YTokens ===============");
    swapAssetAmount = ethers.parseUnits("10", await yeetLp.decimals());
    swapResult = await expectedCalcSwap(yeetVault, 10, Number(await yeetLp.decimals()));  // 720.3778524226619
    actualResult = await yeetVault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await yeetLp.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await yeetLp.decimals()), actualResult[1]);

    await expect(yeetLp.connect(Bob).approve(await yeetVault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await yeetVault.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(yeetLp, [Bob.address, await trifectaVault.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    yTokenBalance = await yeetVault.yTokenUserBalance(epochId, await yeetVault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp.decimals())}`);  // 24.066323587412834713
    console.log(`k0: ${await yeetVault.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await yeetVault.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await yeetVault.Y();
    expectedYValue = await expectedY(yeetVault);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 16 days later, Alice deposits 1000 $yeetLp, and starts a new epoch
    console.log("\n========= Alice deposits 1000 $yeetLp to start epoch 2 ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 16);

    aliceDepositAmount = ethers.parseUnits("1000", await yeetLp.decimals());
    await expect(yeetLp.connect(Alice).approve(await yeetVault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(yeetVault.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    epochId = 2;
    expect(await yeetVault.currentEpochId()).to.equal(epochId);

    yTokenBalance = await yeetVault.yTokenUserBalance(epochId, await yeetVault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp.decimals())}`);    // 

    // check Y
    actualY = await yeetVault.Y();
    expectedYValue = await expectedY(yeetVault);
    expectNumberEquals(expectedYValue, Number(actualY));
  });

  it('Swap with assets other than 18 decimals works', async () => {
    const { protocol, settings, yeetVault8, trifectaVault8, yeetLp8, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const pToken = PToken__factory.connect(await yeetVault8.pToken(), ethers.provider);

    await settings.connect(Alice).updateVaultParamValue(await yeetVault8.getAddress(), ethers.encodeBytes32String("D"), ONE_DAY_IN_SECS * 15); // 15 days
    await settings.connect(Alice).updateVaultParamValue(await yeetVault8.getAddress(), ethers.encodeBytes32String("f1"), 0);
    await settings.connect(Alice).updateVaultParamValue(await yeetVault8.getAddress(), ethers.encodeBytes32String("f2"), 0);

    await expect(yeetLp8.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await yeetLp8.decimals()))).not.to.be.reverted;
    await expect(yeetLp8.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await yeetLp8.decimals()))).not.to.be.reverted;
    await expect(yeetLp8.connect(Alice).mint(Caro.address, ethers.parseUnits("1000000", await yeetLp8.decimals()))).not.to.be.reverted;

    // First deposit automaticaly starts a new epoch.
    // Alice deposits 1000 $yeetLp
    const genesisTime = await time.latest();
    let aliceDepositAmount = ethers.parseUnits("1000", await yeetLp8.decimals());
    await expect(yeetLp8.connect(Alice).approve(await yeetVault8.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(yeetVault8.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    let epochId = 1;
    let result = await expectedInitSwapParams(yeetVault8, 1000);
    let actualX = await yeetVault8.epochNextSwapX(epochId);
    let actualK0 = await yeetVault8.epochNextSwapK0(epochId);
    expectBigNumberEquals(parseUnits(result.X + "", await yeetLp8.decimals()), actualX);
    expectBigNumberEquals(parseUnits(result.k0 + "", await yeetLp8.decimals() + await yeetLp8.decimals()), actualK0);

    // check Y
    let actualY = await yeetVault8.Y();
    let expectedYValue = await expectedY(yeetVault8);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 1 hour later, Bob swaps 10 $yeetLp for yTokens
    console.log("\n========= Bob swaps 10 $yeetLp for YTokens ===============");

    await time.increaseTo(genesisTime + 3600);
    let swapAssetAmount = ethers.parseUnits("10", await yeetLp8.decimals());
    let swapResult = await expectedCalcSwap(yeetVault8, 10, Number(await yeetLp8.decimals()));  // m = 124.93874956948082
    let actualResult = await yeetVault8.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated.toFixed(Number(await yeetLp8.decimals())), await yeetLp8.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m.toFixed(Number(await yeetLp8.decimals())), await yeetLp8.decimals()), actualResult[1]);

    console.log(`k0 before swap: ${await yeetVault8.epochNextSwapK0(epochId)}`);
    await expect(yeetLp8.connect(Bob).approve(await yeetVault8.getAddress(), swapAssetAmount)).not.to.be.reverted;
    let trans = await yeetVault8.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(yeetLp8, [Bob.address, await trifectaVault8.getAddress()], [-swapAssetAmount, swapAssetAmount]);
    await expect(trans)
      .to.emit(pToken, "Rebased").withArgs(swapAssetAmount)
      .to.emit(yeetVault8, "Swap").withArgs(epochId, Bob.address, swapAssetAmount, 0, swapAssetAmount, anyValue);

    // k0 not changed.
    let yTokenBalance = await yeetVault8.yTokenUserBalance(epochId, await yeetVault8.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp8.decimals())}`);  // 875.051905567315190927
    console.log(`k0 after swap: ${await yeetVault8.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await yeetVault8.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await yeetVault8.Y();
    expectedYValue = await expectedY(yeetVault8);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 1 day later, Bob swaps another 20 $yeetLp for yTokens
    console.log("\n========= Bob swaps 10 $yeetLp for YTokens ===============");
    await time.increaseTo(genesisTime + 3600 * 10);
    swapAssetAmount = ethers.parseUnits("10", await yeetLp8.decimals());
    swapResult = await expectedCalcSwap(yeetVault8, 10, Number(await yeetLp8.decimals()));  // 230.59904938282182
    actualResult = await yeetVault8.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated.toFixed(Number(await yeetLp8.decimals())), await yeetLp8.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m.toFixed(Number(await yeetLp8.decimals())), await yeetLp8.decimals()), actualResult[1]);

    await expect(yeetLp8.connect(Bob).approve(await yeetVault8.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await yeetVault8.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(yeetLp8, [Bob.address, await trifectaVault8.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    // k not changed.
    yTokenBalance = await yeetVault8.yTokenUserBalance(epochId, await yeetVault8.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp8.decimals())}`);  // 644.444278692315151251
    console.log(`k0: ${await yeetVault8.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await yeetVault8.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await yeetVault8.Y();
    expectedYValue = await expectedY(yeetVault8);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 10 days later, Alice deposits 100 $yeetLp, k0 is updated
    console.log("\n========= Alice deposits 100 $yeetLp ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 10);
    aliceDepositAmount = ethers.parseUnits("100", await yeetLp8.decimals());
    await expect(yeetLp8.connect(Alice).approve(await yeetVault8.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(yeetVault8.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    yTokenBalance = await yeetVault8.yTokenUserBalance(epochId, await yeetVault8.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp8.decimals())}`);  // 744.444278692315151251
    console.log(`k0: ${await yeetVault8.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await yeetVault8.epochNextSwapX(epochId)}`);

    console.log("\n========= Bob swaps 10 $yeetLp for YTokens ===============");
    swapAssetAmount = ethers.parseUnits("10", await yeetLp8.decimals());
    swapResult = await expectedCalcSwap(yeetVault8, 10, Number(await yeetLp8.decimals()));  // 720.3778524226619
    actualResult = await yeetVault8.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated.toFixed(Number(await yeetLp8.decimals())), await yeetLp8.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m.toFixed(Number(await yeetLp8.decimals())), await yeetLp8.decimals()), actualResult[1]);

    await expect(yeetLp8.connect(Bob).approve(await yeetVault8.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await yeetVault8.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(yeetLp8, [Bob.address, await trifectaVault8.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    yTokenBalance = await yeetVault8.yTokenUserBalance(epochId, await yeetVault8.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp8.decimals())}`);  // 24.066323587412834713
    console.log(`k0: ${await yeetVault8.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await yeetVault8.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await yeetVault8.Y();
    expectedYValue = await expectedY(yeetVault8);
    expectNumberEquals(expectedYValue, Number(actualY));

    // 16 days later, Alice deposits 1000 $yeetLp, and starts a new epoch
    console.log("\n========= Alice deposits 1000 $yeetLp to start epoch 2 ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 16);

    aliceDepositAmount = ethers.parseUnits("1000", await yeetLp8.decimals());
    await expect(yeetLp8.connect(Alice).approve(await yeetVault8.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(yeetVault8.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    epochId = 2;
    expect(await yeetVault8.currentEpochId()).to.equal(epochId);

    yTokenBalance = await yeetVault8.yTokenUserBalance(epochId, await yeetVault8.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp8.decimals())}`);    // 

    // check Y
    actualY = await yeetVault8.Y();
    expectedYValue = await expectedY(yeetVault8);
    expectNumberEquals(expectedYValue, Number(actualY));
  });

  it('Swap with big numbers works', async () => {
    const { settings, yeetVault, trifectaVault, yeetLp, Alice, Bob, Caro } = await loadFixture(deployContractsFixture);
    const pToken = PToken__factory.connect(await yeetVault.pToken(), ethers.provider);

    await settings.connect(Alice).updateVaultParamValue(await yeetVault.getAddress(), ethers.encodeBytes32String("D"), ONE_DAY_IN_SECS * 15); // 15 days
    await settings.connect(Alice).updateVaultParamValue(await yeetVault.getAddress(), ethers.encodeBytes32String("f1"), 0);
    await settings.connect(Alice).updateVaultParamValue(await yeetVault.getAddress(), ethers.encodeBytes32String("f2"), 0);

    // 10^19
    await expect(yeetLp.connect(Alice).mint(Alice.address, ethers.parseUnits("10000000000000000000", await yeetLp.decimals()))).not.to.be.reverted;
    await expect(yeetLp.connect(Alice).mint(Bob.address, ethers.parseUnits("10000000000000000000", await yeetLp.decimals()))).not.to.be.reverted;
    await expect(yeetLp.connect(Alice).mint(Caro.address, ethers.parseUnits("10000000000000000000", await yeetLp.decimals()))).not.to.be.reverted;

    // First deposit automaticaly starts a new epoch.
    // Alice deposits 1000000000000000000 (10^18) $yeetLp
    const genesisTime = await time.latest();
    let aliceDepositAmount = ethers.parseUnits("1000000000000000000", await yeetLp.decimals());
    await expect(yeetLp.connect(Alice).approve(await yeetVault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(yeetVault.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    let epochId = 1;
    let result = await expectedInitSwapParams(yeetVault, 1000000000000000000);
    let actualX = await yeetVault.epochNextSwapX(epochId);
    let actualK0 = await yeetVault.epochNextSwapK0(epochId);
    expectBigNumberEquals(parseUnits(result.X + "", 18), actualX);
    expectBigNumberEquals(parseUnits((new BigNumber(result.k0)).toFixed(), await yeetLp.decimals() + await yeetLp.decimals()), actualK0);

    // check Y
    let actualY = await yeetVault.Y();
    let expectedYValue = await expectedY(yeetVault);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);

    // 1 hour later, Bob swaps 100000000000000000 $yeetLp for yTokens
    console.log("\n========= Bob swaps 100000000000000000 (10^17) $yeetLp for YTokens ===============");

    await time.increaseTo(genesisTime + 3600);
    let swapAssetAmount = ethers.parseUnits("100000000000000000", await yeetLp.decimals());
    let swapResult = await expectedCalcSwap(yeetVault, 100000000000000000, Number(await yeetLp.decimals()));
    let actualResult = await yeetVault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await yeetLp.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await yeetLp.decimals()), actualResult[1]);

    console.log(`k0 before swap: ${await yeetVault.epochNextSwapK0(epochId)}`);
    await expect(yeetLp.connect(Bob).approve(await yeetVault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    let trans = await yeetVault.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(yeetLp, [Bob.address, await trifectaVault.getAddress()], [-swapAssetAmount, swapAssetAmount]);
    await expect(trans)
      .to.emit(pToken, "Rebased").withArgs(swapAssetAmount)
      .to.emit(yeetVault, "Swap").withArgs(epochId, Bob.address, swapAssetAmount, 0, swapAssetAmount, anyValue);

    // k0 not changed.
    let yTokenBalance = await yeetVault.yTokenUserBalance(epochId, await yeetVault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp.decimals())}`);
    console.log(`k0 after swap: ${await yeetVault.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await yeetVault.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await yeetVault.Y();
    expectedYValue = await expectedY(yeetVault);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);

    // 1 day later, Bob swaps another 10 $yeetLp for yTokens
    console.log("\n========= Bob swaps 1000000 $yeetLp for YTokens ===============");
    await time.increaseTo(genesisTime + 3600 * 10);
    swapAssetAmount = ethers.parseUnits("1000000", await yeetLp.decimals());
    swapResult = await expectedCalcSwap(yeetVault, 1000000, Number(await yeetLp.decimals()));
    actualResult = await yeetVault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await yeetLp.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await yeetLp.decimals()), actualResult[1]);

    await expect(yeetLp.connect(Bob).approve(await yeetVault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await yeetVault.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(yeetLp, [Bob.address, await trifectaVault.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    // k not changed.
    yTokenBalance = await yeetVault.yTokenUserBalance(epochId, await yeetVault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp.decimals())}`);  // 644.444278692315151251
    console.log(`k0: ${await yeetVault.epochNextSwapK0(epochId)}`);

    // X is changed
    console.log(`X after swap: ${await yeetVault.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await yeetVault.Y();
    expectedYValue = await expectedY(yeetVault);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);

    // 10 days later, Alice deposits 100 $yeetLp, k0 is updated
    console.log("\n========= Alice deposits 100 $yeetLp ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 10);
    aliceDepositAmount = ethers.parseUnits("100", await yeetLp.decimals());
    await expect(yeetLp.connect(Alice).approve(await yeetVault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(yeetVault.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    yTokenBalance = await yeetVault.yTokenUserBalance(epochId, await yeetVault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp.decimals())}`); 
    console.log(`k0: ${await yeetVault.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await yeetVault.epochNextSwapX(epochId)}`);

    console.log("\n========= Bob swaps 1000000 $yeetLp for YTokens ===============");
    swapAssetAmount = ethers.parseUnits("1000000", await yeetLp.decimals());
    swapResult = await expectedCalcSwap(yeetVault, 1000000, Number(await yeetLp.decimals()));  
    actualResult = await yeetVault.calcSwap(swapAssetAmount);
    expectBigNumberEquals(parseUnits(swapResult.X_updated + "", await yeetLp.decimals()), actualResult[0]);
    expectBigNumberEquals(parseUnits(swapResult.m + "", await yeetLp.decimals()), actualResult[1]);

    await expect(yeetLp.connect(Bob).approve(await yeetVault.getAddress(), swapAssetAmount)).not.to.be.reverted;
    trans = await yeetVault.connect(Bob).swap(swapAssetAmount);
    await expect(trans).to.changeTokenBalances(yeetLp, [Bob.address, await trifectaVault.getAddress()], [-swapAssetAmount, swapAssetAmount]);

    yTokenBalance = await yeetVault.yTokenUserBalance(epochId, await yeetVault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp.decimals())}`); 
    console.log(`k0: ${await yeetVault.epochNextSwapK0(epochId)}`);
    console.log(`X after swap: ${await yeetVault.epochNextSwapX(epochId)}`);

    // check Y
    actualY = await yeetVault.Y();
    expectedYValue = await expectedY(yeetVault);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);

    // 16 days later, Alice deposits 1000 $yeetLp, and starts a new epoch
    console.log("\n========= Alice deposits 1000 $yeetLp to start epoch 2 ===============");
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 16);

    aliceDepositAmount = ethers.parseUnits("1000", await yeetLp.decimals());
    await expect(yeetLp.connect(Alice).approve(await yeetVault.getAddress(), aliceDepositAmount)).not.to.be.reverted;
    await expect(yeetVault.connect(Alice).deposit(aliceDepositAmount)).not.to.be.reverted;

    epochId = 2;
    expect(await yeetVault.currentEpochId()).to.equal(epochId);

    yTokenBalance = await yeetVault.yTokenUserBalance(epochId, await yeetVault.getAddress());
    console.log(`yToken balance: ${formatUnits(yTokenBalance, await yeetLp.decimals())}`);

    // check Y
    actualY = await yeetVault.Y();
    expectedYValue = await expectedY(yeetVault);
    expectBigNumberEquals(BigInt(expectedYValue), actualY);
  });

});
