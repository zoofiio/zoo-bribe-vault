import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers';
import { deployContractsFixture, expectBigNumberEquals } from './utils';
import { 
  MockPTokenV2__factory
} from '../typechain';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';

const { provider } = ethers;

describe('PTokenV2', () => {

  it('PTokenV2 works with linear rebase', async () => {

    const { Alice, Bob, Caro, Dave, protocol, settings } = await loadFixture(deployContractsFixture);

    const MockPTokenV2Factory = await ethers.getContractFactory('MockPTokenV2');
    const MockPTokenV2 = await MockPTokenV2Factory.deploy(await protocol.getAddress(), await settings.getAddress());
    const pToken = MockPTokenV2__factory.connect(await MockPTokenV2.getAddress(), provider);

    const decimalsOffset = await pToken.decimalsOffset();

    // Alice mint 100 $pTK to Bob and Caro
    let mintAmount = ethers.parseUnits('100', await pToken.decimals());
    let sharesMintAmount = mintAmount * (10n ** decimalsOffset);
    
    await expect(pToken.connect(Alice).mint(Bob.address, mintAmount))
      .to.emit(pToken, 'Transfer').withArgs(ethers.ZeroAddress, Bob.address, mintAmount)
      .to.emit(pToken, 'TransferShares').withArgs(ethers.ZeroAddress, Bob.address, sharesMintAmount);
    
    await expect(pToken.connect(Alice).mint(Caro.address, mintAmount))
      .to.emit(pToken, 'Transfer').withArgs(ethers.ZeroAddress, Caro.address, mintAmount)
      .to.emit(pToken, 'TransferShares').withArgs(ethers.ZeroAddress, Caro.address, sharesMintAmount);
    
    expect(await pToken.totalSupply()).to.equal(ethers.parseUnits('200', await pToken.decimals()));

    /**
     * Day 0:
     * Total supply: 200
     * Bob: 100, Caro: 100
     */

    // Scenario 1: Initial rebase - add 100 tokens over 1 day
    const oneDayInSeconds = 86400;
    const rebaseAmount = ethers.parseUnits('100', await pToken.decimals());
    
    await expect(pToken.connect(Alice).rebase(rebaseAmount, oneDayInSeconds))
      .to.emit(pToken, 'Rebased').withArgs(rebaseAmount, oneDayInSeconds);
    
    // Record initial balance
    const bobInitialBalance = await pToken.balanceOf(Bob.address);
    expect(bobInitialBalance).to.equal(mintAmount);
    
    // Advance time by 12 hours (halfway through the rebase period)
    await time.increase(oneDayInSeconds / 2);

    /**
     * Day 0 + 12 hours (total rebased 50):
     * Total supply: 250
     * Bob: 100 + 25, Caro: 100 + 25
     */
    
    // Now Bob's balance should have increased by ~50 (half of rebase amount)
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('125', await pToken.decimals()));
    
    // Bob transfers 25 tokens to Dave
    const transferAmount = ethers.parseUnits('25', await pToken.decimals());
    await expect(pToken.connect(Bob).transfer(Dave.address, transferAmount))
      .to.emit(pToken, 'Transfer').withArgs(Bob.address, Dave.address, transferAmount);

    /**
     * Day 0 + 12 hours (total rebased 50):
     * Total supply: 250
     * Bob: 100, Caro: 100 + 25, Dave: 25
     */

    // Balances should reflect transfer and ongoing rebase
    expectBigNumberEquals(await pToken.totalSupply(), ethers.parseUnits('250', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('100', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Caro.address), ethers.parseUnits('125', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Dave.address), ethers.parseUnits('25', await pToken.decimals()));
  
    // Scenario 2: New rebase while existing rebase is in progress
    // Initiate a new rebase while first rebase is still ongoing
    // First rebase leftover: 50
    // New rebase amount: 50 + 200 = 250
    // New rebase duration: 2 days
    const rebaseAmount2 = ethers.parseUnits('200', await pToken.decimals());
    const twoDaysInSeconds = oneDayInSeconds * 2;
    
    await expect(pToken.connect(Alice).rebase(rebaseAmount2, twoDaysInSeconds))
      .to.emit(pToken, 'Rebased').withArgs(rebaseAmount2, twoDaysInSeconds);

    // Now complete the first rebase period
    await time.increase(oneDayInSeconds / 2);

    /**
     * Initial total supply: 250
     * Total rebased supply: 250 / 4 = 62.5
     * Total supply after first rebase: 250 + 62.5 = 312.5
     * Bob: 100 + 62.5 * 100 / 250 = 125
     * Caro: 125 + 62.5 * 125 / 250 = 156.25
     * Dave: 25 + 62.5 * 25 / 250 = 31.25
     */
    expectBigNumberEquals(await pToken.totalSupply(), ethers.parseUnits('312.5', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('125', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Caro.address), ethers.parseUnits('156.25', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Dave.address), ethers.parseUnits('31.25', await pToken.decimals()));
    
    // Mint some tokens during active rebase
    await expect(pToken.connect(Alice).mint(Dave.address, mintAmount))
      .to.emit(pToken, 'Transfer').withArgs(ethers.ZeroAddress, Dave.address, mintAmount);

    /**
     * Total supply: 312.5 + 100 = 412.5
     * Bob: 125; Caro: 156.25; Dave: 31.25 + 100 = 131.25
     */
    expectBigNumberEquals(await pToken.totalSupply(), ethers.parseUnits('412.5', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('125', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Caro.address), ethers.parseUnits('156.25', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Dave.address), ethers.parseUnits('131.25', await pToken.decimals()));
    
    // Advance halfway through second rebase
    await time.increase(twoDaysInSeconds / 2 - oneDayInSeconds / 2);

    /**
     * Initial supply: 412.5
     * Initial balance: Bob: 125; Caro: 156.25; Dave: 131.25
     * New rebase amount: 250 / 4 = 62.5
     * 
     * New total supply: 412.5 + 62.5 = 475
     * New balance: Bob: 125 + 62.5 * 125 / 412.5 = 143.939393939
     * New balance: Caro: 156.25 + 62.5 * 156.25 / 412.5 = 179.924242424
     * New balance: Dave: 131.25 + 62.5 * 131.25 / 412.5 = 151.136363636
     */
    expectBigNumberEquals(await pToken.totalSupply(), ethers.parseUnits('475', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('143.939393939', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Caro.address), ethers.parseUnits('179.924242424', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Dave.address), ethers.parseUnits('151.136363636', await pToken.decimals()));
    
    // Burn some tokens during active rebase
    const burnAmount = ethers.parseUnits('10', await pToken.decimals());
    await expect(pToken.connect(Alice).burn(Caro.address, burnAmount))
      .to.emit(pToken, 'Transfer').withArgs(Caro.address, ethers.ZeroAddress, burnAmount);

    expectBigNumberEquals(await pToken.totalSupply(), ethers.parseUnits('465', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('143.939393939', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Caro.address), ethers.parseUnits('169.924242424', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Dave.address), ethers.parseUnits('151.136363636', await pToken.decimals()));
    
    // Advance to complete the second rebase
    await time.increase(twoDaysInSeconds / 2);

    /**
     * Initial supply: 465
     * Initial balance: Bob: 143.939393939; Caro: 169.924242424; Dave: 151.136363636
     * New rebase amount: 250 / 2 = 125
     * 
     * New total supply: 465 + 125 = 590
     * New balance: Bob: 143.939393939 + 125 * 143.939393939 / 465 = 182.632779406
     * New balance: Caro: 169.924242424 + 125 * 169.924242424 / 465 = 215.602802215
     * New balance: Dave: 151.136363636 + 125 * 151.136363636 / 465 = 191.764418377
     */
    expectBigNumberEquals(await pToken.totalSupply(), ethers.parseUnits('590', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('182.632779406', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Caro.address), ethers.parseUnits('215.602802215', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Dave.address), ethers.parseUnits('191.764418377', await pToken.decimals()));
    
    // Scenario 3: New rebase after previous rebase has completed
    // Wait some time after rebase completion
    await time.increase(oneDayInSeconds / 2);
    
    const rebaseAmount3 = ethers.parseUnits('50', await pToken.decimals());
    const halfDayInSeconds = oneDayInSeconds / 2;
    
    await expect(pToken.connect(Alice).rebase(rebaseAmount3, halfDayInSeconds))
      .to.emit(pToken, 'Rebased').withArgs(rebaseAmount3, halfDayInSeconds);
  
    
    // Transfer shares during active rebase
    const sharesTransferAmount = ethers.parseUnits('10', await pToken.decimals() + decimalsOffset);
    await expect(pToken.connect(Dave).transferShares(Bob.address, sharesTransferAmount))
      .to.emit(pToken, 'TransferShares').withArgs(Dave.address, Bob.address, sharesTransferAmount);

    expectBigNumberEquals(await pToken.totalSupply(), ethers.parseUnits('590', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('205.46296089558868290', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Caro.address), ethers.parseUnits('215.602802215', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Dave.address), ethers.parseUnits('168.93433900592917116', await pToken.decimals()));
    
    // Complete the third rebase
    await time.increase(halfDayInSeconds);

    /**
     * Initial supply: 590
     * Initial balance: Bob: 205.46296089558868290; Caro: 215.602802215; Dave: 168.93433900592917116
     * New rebase amount: 50
     * 
     * New total supply: 590 + 50 = 640
     * New balance: Bob: 205.46296089558868290 + 50 * 205.46296089558868290 / 590 = 222.875076226
     * New balance: Caro: 215.602802215 + 50 * 215.602802215 / 590 = 233.874226132
     * New balance: Dave: 168.93433900592917116 + 50 * 168.93433900592917116 / 590 = 183.250808413
     */
    expectBigNumberEquals(await pToken.totalSupply(), ethers.parseUnits('640', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('222.875076226', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Caro.address), ethers.parseUnits('233.874226132', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Dave.address), ethers.parseUnits('183.250808413', await pToken.decimals()));
    
    // Check final state
    const finalBobBalance = await pToken.balanceOf(Bob.address);
    const finalDaveBalance = await pToken.balanceOf(Dave.address);
    const finalCaroBalance = await pToken.balanceOf(Caro.address);
    
    // Verify shares to tokens relationship holds with rebasing
    const bobShares = await pToken.sharesOf(Bob.address);
    const daveShares = await pToken.sharesOf(Dave.address);
    const caroShares = await pToken.sharesOf(Caro.address);
    
    // Check share proportions match token proportions
    const totalShares = await pToken.totalShares();
    const totalTokens = await pToken.totalSupply();
    
    const bobExpectedBalance = totalTokens * bobShares / totalShares;
    const daveExpectedBalance = totalTokens * daveShares / totalShares;
    const caroExpectedBalance = totalTokens * caroShares / totalShares;
    
    expectBigNumberEquals(finalBobBalance, bobExpectedBalance);
    expectBigNumberEquals(finalDaveBalance, daveExpectedBalance);
    expectBigNumberEquals(finalCaroBalance, caroExpectedBalance);
    
    // Test approval and transferFrom during and after rebase
    const approvalAmount = ethers.parseUnits('50', await pToken.decimals());
    await expect(pToken.connect(Bob).approve(Caro.address, approvalAmount))
      .to.emit(pToken, 'Approval').withArgs(Bob.address, Caro.address, approvalAmount);

    // Start another rebase
    const rebaseAmount4 = ethers.parseUnits('100', await pToken.decimals());
    await expect(pToken.connect(Alice).rebase(rebaseAmount4, oneDayInSeconds))
      .to.emit(pToken, 'Rebased');
    
    // TransferFrom during active rebase
    const transferFromAmount = ethers.parseUnits('25', await pToken.decimals());
    await expect(pToken.connect(Caro).transferFrom(Bob.address, Dave.address, transferFromAmount))
      .to.emit(pToken, 'Transfer').withArgs(Bob.address, Dave.address, transferFromAmount);
    
    /**
     * Total supply: 640
     * Bob: 222.875076226 - 25 = 197.875076226
     * Caro: 233.874226132
     * Dave: 183.250808413 + 25 = 208.250808413
     */
    expectBigNumberEquals(await pToken.totalSupply(), ethers.parseUnits('640', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('197.875076226', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Caro.address), ethers.parseUnits('233.874226132', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Dave.address), ethers.parseUnits('208.250808413', await pToken.decimals()));
    
    // Complete final rebase and check state
    await time.increase(oneDayInSeconds);

    /**
     * Initial supply: 640
     * Initial balance: Bob: 197.875076226; Caro: 233.874226132; Dave: 208.250808413
     * New rebase amount: 100
     * 
     * New total supply: 640 + 100 = 740
     * New balance: Bob: 197.875076226 + 100 * 197.875076226 / 640 = 228.793056886
     * New balance: Caro: 233.874226132 + 100 * 233.874226132 / 640 = 270.417073965
     * New balance: Dave: 208.250808413 + 100 * 208.250808413 / 640 = 240.789997228
     */
    expectBigNumberEquals(await pToken.totalSupply(), ethers.parseUnits('740', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('228.793056886', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Caro.address), ethers.parseUnits('270.417073965', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Dave.address), ethers.parseUnits('240.789997228', await pToken.decimals()));
    
    // Burn all tokens and verify state
    await expect(pToken.connect(Alice).burn(Bob.address, await pToken.balanceOf(Bob.address))).not.to.be.rejected;
    await expect(pToken.connect(Alice).burn(Caro.address, await pToken.balanceOf(Caro.address))).not.to.be.rejected;
    await expect(pToken.connect(Alice).burn(Dave.address, await pToken.balanceOf(Dave.address))).not.to.be.rejected;

    // Check that total supply only includes pending rebases (if any)
    const finalTotalSupply = await pToken.totalSupply();
    console.log('Final total supply after burning all:', ethers.formatUnits(finalTotalSupply, await pToken.decimals()));
    
    // Should be very close to zero if all tokens are burned and rebase completed
    expect(finalTotalSupply).to.be.lessThan(ethers.parseUnits('0.0001', await pToken.decimals()));
  });

  it('flushRebase works correctly', async () => {
    const { Alice, Bob, Caro, Dave, protocol, settings } = await loadFixture(deployContractsFixture);

    const MockPTokenV2Factory = await ethers.getContractFactory('MockPTokenV2');
    const MockPTokenV2 = await MockPTokenV2Factory.deploy(await protocol.getAddress(), await settings.getAddress());
    const pToken = MockPTokenV2__factory.connect(await MockPTokenV2.getAddress(), provider);

    const decimalsOffset = await pToken.decimalsOffset();

    // Initial setup: mint tokens to Bob and Caro
    const mintAmount = ethers.parseUnits('100', await pToken.decimals());
    await pToken.connect(Alice).mint(Bob.address, mintAmount);
    await pToken.connect(Alice).mint(Caro.address, mintAmount);
    
    // Start a linear rebase
    const oneDayInSeconds = 86400;
    const rebaseAmount = ethers.parseUnits('100', await pToken.decimals());
    await pToken.connect(Alice).rebase(rebaseAmount, oneDayInSeconds);
    
    // Record initial state
    const initialTotalSupply = await pToken.totalSupply();
    const bobInitialBalance = await pToken.balanceOf(Bob.address);
    const caroInitialBalance = await pToken.balanceOf(Caro.address);
    
    // Advance time by 25% of the rebase period
    await time.increase(oneDayInSeconds / 4);
    
    // Check state before flushing - supply should have increased by ~25 tokens
    const totalSupplyBeforeFlush = await pToken.totalSupply();
    expectBigNumberEquals(
      totalSupplyBeforeFlush - initialTotalSupply,
      ethers.parseUnits('25', await pToken.decimals())
    );
    
    // Flush the rebase
    await expect(pToken.connect(Alice).flushRebase())
      .to.emit(pToken, 'FlushRebased');
    
    // Check state after flushing - supply should have immediately increased by remaining 75 tokens
    const totalSupplyAfterFlush = await pToken.totalSupply();
    expectBigNumberEquals(
      totalSupplyAfterFlush,
      initialTotalSupply + rebaseAmount
    );
    
    // Check that both Bob and Caro's balances increased proportionally to their share
    const bobBalanceAfterFlush = await pToken.balanceOf(Bob.address);
    const caroBalanceAfterFlush = await pToken.balanceOf(Caro.address);
    
    // Each had 100 tokens out of 200 total, so each should get 50 tokens from the rebase
    expectBigNumberEquals(
      bobBalanceAfterFlush - bobInitialBalance,
      ethers.parseUnits('50', await pToken.decimals())
    );
    expectBigNumberEquals(
      caroBalanceAfterFlush - caroInitialBalance,
      ethers.parseUnits('50', await pToken.decimals())
    );
    
    // Test that calling flushRebase again has no effect
    await pToken.connect(Alice).flushRebase();
    expectBigNumberEquals(
      await pToken.totalSupply(),
      totalSupplyAfterFlush
    );
    
    // Test flushRebase with a second rebase cycle
    const secondRebaseAmount = ethers.parseUnits('50', await pToken.decimals());
    await pToken.connect(Alice).rebase(secondRebaseAmount, oneDayInSeconds);
    
    // Transfer some tokens from Bob to Dave during active rebase
    await pToken.connect(Bob).transfer(Dave.address, ethers.parseUnits('50', await pToken.decimals()));
    
    // Record balances before second flush
    const bobBalanceBeforeSecondFlush = await pToken.balanceOf(Bob.address);
    const caroBalanceBeforeSecondFlush = await pToken.balanceOf(Caro.address);
    const daveBalanceBeforeSecondFlush = await pToken.balanceOf(Dave.address);
    
    // Flush the second rebase
    await pToken.connect(Alice).flushRebase();
    
    const totalSupplyAfterSecondFlush = await pToken.totalSupply();
    expectBigNumberEquals(
      totalSupplyAfterSecondFlush - totalSupplyAfterFlush,
      secondRebaseAmount
    );
    
    // Check that each user's balance increased proportionally to their share
    // Bob has 100, Caro has 150, Dave has 50, total 300
    // From 50 new tokens: Bob gets ~16.67, Caro gets ~25, Dave gets ~8.33
    expectBigNumberEquals(
      await pToken.balanceOf(Bob.address) - bobBalanceBeforeSecondFlush,
      ethers.parseUnits('16.666666666666666667', await pToken.decimals())
    );
    expectBigNumberEquals(
      await pToken.balanceOf(Caro.address) - caroBalanceBeforeSecondFlush,
      ethers.parseUnits('25', await pToken.decimals())
    );
    expectBigNumberEquals(
      await pToken.balanceOf(Dave.address) - daveBalanceBeforeSecondFlush,
      ethers.parseUnits('8.333333333333333333', await pToken.decimals())
    );
    
    // Test flushRebase during mint/burn operations
    await pToken.connect(Alice).rebase(rebaseAmount, oneDayInSeconds);
    
    // Mint new tokens during active rebase
    await pToken.connect(Alice).mint(Bob.address, mintAmount);
    
    // Flush the rebase and verify
    const totalSupplyBeforeThirdFlush = await pToken.totalSupply();
    await pToken.connect(Alice).flushRebase();
    
    expectBigNumberEquals(
      await pToken.totalSupply() - totalSupplyBeforeThirdFlush,
      rebaseAmount
    );
  });

});
