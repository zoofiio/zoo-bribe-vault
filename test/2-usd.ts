import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { deployBaseContractsFixture } from './utils';

import { 
  MockUsd__factory
} from '../typechain';

const { provider } = ethers;

describe('Usd', () => {

  it('Usd works', async () => {

    const { Alice, Bob, Caro, Dave, protocol, settings } = await loadFixture(deployBaseContractsFixture);

    const MockUsdFactory = await ethers.getContractFactory('MockUsd');
    const MockUsd = await MockUsdFactory.deploy(await protocol.getAddress(), await settings.getAddress());
    const usd = MockUsd__factory.connect(await MockUsd.getAddress(), provider);

    let trans = await protocol.connect(Alice).initialize(await usd.getAddress());
    await trans.wait();

    // Alice mint 100 $zUSD to Bob.
    // Bobs share: 100
    let mintAmount = ethers.parseUnits('100', await usd.decimals());
    // await expect(usd.connect(Bob).mint(Bob.address, mintAmount)).to.be.rejectedWith('Ownable: caller is not the owner');
    await expect(usd.connect(Alice).mint(Bob.address, mintAmount))
      .to.emit(usd, 'Transfer').withArgs(ethers.ZeroAddress, Bob.address, mintAmount)
      .to.emit(usd, 'TransferShares').withArgs(ethers.ZeroAddress, Bob.address, mintAmount);
    expect(await usd.sharesOf(Bob.address)).to.equal(ethers.parseUnits('100', await usd.decimals()));
    expect(await usd.balanceOf(Bob.address)).to.equal(ethers.parseUnits('100', await usd.decimals()));
    await expect(usd.connect(Alice).burn(Bob.address, ethers.parseUnits('200', await usd.decimals()))).to.be.rejectedWith('Balance exceeded');

    // Bob transfer 50 $zUSD to Caro.
    // Bob shares: 50; Caro shares: 50
    let transferAmount = ethers.parseUnits('50', await usd.decimals());
    await expect(usd.connect(Bob).transfer(Caro.address, transferAmount)).not.to.be.rejected;
    expect(await usd.sharesOf(Bob.address)).to.equal(ethers.parseUnits('50', await usd.decimals()));
    expect(await usd.balanceOf(Bob.address)).to.equal(ethers.parseUnits('50', await usd.decimals()));
    expect(await usd.sharesOf(Caro.address)).to.equal(ethers.parseUnits('50', await usd.decimals()));
    expect(await usd.balanceOf(Caro.address)).to.equal(ethers.parseUnits('50', await usd.decimals()));

    // Admin rebase supply from 100 $zUSD to 200 $zUSD
    let rebaseAmount = ethers.parseUnits('100', await usd.decimals());
    // await expect(usd.connect(Bob).rebase(rebaseAmount)).to.be.rejectedWith('Ownable: caller is not the owner');
    await expect(usd.connect(Alice).rebase(rebaseAmount))
      .to.emit(usd, 'Rebased').withArgs(rebaseAmount);
    expect(await usd.balanceOf(Bob.address)).to.equal(ethers.parseUnits('100', await usd.decimals()));
    expect(await usd.balanceOf(Caro.address)).to.equal(ethers.parseUnits('100', await usd.decimals()));

    // Admin mint 100 $zUSD to Dave.
    // Total supply: 300; Bob shares: 50, Caro shares: 50, Dave shares: 50
    mintAmount = ethers.parseUnits('100', await usd.decimals());
    await expect(usd.connect(Alice).mint(Dave.address, mintAmount))
      .to.emit(usd, 'Transfer').withArgs(ethers.ZeroAddress, Dave.address, mintAmount)
      .to.emit(usd, 'TransferShares').withArgs(ethers.ZeroAddress, Dave.address, ethers.parseUnits('50', await usd.decimals()));

    // Dave directly transfer 10 shares to Bob
    // Total supply: 300; Bob shares: 60, Caro shares: 50, Dave shares: 40
    transferAmount = ethers.parseUnits('10', await usd.decimals());
    await expect(usd.connect(Dave).transferShares(Bob.address, transferAmount))
      .emit(usd, 'Transfer').withArgs(Dave.address, Bob.address, ethers.parseUnits('20', await usd.decimals()))
      .emit(usd, 'TransferShares').withArgs(Dave.address, Bob.address, transferAmount);
    expect(await usd.sharesOf(Bob.address)).to.equal(ethers.parseUnits('60', await usd.decimals()));
    expect(await usd.balanceOf(Bob.address)).to.equal(ethers.parseUnits('120', await usd.decimals()));
    
    // Bob approve Caro to transfer 20 $zUSD to Dave
    // Total supply: 300; Bob shares: 50, Caro shares: 50, Dave shares: 50
    let allowance = ethers.parseUnits('20', await usd.decimals());
    await expect(usd.connect(Bob).approve(Caro.address, allowance))
      .to.emit(usd, 'Approval').withArgs(Bob.address, Caro.address, allowance);
    await expect(usd.connect(Caro).transferFrom(Bob.address, Dave.address, allowance * 2n)).to.be.rejectedWith('Allowance exceeded');
    await expect(usd.connect(Caro).transferFrom(Bob.address, Dave.address, allowance))
      .to.emit(usd, 'Transfer').withArgs(Bob.address, Dave.address, allowance)
      .to.emit(usd, 'TransferShares').withArgs(Bob.address, Dave.address, ethers.parseUnits('10', await usd.decimals()));
    expect(await usd.sharesOf(Bob.address)).to.equal(ethers.parseUnits('50', await usd.decimals()));
    expect(await usd.balanceOf(Bob.address)).to.equal(ethers.parseUnits('100', await usd.decimals()));

    // Bob increase 10 $zUSD allowance to Caro
    await expect(usd.connect(Caro).transferFrom(Bob.address, Dave.address, allowance)).to.be.rejectedWith('Allowance exceeded');
    await expect(usd.connect(Bob).increaseAllowance(Caro.address, allowance))
      .to.emit(usd, 'Approval').withArgs(Bob.address, Caro.address, allowance);
    await expect(usd.connect(Bob).decreaseAllowance(Caro.address, allowance / 2n))
      .to.emit(usd, 'Approval').withArgs(Bob.address, Caro.address, allowance / 2n);
    
    // Caro transfer 5 shares (10 $zUSD) from Bob to Dave
    // Total supply: 300; Bob shares: 45, Caro shares: 50, Dave shares: 55
    transferAmount = ethers.parseUnits('5', await usd.decimals());
    await expect(usd.connect(Caro).transferSharesFrom(Bob.address, Dave.address, transferAmount))
      .to.emit(usd, 'Transfer').withArgs(Bob.address, Dave.address, ethers.parseUnits('10', await usd.decimals()))
      .to.emit(usd, 'TransferShares').withArgs(Bob.address, Dave.address, transferAmount);
    expect(await usd.sharesOf(Bob.address)).to.equal(ethers.parseUnits('45', await usd.decimals()));
    expect(await usd.balanceOf(Bob.address)).to.equal(ethers.parseUnits('90', await usd.decimals()));
    expect(await usd.sharesOf(Dave.address)).to.equal(ethers.parseUnits('55', await usd.decimals()));
    expect(await usd.balanceOf(Dave.address)).to.equal(ethers.parseUnits('110', await usd.decimals()));

    // Admin burns 10 $zUSD from Caro
    // Total supply: 295; Bob shares: 45, Caro shares: 45, Dave shares: 55
    let burnAmount = ethers.parseUnits('10', await usd.decimals());
    // await expect(usd.connect(Caro).burn(Caro.address, burnAmount)).to.be.rejectedWith('Ownable: caller is not the owner');
    await expect(usd.connect(Alice).burn(Caro.address, burnAmount))
      .to.emit(usd, 'Transfer').withArgs(Caro.address, ethers.ZeroAddress, burnAmount)
      .to.emit(usd, 'TransferShares').withArgs(Caro.address, ethers.ZeroAddress, burnAmount / 2n);
    expect(await usd.sharesOf(Caro.address)).to.equal(ethers.parseUnits('45', await usd.decimals()));
    expect(await usd.balanceOf(Caro.address)).to.equal(ethers.parseUnits('90', await usd.decimals()));
    expect(await usd.totalShares()).to.equal(ethers.parseUnits('145', await usd.decimals()));
    expect(await usd.totalSupply()).to.equal(ethers.parseUnits('290', await usd.decimals()));

    // Burn all
    await expect(usd.connect(Alice).burn(Caro.address, ethers.parseUnits('100', await usd.decimals()))).to.be.rejected;
    await expect(usd.connect(Alice).burn(Caro.address, ethers.parseUnits('90', await usd.decimals()))).not.to.be.rejected;
    await expect(usd.connect(Alice).burn(Bob.address, ethers.parseUnits('90', await usd.decimals()))).not.to.be.rejected;
    await expect(usd.connect(Alice).burn(Dave.address, ethers.parseUnits('110', await usd.decimals()))).not.to.be.rejected;
    expect(await usd.totalShares()).to.equal(0);
    expect(await usd.totalSupply()).to.equal(0);

    mintAmount = ethers.parseUnits('100', await usd.decimals());
    await expect(usd.connect(Alice).mint(Bob.address, mintAmount))
      .to.emit(usd, 'Transfer').withArgs(ethers.ZeroAddress, Bob.address, mintAmount)
      .to.emit(usd, 'TransferShares').withArgs(ethers.ZeroAddress, Bob.address, mintAmount);
    expect(await usd.sharesOf(Bob.address)).to.equal(ethers.parseUnits('100', await usd.decimals()));
    expect(await usd.balanceOf(Bob.address)).to.equal(ethers.parseUnits('100', await usd.decimals()));

  });

});
