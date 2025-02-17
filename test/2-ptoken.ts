import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { deployContractsFixture, expectBigNumberEquals } from './utils';
import { 
  MockPToken__factory
} from '../typechain';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';

const { provider } = ethers;

describe('PToken', () => {

  it('PToken works', async () => {

    const { Alice, Bob, Caro, Dave, protocol, settings } = await loadFixture(deployContractsFixture);

    const MockPTokenFactory = await ethers.getContractFactory('MockPToken');
    const MockPToken = await MockPTokenFactory.deploy(await protocol.getAddress(), await settings.getAddress());
    const pToken = MockPToken__factory.connect(await MockPToken.getAddress(), provider);

    const decimalsOffset = await pToken.decimalsOffset();

    // Alice mint 100 $pTK to Bob.
    // Bobs share: 100
    let mintAmount = ethers.parseUnits('100', await pToken.decimals());
    let sharesMintAmount = mintAmount * (10n ** decimalsOffset);
    // await expect(pToken.connect(Bob).mint(Bob.address, mintAmount)).to.be.rejectedWith('Ownable: caller is not the owner');
    await expect(pToken.connect(Alice).mint(Bob.address, mintAmount))
      .to.emit(pToken, 'Transfer').withArgs(ethers.ZeroAddress, Bob.address, mintAmount)
      .to.emit(pToken, 'TransferShares').withArgs(ethers.ZeroAddress, Bob.address, sharesMintAmount);
    expect(await pToken.sharesOf(Bob.address)).to.equal(sharesMintAmount);
    expect(await pToken.balanceOf(Bob.address)).to.equal(ethers.parseUnits('100', await pToken.decimals()));
    await expect(pToken.connect(Alice).burn(Bob.address, ethers.parseUnits('200', await pToken.decimals()))).to.be.rejectedWith('Balance exceeded');

    // Bob transfer 50 $pTK to Caro.
    // Bob shares: 50; Caro shares: 50
    let transferAmount = ethers.parseUnits('50', await pToken.decimals());
    let sharesTransferAmount = transferAmount * (10n ** decimalsOffset);
    await expect(pToken.connect(Bob).transfer(Caro.address, transferAmount)).not.to.be.rejected;
    expect(await pToken.sharesOf(Bob.address)).to.equal(sharesMintAmount - sharesTransferAmount);
    expect(await pToken.balanceOf(Bob.address)).to.equal(ethers.parseUnits('50', await pToken.decimals()));
    expect(await pToken.sharesOf(Caro.address)).to.equal(sharesTransferAmount);
    expect(await pToken.balanceOf(Caro.address)).to.equal(ethers.parseUnits('50', await pToken.decimals()));

    // Admin rebase supply from 100 $pTK to 200 $pTK
    let rebaseAmount = ethers.parseUnits('100', await pToken.decimals());
    // await expect(pToken.connect(Bob).rebase(rebaseAmount)).to.be.rejectedWith('Ownable: caller is not the owner');
    await expect(pToken.connect(Alice).rebase(rebaseAmount))
      .to.emit(pToken, 'Rebased').withArgs(rebaseAmount);
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('100', await pToken.decimals()));
    expectBigNumberEquals(await pToken.balanceOf(Caro.address), ethers.parseUnits('100', await pToken.decimals()));

    // Admin mint 100 $pTK to Dave.
    // Total supply: 300; Bob shares: 50, Caro shares: 50, Dave shares: 50
    mintAmount = ethers.parseUnits('100', await pToken.decimals());
    sharesMintAmount = ethers.parseUnits('50', await pToken.decimals() + decimalsOffset);
    await expect(pToken.connect(Alice).mint(Dave.address, mintAmount))
      .to.emit(pToken, 'Transfer').withArgs(ethers.ZeroAddress, Dave.address, mintAmount)
      .to.emit(pToken, 'TransferShares').withArgs(ethers.ZeroAddress, Dave.address, anyValue);
    expectBigNumberEquals(await pToken.sharesOf(Dave.address), sharesMintAmount);

    // Dave directly transfer 10 shares to Bob
    // Total supply: 300; Bob shares: 60, Caro shares: 50, Dave shares: 40
    sharesTransferAmount = ethers.parseUnits('10', (await pToken.decimals() + decimalsOffset));
    await expect(pToken.connect(Dave).transferShares(Bob.address, sharesTransferAmount))
      .emit(pToken, 'Transfer').withArgs(Dave.address, Bob.address, anyValue)
      .emit(pToken, 'TransferShares').withArgs(Dave.address, Bob.address, sharesTransferAmount);
    expect(await pToken.sharesOf(Bob.address)).to.equal(ethers.parseUnits('60', (await pToken.decimals() + decimalsOffset)));
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('120', await pToken.decimals()));
    
    // Bob approve Caro to transfer 20 $pTK to Dave
    // Total supply: 300; Bob shares: 50, Caro shares: 50, Dave shares: 50
    let allowance = ethers.parseUnits('20', await pToken.decimals());
    await expect(pToken.connect(Bob).approve(Caro.address, allowance))
      .to.emit(pToken, 'Approval').withArgs(Bob.address, Caro.address, allowance);
    await expect(pToken.connect(Caro).transferFrom(Bob.address, Dave.address, allowance * 2n)).to.be.rejectedWith('Allowance exceeded');
    await expect(pToken.connect(Caro).transferFrom(Bob.address, Dave.address, allowance))
      .to.emit(pToken, 'Transfer').withArgs(Bob.address, Dave.address, allowance)
      .to.emit(pToken, 'TransferShares').withArgs(Bob.address, Dave.address, anyValue);
    expectBigNumberEquals(await pToken.sharesOf(Bob.address), ethers.parseUnits('50', (await pToken.decimals() + decimalsOffset)));
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('100', await pToken.decimals()));

    // Bob increase 10 $pTK allowance to Caro
    await expect(pToken.connect(Caro).transferFrom(Bob.address, Dave.address, allowance)).to.be.rejectedWith('Allowance exceeded');
    await expect(pToken.connect(Bob).increaseAllowance(Caro.address, allowance))
      .to.emit(pToken, 'Approval').withArgs(Bob.address, Caro.address, allowance);
    await expect(pToken.connect(Bob).decreaseAllowance(Caro.address, allowance / 2n))
      .to.emit(pToken, 'Approval').withArgs(Bob.address, Caro.address, allowance / 2n);
    
    // Caro transfer 5 shares (10 $pTK) from Bob to Dave
    // Total supply: 300; Bob shares: 45, Caro shares: 50, Dave shares: 55
    sharesTransferAmount = ethers.parseUnits('5', await pToken.decimals() + decimalsOffset);
    await expect(pToken.connect(Caro).transferSharesFrom(Bob.address, Dave.address, sharesTransferAmount))
      .to.emit(pToken, 'Transfer').withArgs(Bob.address, Dave.address, anyValue)
      .to.emit(pToken, 'TransferShares').withArgs(Bob.address, Dave.address, sharesTransferAmount);
    expectBigNumberEquals(await pToken.sharesOf(Bob.address), ethers.parseUnits('45', await pToken.decimals() + decimalsOffset));
    expectBigNumberEquals(await pToken.balanceOf(Bob.address), ethers.parseUnits('90', await pToken.decimals()));
    expectBigNumberEquals(await pToken.sharesOf(Dave.address), ethers.parseUnits('55', await pToken.decimals() + decimalsOffset));
    expectBigNumberEquals(await pToken.balanceOf(Dave.address), ethers.parseUnits('110', await pToken.decimals()));

    // Admin burns 10 $pTK from Caro
    // Total supply: 295; Bob shares: 45, Caro shares: 45, Dave shares: 55
    let burnAmount = ethers.parseUnits('10', await pToken.decimals());
    // await expect(pToken.connect(Caro).burn(Caro.address, burnAmount)).to.be.rejectedWith('Ownable: caller is not the owner');
    await expect(pToken.connect(Alice).burn(Caro.address, burnAmount))
      .to.emit(pToken, 'Transfer').withArgs(Caro.address, ethers.ZeroAddress, burnAmount)
      .to.emit(pToken, 'TransferShares').withArgs(Caro.address, ethers.ZeroAddress, anyValue);
    expectBigNumberEquals(await pToken.sharesOf(Caro.address), ethers.parseUnits('45', await pToken.decimals() + decimalsOffset));
    expectBigNumberEquals(await pToken.balanceOf(Caro.address), ethers.parseUnits('90', await pToken.decimals()));
    expectBigNumberEquals(await pToken.totalShares(), ethers.parseUnits('145', await pToken.decimals() + decimalsOffset));
    expectBigNumberEquals(await pToken.totalSupply(), ethers.parseUnits('290', await pToken.decimals()));

    // Burn all
    await expect(pToken.connect(Alice).burn(Caro.address, ethers.parseUnits('100', await pToken.decimals()))).to.be.rejected;
    await expect(pToken.connect(Alice).burn(Caro.address, await pToken.balanceOf(Caro.address))).not.to.be.rejected;
    await expect(pToken.connect(Alice).burn(Bob.address, await pToken.balanceOf(Bob.address))).not.to.be.rejected;
    await expect(pToken.connect(Alice).burn(Dave.address, await pToken.balanceOf(Dave.address))).not.to.be.rejected;
    // expect(await pToken.totalShares()).to.equal(0);
    // expect(await pToken.totalSupply()).to.equal(0);

    mintAmount = ethers.parseUnits('100', await pToken.decimals());
    await expect(pToken.connect(Alice).mint(Bob.address, mintAmount))
      .to.emit(pToken, 'Transfer').withArgs(ethers.ZeroAddress, Bob.address, mintAmount)
      .to.emit(pToken, 'TransferShares').withArgs(ethers.ZeroAddress, Bob.address, anyValue);

    mintAmount = ethers.parseUnits('50', await pToken.decimals());
    await expect(pToken.connect(Alice).mint(Caro.address, mintAmount))
      .to.emit(pToken, 'Transfer').withArgs(ethers.ZeroAddress, Caro.address, mintAmount)
      .to.emit(pToken, 'TransferShares').withArgs(ethers.ZeroAddress, Caro.address, anyValue);

    let bobSharesAmount = await pToken.sharesOf(Bob.address);
    let caroSharesAmount = await pToken.sharesOf(Caro.address);
    console.log('Bob shares:', bobSharesAmount.toString());
    console.log('Caro shares:', caroSharesAmount.toString());
    expectBigNumberEquals(bobSharesAmount, caroSharesAmount * 2n);

  });

});
