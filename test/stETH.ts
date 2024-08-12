import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { deployBaseContractsFixture } from './utils';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';

describe('stETH', () => {

  it('stETH works', async () => {
    const { protocol, usd, stETH, Alice, Bob, Caro } = await loadFixture(deployBaseContractsFixture);

    let trans = await protocol.connect(Alice).initialize(await usd.getAddress());
    await trans.wait();

    // Alice mint 100 $stETH to Bob
    let mintAmount = ethers.parseUnits('100', await stETH.decimals());
    await expect(stETH.connect(Bob).mint(Bob.address, mintAmount)).to.be.rejectedWith('Caller is not admin');
    await expect(stETH.connect(Alice).mint(Bob.address, mintAmount))
      .to.emit(stETH, 'Transfer').withArgs(ethers.ZeroAddress, Bob.address, mintAmount)
      .to.emit(stETH, 'TransferShares').withArgs(ethers.ZeroAddress, Bob.address, mintAmount);
    
    // Alice mint 200 $stETH to Caro
    mintAmount = ethers.parseUnits('200', await stETH.decimals());
    await expect(stETH.connect(Alice).mint(Caro.address, mintAmount))
      .to.emit(stETH, 'Transfer').withArgs(ethers.ZeroAddress, Caro.address, mintAmount)
      .to.emit(stETH, 'TransferShares').withArgs(ethers.ZeroAddress, Caro.address, mintAmount);

    expect(await stETH.balanceOf(Bob.address)).to.equal(ethers.parseUnits('100', await stETH.decimals()));
    expect(await stETH.balanceOf(Caro.address)).to.equal(ethers.parseUnits('200', await stETH.decimals()));
    expect(await stETH.totalSupply()).to.equal(ethers.parseUnits('300', await stETH.decimals()));

    // Bob add 150 $stETH as rewards. Not Bob and Caro's balance should be increaed by 50%
    const rewardAmount = ethers.parseUnits('150', await stETH.decimals());
    await expect(stETH.connect(Bob).addRewards(rewardAmount)).to.be.rejectedWith('Caller is not admin');
    await expect(stETH.connect(Alice).setAdmin(Bob.address, true))
      .to.emit(stETH, 'UpdateAdmin').withArgs(Bob.address, true);
    await expect(stETH.connect(Bob).addRewards(rewardAmount))
      .to.emit(stETH, 'AddRewards').withArgs(Bob.address, rewardAmount);
    
    expect(await stETH.balanceOf(Bob.address)).to.equal(ethers.parseUnits('150', await stETH.decimals()));
    expect(await stETH.balanceOf(Caro.address)).to.equal(ethers.parseUnits('300', await stETH.decimals()));
    expect(await stETH.totalSupply()).to.equal(ethers.parseUnits('450', await stETH.decimals()));

    // Bob remove 90 $stETH as rewards. Not Bob and Caro's balance should be decreaed by 20%
    const removeAmount = ethers.parseUnits('90', await stETH.decimals());
    await expect(stETH.connect(Bob).submitPenalties(removeAmount))
      .to.emit(stETH, 'SubmitPenalties').withArgs(Bob.address, removeAmount);
    expect(await stETH.balanceOf(Bob.address)).to.equal(ethers.parseUnits('120', await stETH.decimals()));
    expect(await stETH.balanceOf(Caro.address)).to.equal(ethers.parseUnits('240', await stETH.decimals()));
    expect(await stETH.totalSupply()).to.equal(ethers.parseUnits('360', await stETH.decimals()));

    // Alice mint 360 $stETH to herself. Bob and Caro's balance should be unchanged
    mintAmount = ethers.parseUnits('360', await stETH.decimals());
    await expect(stETH.connect(Alice).mint(Alice.address, mintAmount)).not.to.be.rejected;
    expect(await stETH.balanceOf(Alice.address)).to.equal(ethers.parseUnits('360', await stETH.decimals()));
    expect(await stETH.balanceOf(Bob.address)).to.equal(ethers.parseUnits('120', await stETH.decimals()));
    expect(await stETH.balanceOf(Caro.address)).to.equal(ethers.parseUnits('240', await stETH.decimals()));
    expect(await stETH.totalSupply()).to.equal(ethers.parseUnits('720', await stETH.decimals()));

    // Burnable
    let burnAmount = ethers.parseUnits('120', await stETH.decimals());
    await expect(stETH.connect(Caro).burn(burnAmount))
      .to.emit(stETH, 'Transfer').withArgs(Caro.address, ethers.ZeroAddress, burnAmount)
      .to.emit(stETH, 'TransferShares').withArgs(Caro.address, ethers.ZeroAddress, anyValue);
    expect(await stETH.balanceOf(Caro.address)).to.equal(ethers.parseUnits('120', await stETH.decimals()));
    expect(await stETH.totalSupply()).to.equal(ethers.parseUnits('600', await stETH.decimals()));

    // Transferable
    let transferAmount = ethers.parseUnits('60', await stETH.decimals());
    await expect(stETH.connect(Alice).transfer(Bob.address, transferAmount))
      .to.emit(stETH, 'Transfer').withArgs(Alice.address, Bob.address, transferAmount)
      .to.emit(stETH, 'TransferShares').withArgs(Alice.address, Bob.address, anyValue);
    expect(await stETH.balanceOf(Alice.address)).to.equal(ethers.parseUnits('300', await stETH.decimals()));
    expect(await stETH.balanceOf(Bob.address)).to.equal(ethers.parseUnits('180', await stETH.decimals()));
    expect(await stETH.totalSupply()).to.equal(ethers.parseUnits('600', await stETH.decimals()));

    // Approve
    let approveAmount = ethers.parseUnits('60', await stETH.decimals());
    await expect(stETH.connect(Alice).transferFrom(Bob.address, Alice.address, approveAmount)).to.be.rejectedWith('TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE');
    await expect(stETH.connect(Bob).approve(Alice.address, approveAmount))
      .to.emit(stETH, 'Approval').withArgs(Bob.address, Alice.address, approveAmount);
    await expect(stETH.connect(Alice).transferFrom(Bob.address, Alice.address, approveAmount))
      .to.emit(stETH, 'Transfer').withArgs(Bob.address, Alice.address, approveAmount)
      .to.emit(stETH, 'TransferShares').withArgs(Bob.address, Alice.address, anyValue);
    await expect(stETH.connect(Alice).transferFrom(Bob.address, Alice.address, approveAmount)).to.be.rejectedWith('TRANSFER_AMOUNT_EXCEEDS_ALLOWANCE');
    expect(await stETH.balanceOf(Alice.address)).to.equal(ethers.parseUnits('360', await stETH.decimals()));
    expect(await stETH.balanceOf(Bob.address)).to.equal(ethers.parseUnits('120', await stETH.decimals()));
    expect(await stETH.totalSupply()).to.equal(ethers.parseUnits('600', await stETH.decimals()));
  });

});
