import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { nativeTokenAddress, deployBaseContractsFixture } from './utils';
import { PlainVault__factory } from "../typechain";

describe('PlainVault', () => {

  it('PlainVault works with $ETH', async () => {
    const { protocol, settings, usd, erc20, Alice, Bob, Caro } = await loadFixture(deployBaseContractsFixture);

    let trans = await protocol.connect(Alice).initialize(await usd.getAddress());
    await trans.wait();

    const PlainVaultFactory = await ethers.getContractFactory("PlainVault");
    const PlainVault = await PlainVaultFactory.deploy(await protocol.getAddress(), await settings.getAddress(), nativeTokenAddress);
    const plainVault = PlainVault__factory.connect(await PlainVault.getAddress(), ethers.provider);
    await expect(plainVault.connect(Alice).updateVaultParamValue(ethers.encodeBytes32String("C"), 0)).not.to.be.reverted;

    // Alice stakes 0.1 $ETH, Bob stakes 0.2 $ETH
    await expect(plainVault.connect(Alice).stake(0)).to.be.rejectedWith('Cannot stake 0');
    await expect(plainVault.connect(Alice).stake(ethers.parseEther("0.1"))).to.be.rejectedWith('Incorrect msg.value');
    await expect(plainVault.connect(Alice).stake(ethers.parseEther("0.1"), {value: ethers.parseUnits("0.001"),})).to.be.rejectedWith('Incorrect msg.value');
    await expect(plainVault.connect(Alice).stake(ethers.parseEther("0.1"), {value: ethers.parseUnits("1"),})).to.be.rejectedWith('Incorrect msg.value');
    trans = await plainVault.connect(Alice).stake(ethers.parseEther("0.1"), {
      value: ethers.parseUnits("0.1"),
    });
    await expect(trans).to.changeEtherBalances([Alice.address, await plainVault.getAddress()], [ethers.parseEther("-0.1"), ethers.parseEther("0.1")]);
    await expect(trans).to.emit(plainVault, "Staked").withArgs(Alice.address, ethers.parseEther("0.1"));
    trans = await plainVault.connect(Bob).stake(ethers.parseEther("0.2"), {
      value: ethers.parseUnits("0.2"),
    });
    expect(await plainVault.balanceOf(Alice.address)).to.equal(ethers.parseEther("0.1"));
    expect(await plainVault.balanceOf(Bob.address)).to.equal(ethers.parseEther("0.2"));
    expect(await plainVault.totalSupply()).to.equal(ethers.parseEther("0.3"));

    // Bob withdraw 0.05 $ETH
    await expect(plainVault.connect(Bob).withdraw(0)).to.be.rejectedWith('Cannot withdraw 0');
    await expect(plainVault.connect(Bob).withdraw(ethers.parseEther("1"))).to.be.rejectedWith('Insufficient balance');
    trans = await plainVault.connect(Bob).withdraw(ethers.parseEther("0.05"));
    await expect(trans).to.changeEtherBalances([Bob.address, await plainVault.getAddress()], [ethers.parseEther("0.05"), ethers.parseEther("-0.05")]);
    await expect(trans).to.emit(plainVault, "Withdrawn").withArgs(Bob.address, 0, ethers.parseEther("0.05"));
    expect(await plainVault.balanceOf(Bob.address)).to.equal(ethers.parseEther("0.15"));
    expect(await plainVault.totalSupply()).to.equal(ethers.parseEther("0.25"));

    // Bob exit all
    trans = await plainVault.connect(Bob).exit();
    await expect(trans).to.changeEtherBalances([Bob.address, await plainVault.getAddress()], [ethers.parseEther("0.15"), ethers.parseEther("-0.15")]);
    await expect(trans).to.emit(plainVault, "Withdrawn").withArgs(Bob.address, 0, ethers.parseEther("0.15"));
    expect(await plainVault.balanceOf(Bob.address)).to.equal(0);
    expect(await plainVault.balanceOf(Alice.address)).to.equal(ethers.parseEther("0.1"));
    expect(await plainVault.totalSupply()).to.equal(ethers.parseEther("0.1"));

    // Anyone could transfer $ETH or ERC20 to the vault
    await expect(plainVault.connect(Alice).rescue(await erc20.getAddress(), Alice.address)).to.be.rejectedWith('No tokens to rescue');
    await expect(plainVault.connect(Alice).rescue(nativeTokenAddress, Alice.address)).to.be.rejectedWith('No tokens to rescue');
    await expect(Caro.sendTransaction({ to: await plainVault.getAddress(), value: ethers.parseEther("0.01") })).not.to.be.rejected;
    await expect(plainVault.connect(Bob).rescue(nativeTokenAddress, Bob.address)).to.be.rejectedWith('Ownable: caller is not the owner');
    expect(await plainVault.totalSupply()).to.equal(ethers.parseEther("0.1"));

    trans = await plainVault.connect(Alice).rescue(nativeTokenAddress, Bob.address);
    await expect(trans).to.changeEtherBalances([Bob.address, await plainVault.getAddress()], [ethers.parseEther("0.01"), ethers.parseEther("-0.01")]);
    await expect(trans).to.emit(plainVault, "TokenRescued").withArgs(nativeTokenAddress, Bob.address, ethers.parseEther("0.01"));

    // Withdraw all, and restake
    await expect(plainVault.connect(Alice).exit()).not.to.be.rejected;
    expect(await plainVault.totalSupply()).to.equal(0);
    trans = await plainVault.connect(Alice).stake(ethers.parseEther("0.001"), {
      value: ethers.parseUnits("0.001"),
    });
    await expect(trans).not.to.be.reverted;
    expect(await plainVault.balanceOf(Alice.address)).to.equal(ethers.parseEther("0.001"));
    expect(await plainVault.totalSupply()).to.equal(ethers.parseEther("0.001"));

    // Set redeem fee to 1%
    await expect(plainVault.connect(Bob).updateVaultParamValue(ethers.encodeBytes32String("C"), 2 * 10 ** 9)).to.be.rejectedWith('Ownable: caller is not the owner');
    await expect(plainVault.connect(Alice).updateVaultParamValue(ethers.encodeBytes32String("C"), 2 * 10 ** 9)).to.be.rejectedWith('Invalid param or value');
    trans = await plainVault.connect(Alice).updateVaultParamValue(ethers.encodeBytes32String("C"), 10 ** 8);
    await expect(trans).to.emit(plainVault, "UpdateVaultParamValue").withArgs(ethers.encodeBytes32String("C"), 10 ** 8);

    // Alice withdraw 0.0005
    trans = await plainVault.connect(Alice).withdraw(ethers.parseEther("0.0005"));
    await expect(trans).to.changeEtherBalances([Alice.address, await settings.treasury(), await plainVault.getAddress()], [ethers.parseEther("0.000495"), ethers.parseEther("0.000005"), ethers.parseEther("-0.0005")]);
    await expect(trans).to.emit(plainVault, "Withdrawn").withArgs(Alice.address, ethers.parseEther("0.000005"), ethers.parseEther("0.000495"));
    expect(await plainVault.balanceOf(Alice.address)).to.equal(ethers.parseEther("0.0005"));
    expect(await plainVault.totalSupply()).to.equal(ethers.parseEther("0.0005"));
    expect(await ethers.provider.getBalance(await plainVault.getAddress())).to.equal(await plainVault.totalSupply())
  });

  it('PlainVault works with ERC20', async () => {
    const { protocol, settings, usd, erc20, Alice, Bob, Caro } = await loadFixture(deployBaseContractsFixture);

    let trans = await protocol.connect(Alice).initialize(await usd.getAddress());
    await trans.wait();

    const PlainVaultFactory = await ethers.getContractFactory("PlainVault");
    const PlainVault = await PlainVaultFactory.deploy(await protocol.getAddress(), await settings.getAddress(), await erc20.getAddress());
    const plainVault = PlainVault__factory.connect(await PlainVault.getAddress(), ethers.provider);
    await expect(plainVault.connect(Alice).updateVaultParamValue(ethers.encodeBytes32String("C"), 0)).not.to.be.reverted;

    await expect(erc20.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000", await erc20.decimals()))).not.to.be.reverted;
    await expect(erc20.connect(Alice).mint(Bob.address, ethers.parseUnits("1000000", await erc20.decimals()))).not.to.be.reverted;
    await expect(erc20.connect(Alice).approve(await plainVault.getAddress(), ethers.parseUnits("1000000", await erc20.decimals()))).not.to.be.reverted;
    await expect(erc20.connect(Bob).approve(await plainVault.getAddress(), ethers.parseUnits("1000000", await erc20.decimals()))).not.to.be.reverted;

    // Alice stakes 0.1 $ERC20, Bob stakes 0.2 $ERC20
    await expect(plainVault.connect(Alice).stake(0)).to.be.rejectedWith('Cannot stake 0');
    await expect(plainVault.connect(Alice).stake(ethers.parseUnits("0.1"), {value: ethers.parseUnits("0.001"),})).to.be.rejectedWith('msg.value should be 0');
    await expect(plainVault.connect(Alice).stake(ethers.parseUnits("0.1"), {value: ethers.parseUnits("1"),})).to.be.rejectedWith('msg.value should be 0');
    trans = await plainVault.connect(Alice).stake(ethers.parseUnits("0.1"));
    await expect(trans).to.changeTokenBalances(erc20, [Alice.address, await plainVault.getAddress()], [ethers.parseUnits("-0.1"), ethers.parseUnits("0.1")]);
    await expect(trans).to.emit(plainVault, "Staked").withArgs(Alice.address, ethers.parseEther("0.1"));
    trans = await plainVault.connect(Bob).stake(ethers.parseUnits("0.2"));
    expect(await plainVault.balanceOf(Alice.address)).to.equal(ethers.parseUnits("0.1"));
    expect(await plainVault.balanceOf(Bob.address)).to.equal(ethers.parseUnits("0.2"));
    expect(await plainVault.totalSupply()).to.equal(ethers.parseUnits("0.3"));

    // Bob withdraw 0.05 $ERC20
    await expect(plainVault.connect(Bob).withdraw(0)).to.be.rejectedWith('Cannot withdraw 0');
    await expect(plainVault.connect(Bob).withdraw(ethers.parseUnits("1"))).to.be.rejectedWith('Insufficient balance');
    trans = await plainVault.connect(Bob).withdraw(ethers.parseUnits("0.05"));
    await expect(trans).to.changeTokenBalances(erc20, [Bob.address, await plainVault.getAddress()], [ethers.parseUnits("0.05"), ethers.parseUnits("-0.05")]);
    await expect(trans).to.emit(plainVault, "Withdrawn").withArgs(Bob.address, 0, ethers.parseUnits("0.05"));
    expect(await plainVault.balanceOf(Bob.address)).to.equal(ethers.parseUnits("0.15"));
    expect(await plainVault.totalSupply()).to.equal(ethers.parseUnits("0.25"));

    // Bob exit all
    trans = await plainVault.connect(Bob).exit();
    await expect(trans).to.changeTokenBalances(erc20, [Bob.address, await plainVault.getAddress()], [ethers.parseUnits("0.15"), ethers.parseUnits("-0.15")]);
    await expect(trans).to.emit(plainVault, "Withdrawn").withArgs(Bob.address, 0, ethers.parseUnits("0.15"));
    expect(await plainVault.balanceOf(Bob.address)).to.equal(0);
    expect(await plainVault.balanceOf(Alice.address)).to.equal(ethers.parseUnits("0.1"));
    expect(await plainVault.totalSupply()).to.equal(ethers.parseUnits("0.1"));

    // Anyone could transfer $ETH or ERC20 to the vault
    await expect(plainVault.connect(Alice).rescue(await erc20.getAddress(), Alice.address)).to.be.rejectedWith('No tokens to rescue');
    await expect(plainVault.connect(Alice).rescue(nativeTokenAddress, Alice.address)).to.be.rejectedWith('No tokens to rescue');
    await expect(erc20.connect(Alice).transfer(await plainVault.getAddress(), ethers.parseUnits("0.01"))).not.to.be.rejected;
    await expect(plainVault.connect(Bob).rescue(await erc20.getAddress(), Bob.address)).to.be.rejectedWith('Ownable: caller is not the owner');
    expect(await plainVault.totalSupply()).to.equal(ethers.parseEther("0.1"));

    trans = await plainVault.connect(Alice).rescue(await erc20.getAddress(), Bob.address);
    await expect(trans).to.changeTokenBalances(erc20, [Bob.address, await plainVault.getAddress()], [ethers.parseUnits("0.01"), ethers.parseUnits("-0.01")]);
    await expect(trans).to.emit(plainVault, "TokenRescued").withArgs(await erc20.getAddress(), Bob.address, ethers.parseUnits("0.01"));

    // Withdraw all, and restake
    await expect(plainVault.connect(Alice).exit()).not.to.be.rejected;
    expect(await plainVault.totalSupply()).to.equal(0);
    trans = await plainVault.connect(Alice).stake(ethers.parseEther("0.001"));
    await expect(trans).not.to.be.reverted;
    expect(await plainVault.balanceOf(Alice.address)).to.equal(ethers.parseUnits("0.001"));
    expect(await plainVault.totalSupply()).to.equal(ethers.parseEther("0.001"));

    // Set redeem fee to 1%
    await expect(plainVault.connect(Bob).updateVaultParamValue(ethers.encodeBytes32String("C"), 2 * 10 ** 9)).to.be.rejectedWith('Ownable: caller is not the owner');
    await expect(plainVault.connect(Alice).updateVaultParamValue(ethers.encodeBytes32String("C"), 2 * 10 ** 9)).to.be.rejectedWith('Invalid param or value');
    trans = await plainVault.connect(Alice).updateVaultParamValue(ethers.encodeBytes32String("C"), 10 ** 8);
    await expect(trans).to.emit(plainVault, "UpdateVaultParamValue").withArgs(ethers.encodeBytes32String("C"), 10 ** 8);

    // Alice withdraw 0.0005
    trans = await plainVault.connect(Alice).withdraw(ethers.parseEther("0.0005"));
    await expect(trans).to.changeTokenBalances(erc20, [Alice.address, await settings.treasury(), await plainVault.getAddress()], [ethers.parseEther("0.000495"), ethers.parseEther("0.000005"), ethers.parseEther("-0.0005")]);
    await expect(trans).to.emit(plainVault, "Withdrawn").withArgs(Alice.address, ethers.parseEther("0.000005"), ethers.parseEther("0.000495"));
    expect(await plainVault.balanceOf(Alice.address)).to.equal(ethers.parseEther("0.0005"));
    expect(await plainVault.totalSupply()).to.equal(ethers.parseEther("0.0005"));
    expect(await erc20.balanceOf(await plainVault.getAddress())).to.equal(await plainVault.totalSupply());

    // Insufficient blance or approval fails
    await expect(erc20.connect(Alice).mint(Caro.address, ethers.parseUnits("100", await erc20.decimals()))).not.to.be.reverted;
    await expect(erc20.connect(Caro).approve(await plainVault.getAddress(), ethers.parseUnits("10", await erc20.decimals()))).not.to.be.reverted;
    await expect(plainVault.connect(Caro).stake(ethers.parseUnits("20", await erc20.decimals()))).to.be.rejectedWith('ERC20: insufficient allowance');
    await expect(erc20.connect(Caro).approve(await plainVault.getAddress(), ethers.parseUnits("1000", await erc20.decimals()))).not.to.be.reverted;
    await expect(plainVault.connect(Caro).stake(ethers.parseUnits("200", await erc20.decimals()))).to.be.rejectedWith('ERC20: transfer amount exceeds balance');

  });

});
