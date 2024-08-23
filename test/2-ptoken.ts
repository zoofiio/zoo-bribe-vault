import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { deployContractsFixture } from './utils';
import { 
  MockPToken__factory
} from '../typechain';

const { provider } = ethers;

describe('PToken', () => {

  it('PToken works', async () => {

    const { Alice, Bob, Caro, Dave, protocol, settings } = await loadFixture(deployContractsFixture);

    const MockPTokenFactory = await ethers.getContractFactory('MockPToken');
    const MockPToken = await MockPTokenFactory.deploy(await protocol.getAddress(), await settings.getAddress());
    const pToken = MockPToken__factory.connect(await MockPToken.getAddress(), provider);

    // Alice mint 100 $pTK to Bob.
    // Bobs share: 100
    let mintAmount = ethers.parseUnits('100', await pToken.decimals());
    // await expect(pToken.connect(Bob).mint(Bob.address, mintAmount)).to.be.rejectedWith('Ownable: caller is not the owner');
    await expect(pToken.connect(Alice).mint(Bob.address, mintAmount))
      .to.emit(pToken, 'Transfer').withArgs(ethers.ZeroAddress, Bob.address, mintAmount)
      .to.emit(pToken, 'TransferShares').withArgs(ethers.ZeroAddress, Bob.address, mintAmount);
    expect(await pToken.sharesOf(Bob.address)).to.equal(ethers.parseUnits('100', await pToken.decimals()));
    expect(await pToken.balanceOf(Bob.address)).to.equal(ethers.parseUnits('100', await pToken.decimals()));
    await expect(pToken.connect(Alice).burn(Bob.address, ethers.parseUnits('200', await pToken.decimals()))).to.be.rejectedWith('Balance exceeded');

    // Bob transfer 50 $pTK to Caro.
    // Bob shares: 50; Caro shares: 50
    let transferAmount = ethers.parseUnits('50', await pToken.decimals());
    await expect(pToken.connect(Bob).transfer(Caro.address, transferAmount)).not.to.be.rejected;
    expect(await pToken.sharesOf(Bob.address)).to.equal(ethers.parseUnits('50', await pToken.decimals()));
    expect(await pToken.balanceOf(Bob.address)).to.equal(ethers.parseUnits('50', await pToken.decimals()));
    expect(await pToken.sharesOf(Caro.address)).to.equal(ethers.parseUnits('50', await pToken.decimals()));
    expect(await pToken.balanceOf(Caro.address)).to.equal(ethers.parseUnits('50', await pToken.decimals()));

    // Admin rebase supply from 100 $pTK to 200 $pTK
    let rebaseAmount = ethers.parseUnits('100', await pToken.decimals());
    // await expect(pToken.connect(Bob).rebase(rebaseAmount)).to.be.rejectedWith('Ownable: caller is not the owner');
    await expect(pToken.connect(Alice).rebase(rebaseAmount))
      .to.emit(pToken, 'Rebased').withArgs(rebaseAmount);
    expect(await pToken.balanceOf(Bob.address)).to.equal(ethers.parseUnits('100', await pToken.decimals()));
    expect(await pToken.balanceOf(Caro.address)).to.equal(ethers.parseUnits('100', await pToken.decimals()));

    // Admin mint 100 $pTK to Dave.
    // Total supply: 300; Bob shares: 50, Caro shares: 50, Dave shares: 50
    mintAmount = ethers.parseUnits('100', await pToken.decimals());
    await expect(pToken.connect(Alice).mint(Dave.address, mintAmount))
      .to.emit(pToken, 'Transfer').withArgs(ethers.ZeroAddress, Dave.address, mintAmount)
      .to.emit(pToken, 'TransferShares').withArgs(ethers.ZeroAddress, Dave.address, ethers.parseUnits('50', await pToken.decimals()));

    // Dave directly transfer 10 shares to Bob
    // Total supply: 300; Bob shares: 60, Caro shares: 50, Dave shares: 40
    transferAmount = ethers.parseUnits('10', await pToken.decimals());
    await expect(pToken.connect(Dave).transferShares(Bob.address, transferAmount))
      .emit(pToken, 'Transfer').withArgs(Dave.address, Bob.address, ethers.parseUnits('20', await pToken.decimals()))
      .emit(pToken, 'TransferShares').withArgs(Dave.address, Bob.address, transferAmount);
    expect(await pToken.sharesOf(Bob.address)).to.equal(ethers.parseUnits('60', await pToken.decimals()));
    expect(await pToken.balanceOf(Bob.address)).to.equal(ethers.parseUnits('120', await pToken.decimals()));
    
    // Bob approve Caro to transfer 20 $pTK to Dave
    // Total supply: 300; Bob shares: 50, Caro shares: 50, Dave shares: 50
    let allowance = ethers.parseUnits('20', await pToken.decimals());
    await expect(pToken.connect(Bob).approve(Caro.address, allowance))
      .to.emit(pToken, 'Approval').withArgs(Bob.address, Caro.address, allowance);
    await expect(pToken.connect(Caro).transferFrom(Bob.address, Dave.address, allowance * 2n)).to.be.rejectedWith('Allowance exceeded');
    await expect(pToken.connect(Caro).transferFrom(Bob.address, Dave.address, allowance))
      .to.emit(pToken, 'Transfer').withArgs(Bob.address, Dave.address, allowance)
      .to.emit(pToken, 'TransferShares').withArgs(Bob.address, Dave.address, ethers.parseUnits('10', await pToken.decimals()));
    expect(await pToken.sharesOf(Bob.address)).to.equal(ethers.parseUnits('50', await pToken.decimals()));
    expect(await pToken.balanceOf(Bob.address)).to.equal(ethers.parseUnits('100', await pToken.decimals()));

    // Bob increase 10 $pTK allowance to Caro
    await expect(pToken.connect(Caro).transferFrom(Bob.address, Dave.address, allowance)).to.be.rejectedWith('Allowance exceeded');
    await expect(pToken.connect(Bob).increaseAllowance(Caro.address, allowance))
      .to.emit(pToken, 'Approval').withArgs(Bob.address, Caro.address, allowance);
    await expect(pToken.connect(Bob).decreaseAllowance(Caro.address, allowance / 2n))
      .to.emit(pToken, 'Approval').withArgs(Bob.address, Caro.address, allowance / 2n);
    
    // Caro transfer 5 shares (10 $pTK) from Bob to Dave
    // Total supply: 300; Bob shares: 45, Caro shares: 50, Dave shares: 55
    transferAmount = ethers.parseUnits('5', await pToken.decimals());
    await expect(pToken.connect(Caro).transferSharesFrom(Bob.address, Dave.address, transferAmount))
      .to.emit(pToken, 'Transfer').withArgs(Bob.address, Dave.address, ethers.parseUnits('10', await pToken.decimals()))
      .to.emit(pToken, 'TransferShares').withArgs(Bob.address, Dave.address, transferAmount);
    expect(await pToken.sharesOf(Bob.address)).to.equal(ethers.parseUnits('45', await pToken.decimals()));
    expect(await pToken.balanceOf(Bob.address)).to.equal(ethers.parseUnits('90', await pToken.decimals()));
    expect(await pToken.sharesOf(Dave.address)).to.equal(ethers.parseUnits('55', await pToken.decimals()));
    expect(await pToken.balanceOf(Dave.address)).to.equal(ethers.parseUnits('110', await pToken.decimals()));

    // Admin burns 10 $pTK from Caro
    // Total supply: 295; Bob shares: 45, Caro shares: 45, Dave shares: 55
    let burnAmount = ethers.parseUnits('10', await pToken.decimals());
    // await expect(pToken.connect(Caro).burn(Caro.address, burnAmount)).to.be.rejectedWith('Ownable: caller is not the owner');
    await expect(pToken.connect(Alice).burn(Caro.address, burnAmount))
      .to.emit(pToken, 'Transfer').withArgs(Caro.address, ethers.ZeroAddress, burnAmount)
      .to.emit(pToken, 'TransferShares').withArgs(Caro.address, ethers.ZeroAddress, burnAmount / 2n);
    expect(await pToken.sharesOf(Caro.address)).to.equal(ethers.parseUnits('45', await pToken.decimals()));
    expect(await pToken.balanceOf(Caro.address)).to.equal(ethers.parseUnits('90', await pToken.decimals()));
    expect(await pToken.totalShares()).to.equal(ethers.parseUnits('145', await pToken.decimals()));
    expect(await pToken.totalSupply()).to.equal(ethers.parseUnits('290', await pToken.decimals()));

    // Burn all
    await expect(pToken.connect(Alice).burn(Caro.address, ethers.parseUnits('100', await pToken.decimals()))).to.be.rejected;
    await expect(pToken.connect(Alice).burn(Caro.address, ethers.parseUnits('90', await pToken.decimals()))).not.to.be.rejected;
    await expect(pToken.connect(Alice).burn(Bob.address, ethers.parseUnits('90', await pToken.decimals()))).not.to.be.rejected;
    await expect(pToken.connect(Alice).burn(Dave.address, ethers.parseUnits('110', await pToken.decimals()))).not.to.be.rejected;
    expect(await pToken.totalShares()).to.equal(0);
    expect(await pToken.totalSupply()).to.equal(0);

    mintAmount = ethers.parseUnits('100', await pToken.decimals());
    await expect(pToken.connect(Alice).mint(Bob.address, mintAmount))
      .to.emit(pToken, 'Transfer').withArgs(ethers.ZeroAddress, Bob.address, mintAmount)
      .to.emit(pToken, 'TransferShares').withArgs(ethers.ZeroAddress, Bob.address, mintAmount);
    expect(await pToken.sharesOf(Bob.address)).to.equal(ethers.parseUnits('100', await pToken.decimals()));
    expect(await pToken.balanceOf(Bob.address)).to.equal(ethers.parseUnits('100', await pToken.decimals()));

  });

});
