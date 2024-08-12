import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { nativeTokenAddress, deployBaseContractsFixture } from './utils';
import { TokenPot__factory } from "../typechain";

describe('TokenPot', () => {

  it('TokenPot works', async () => {
    const { protocol, settings, usd, erc20, stETH, Alice, Bob } = await loadFixture(deployBaseContractsFixture);

    let trans = await protocol.connect(Alice).initialize(await usd.getAddress());
    await trans.wait();

    const TokenPotFactory = await ethers.getContractFactory("TokenPot");
    const TokenPot = await TokenPotFactory.deploy(await protocol.getAddress(), await settings.getAddress());
    const tokenPot = TokenPot__factory.connect(await TokenPot.getAddress(), ethers.provider);

    // $ETH works
    const ethAmount = ethers.parseEther('1.111');
    await expect(Alice.sendTransaction({ to: await tokenPot.getAddress(), value: ethAmount }))
      .to.changeEtherBalances([Alice, tokenPot], [ethAmount * (-1n), ethAmount]);
    expect(await ethers.provider.getBalance(await tokenPot.getAddress())).to.equal(ethAmount);

    // ERC20 works
    const erc20Amount = ethers.parseUnits('100', await erc20.decimals());
    await expect(erc20.connect(Alice).mint(await tokenPot.getAddress(), erc20Amount))
      .to.changeTokenBalance(erc20, tokenPot, erc20Amount);
    expect(await erc20.balanceOf(await tokenPot.getAddress())).to.equal(erc20Amount);

    // Rebasable ERC20 works
    const stETHAmount = ethers.parseUnits('100', await stETH.decimals());
    await expect(stETH.connect(Alice).mint(await tokenPot.getAddress(), stETHAmount))
      .to.changeTokenBalance(stETH, tokenPot, stETHAmount);
    expect(await stETH.balanceOf(await tokenPot.getAddress())).to.equal(stETHAmount);
    await expect(stETH.connect(Alice).addRewards(stETHAmount)).not.to.be.reverted;
    expect(await stETH.balanceOf(await tokenPot.getAddress())).to.equal(stETHAmount * (2n));

    // Only owner could withdraw
    await expect(tokenPot.connect(Bob).withdraw(Bob.address, nativeTokenAddress, ethAmount)).to.be.revertedWith('TokenPot: caller is not the owner');
    await expect(tokenPot.connect(Bob).withdraw(Bob.address, await erc20.getAddress(), erc20Amount)).to.be.revertedWith('TokenPot: caller is not the owner');
    await expect(tokenPot.connect(Bob).withdraw(Bob.address, await stETH.getAddress(), stETHAmount)).to.be.revertedWith('TokenPot: caller is not the owner');

    let tx = tokenPot.connect(Alice).withdraw(Bob.address, nativeTokenAddress, ethAmount / (2n));
    await expect(tx)
      .to.changeEtherBalances([tokenPot, Bob], [ethAmount / (2n) * (-1n), ethAmount / (2n)]);
    await expect(tx)
      .to.emit(tokenPot, 'Withdrawn').withArgs(Alice.address, Bob.address, nativeTokenAddress, ethAmount / (2n));
    expect(await ethers.provider.getBalance(await tokenPot.getAddress())).to.equal(ethAmount / (2n));

    tx = tokenPot.connect(Alice).withdraw(Bob.address, await erc20.getAddress(), erc20Amount / (2n));
    await expect(tx)
      .to.changeTokenBalance(erc20, tokenPot, erc20Amount / (2n) * (-1n));
    await expect(tx)
      .to.changeTokenBalance(erc20, Bob, erc20Amount / (2n));
    await expect(tx)
      .to.emit(tokenPot, 'Withdrawn').withArgs(Alice.address, Bob.address, await erc20.getAddress(), erc20Amount / (2n));
    expect(await erc20.balanceOf(await tokenPot.getAddress())).to.equal(erc20Amount / (2n));

    tx = tokenPot.connect(Alice).withdraw(Bob.address, await stETH.getAddress(), stETHAmount / (2n));
    await expect(tx)
      .to.changeTokenBalance(stETH, tokenPot, stETHAmount / (2n) * (-1n));
    await expect(tx)
      .to.changeTokenBalance(stETH, Bob, stETHAmount / (2n));
    await expect(tx)
      .to.emit(tokenPot, 'Withdrawn').withArgs(Alice.address, Bob.address, await stETH.getAddress(), stETHAmount / (2n));
    expect(await stETH.balanceOf(await tokenPot.getAddress())).to.equal(stETHAmount * (2n) * (3n) / (4n));

  });

});
