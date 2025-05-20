import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { time, loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { ONE_DAY_IN_SECS, deployContractsFixture, expectBigNumberEquals } from './utils';
import { 
  MockVault, StakingBribesPool, MockERC20,
  MockVault__factory, StakingBribesPool__factory,
  MockERC20__factory
} from "../typechain";

describe('StakingBribesPool', () => {

  let mockVault: MockVault;
  let bribesPool: StakingBribesPool;
  let iBGT8Token: MockERC20;

  beforeEach(async () => {
    const { protocol, settings, stakingPool, iBGT, iBGT8, Alice } = await loadFixture(deployContractsFixture);
    iBGT8Token = iBGT8;

    const MockVaultFactory = await ethers.getContractFactory("MockVault");
    const MockVault = await MockVaultFactory.deploy(
      await protocol.getAddress(), await settings.getAddress(), await stakingPool.getAddress(),
      await iBGT.getAddress(), "Zoo piBGT", "piBGT"
    );
    mockVault = MockVault__factory.connect(await MockVault.getAddress(), ethers.provider);

    let trans = await protocol.connect(Alice).addVault(await mockVault.getAddress());
    await trans.wait();
    await settings.connect(Alice).updateVaultParamValue(await mockVault.getAddress(), ethers.encodeBytes32String("f1"), 0);
    await settings.connect(Alice).updateVaultParamValue(await mockVault.getAddress(), ethers.encodeBytes32String("f2"), 0);

    const StakingBribesPoolFactory = await ethers.getContractFactory("StakingBribesPool");
    const StakingBribesPool = await StakingBribesPoolFactory.deploy(await mockVault.getAddress());
    bribesPool = StakingBribesPool__factory.connect(await StakingBribesPool.getAddress(), ethers.provider);

    await expect(iBGT.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000000000000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(iBGT8.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000000000000000", await iBGT8.decimals()))).not.to.be.reverted;
  });

  it('StakingBribesPool works', async () => {
    const [Alice, Bob, Caro] = await ethers.getSigners();

    const iBGT = MockERC20__factory.connect(await mockVault.assetToken(), ethers.provider);

    const genesisTime = (await time.latest()) + ONE_DAY_IN_SECS;

    // Cannot add bribes if no YT is staked
    await expect(iBGT.connect(Alice).approve(await mockVault.getAddress(), ethers.parseUnits("1", await iBGT.decimals()))).not.to.be.reverted;
    await expect(mockVault.connect(Alice).mockAddBribes(
      bribesPool,
      await iBGT.getAddress(),
      ethers.parseUnits("1", await iBGT.decimals()))
    ).to.be.revertedWith('Cannot add bribes without YT staked');

    // Bob swaps for 800 YT, and Caro swaps for 200 YT
    let bobYTAmount = ethers.parseUnits('800');
    let caroYTAmount = ethers.parseUnits('200');
    await expect(bribesPool.connect(Alice).notifyYTSwappedForUser(Bob.address, bobYTAmount)).to.be.revertedWith("Caller is not Vault");
    let trans = await mockVault.connect(Alice).mockNotifyYTSwappedForUser(await bribesPool.getAddress(), Bob.address, bobYTAmount);
    await expect(trans).to.emit(bribesPool, "YTSwapped").withArgs(Bob.address, bobYTAmount);
    trans = await mockVault.connect(Alice).mockNotifyYTSwappedForUser(await bribesPool.getAddress(), Caro.address, caroYTAmount);
    await expect(trans).to.emit(bribesPool, "YTSwapped").withArgs(Caro.address, caroYTAmount);
    expect(await bribesPool.balanceOf(Bob.address)).to.equal(bobYTAmount);
    expect(await bribesPool.balanceOf(Caro.address)).to.equal(caroYTAmount);
    expect(await bribesPool.totalSupply()).to.equal(bobYTAmount + caroYTAmount);

    // Deposit 10000 $iBGT as bribes
    await time.increaseTo(genesisTime);
    let totalBribes = ethers.parseUnits('10000', await iBGT.decimals());
    await expect(bribesPool.connect(Alice).addBribes(await iBGT.getAddress(), totalBribes)).to.be.revertedWith("Caller is not Vault");
    await expect(iBGT.connect(Alice).approve(await mockVault.getAddress(), totalBribes)).not.to.be.reverted;
    trans = await mockVault.connect(Alice).mockAddBribes(bribesPool, await iBGT.getAddress(), totalBribes);
    await expect(trans)
      .to.emit(bribesPool, 'BribeTokenAdded').withArgs(await iBGT.getAddress())
      .to.emit(bribesPool, 'BribesAdded').withArgs(await iBGT.getAddress(), totalBribes);
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address, await bribesPool.getAddress()],
      [-totalBribes, totalBribes]
    );

    // Bob should immediately get 4/5 bribes, and Caro should get 1/5 bribes
    expectBigNumberEquals(totalBribes * 4n / 5n, await bribesPool.earned(Bob.address, await iBGT.getAddress()));
    expectBigNumberEquals(totalBribes * 1n / 5n, await bribesPool.earned(Caro.address, await iBGT.getAddress()));

    // Bob claim bribes
    let bobBribes = totalBribes * 4n / 5n;
    let caroBribes = totalBribes * 1n / 5n;
    trans = await bribesPool.connect(Bob).getBribes();
    await expect(trans)
      .to.emit(bribesPool, 'BribesPaid').withArgs(Bob.address, await iBGT.getAddress(), bobBribes);
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Bob.address, await bribesPool.getAddress()],
      [bobBribes, -bobBribes]
    );
    expectBigNumberEquals(0n, await bribesPool.earned(Bob.address, await iBGT.getAddress()));

    // Caro swaps for another 200 YT
    let caroYTAmount2 = ethers.parseUnits('200');
    caroYTAmount = caroYTAmount + caroYTAmount2;  // 400
    trans = await mockVault.connect(Alice).mockNotifyYTSwappedForUser(await bribesPool.getAddress(), Caro.address, caroYTAmount2);
    await expect(trans).to.emit(bribesPool, "YTSwapped").withArgs(Caro.address, caroYTAmount2);
    expect(await bribesPool.balanceOf(Bob.address)).to.equal(bobYTAmount);
    expect(await bribesPool.balanceOf(Caro.address)).to.equal(caroYTAmount);
    expect(await bribesPool.totalSupply()).to.equal(bobYTAmount + caroYTAmount);
    
    // Add another round of bribes
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 5);
    const round2Bribes = ethers.parseUnits('30000');
    await expect(iBGT.connect(Alice).approve(await mockVault.getAddress(), round2Bribes)).not.to.be.reverted;
    trans = await mockVault.connect(Alice).mockAddBribes(bribesPool, await iBGT.getAddress(), round2Bribes);
    await expect(trans)
      .to.emit(bribesPool, 'BribesAdded').withArgs(await iBGT.getAddress(), round2Bribes);
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address, await bribesPool.getAddress()],
      [-round2Bribes, round2Bribes]
    );

    // Bob should get 2/3 rewards, and Caro should get 1/3 rewards
    let iBGTBobBribes = round2Bribes * 2n / 3n;  // 20000
    let iBGTCaroBribes = caroBribes + round2Bribes * 1n / 3n;  // 8000 + 10000
    expectBigNumberEquals(iBGTBobBribes, await bribesPool.earned(Bob.address, await iBGT.getAddress()));
    expectBigNumberEquals(iBGTCaroBribes, await bribesPool.earned(Caro.address, await iBGT.getAddress()));

    // Fast-forward to Day 9. Add new iBGT8 rewards
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 9);
    let iBGT8Bribes = ethers.parseUnits('3000', await iBGT8Token.decimals());
    await expect(iBGT8Token.connect(Alice).approve(await mockVault.getAddress(), iBGT8Bribes)).not.to.be.reverted;
    trans = await mockVault.connect(Alice).mockAddBribes(bribesPool, await iBGT8Token.getAddress(), iBGT8Bribes);
    await expect(trans)
      .to.emit(bribesPool, 'BribeTokenAdded').withArgs(await iBGT8Token.getAddress())
      .to.emit(bribesPool, 'BribesAdded').withArgs(await iBGT8Token.getAddress(), iBGT8Bribes);
    await expect(trans).to.changeTokenBalances(
      iBGT8Token,
      [Alice.address, await bribesPool.getAddress()],
      [-iBGT8Bribes, iBGT8Bribes]
    );

    let iBGT8BobBribes = iBGT8Bribes * 2n / 3n;
    let iBGT8CaroBribes = iBGT8Bribes * 1n / 3n;
    expectBigNumberEquals(iBGT8BobBribes, await bribesPool.earned(Bob.address, await iBGT8Token.getAddress()));
    expectBigNumberEquals(iBGT8CaroBribes, await bribesPool.earned(Caro.address, await iBGT8Token.getAddress()));

    expect(await bribesPool.bribeTokens()).to.deep.equal([await iBGT.getAddress(), await iBGT8Token.getAddress()]);

    // Caro claims all bribes
    trans = await bribesPool.connect(Caro).getBribes();
    await expect(trans)
      .to.emit(bribesPool, 'BribesPaid').withArgs(Caro.address, await iBGT.getAddress(), iBGTCaroBribes)
      .to.emit(bribesPool, 'BribesPaid').withArgs(Caro.address, await iBGT8Token.getAddress(), iBGT8CaroBribes);
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Caro.address, await bribesPool.getAddress()],
      [iBGTCaroBribes, -iBGTCaroBribes]
    );
    await expect(trans).to.changeTokenBalances(
      iBGT8Token,
      [Caro.address, await bribesPool.getAddress()],
      [iBGT8CaroBribes, -iBGT8CaroBribes]
    );
    expectBigNumberEquals(0n, await bribesPool.earned(Caro.address, await iBGT.getAddress()));
    expectBigNumberEquals(0n, await bribesPool.earned(Caro.address, await iBGT8Token.getAddress()));

    bobYTAmount = ethers.parseUnits('800');
    caroYTAmount = ethers.parseUnits('400');
    expect(await bribesPool.balanceOf(Bob.address)).to.equal(bobYTAmount);
    expect(await bribesPool.balanceOf(Caro.address)).to.equal(caroYTAmount);

    // Bob swaps for another 400 YT
    let bobYTAmount2 = ethers.parseUnits('400');
    bobYTAmount = ethers.parseUnits('1200');
    trans = await mockVault.connect(Alice).mockNotifyYTSwappedForUser(await bribesPool.getAddress(), Bob.address, bobYTAmount2);
    await expect(trans).to.emit(bribesPool, "YTSwapped").withArgs(Bob.address, bobYTAmount2);
    expect(await bribesPool.balanceOf(Bob.address)).to.equal(bobYTAmount); // 1200
    expect(await bribesPool.balanceOf(Caro.address)).to.equal(caroYTAmount);  // 400
    expect(await bribesPool.totalSupply()).to.equal(bobYTAmount + caroYTAmount);  // 1600

    iBGTBobBribes = ethers.parseUnits('20000', await iBGT.decimals());
    iBGT8BobBribes = ethers.parseUnits('2000', await iBGT8Token.decimals());
    expectBigNumberEquals(iBGTBobBribes, await bribesPool.earned(Bob.address, await iBGT.getAddress()));
    expectBigNumberEquals(iBGT8BobBribes, await bribesPool.earned(Bob.address, await iBGT8Token.getAddress()));

    // Fast-forward to Day 10. Add new iBGT rewards
    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 10);
    let iBGTBribes = ethers.parseUnits('1600', await iBGT.decimals());
    await expect(iBGT.connect(Alice).approve(await mockVault.getAddress(), iBGTBribes)).not.to.be.reverted;
    trans = await mockVault.connect(Alice).mockAddBribes(bribesPool, await iBGT.getAddress(), iBGTBribes);
    await expect(trans)
      .to.emit(bribesPool, 'BribesAdded').withArgs(await iBGT.getAddress(), iBGTBribes);
    await expect(trans).to.changeTokenBalances(
      iBGT,
      [Alice.address, await bribesPool.getAddress()],
      [-iBGTBribes, iBGTBribes]
    );

    iBGTBobBribes = ethers.parseUnits('21200', await iBGT.decimals());
    iBGT8BobBribes = ethers.parseUnits('2000', await iBGT8Token.decimals());
    expectBigNumberEquals(iBGTBobBribes, await bribesPool.earned(Bob.address, await iBGT.getAddress()));
    expectBigNumberEquals(iBGT8BobBribes, await bribesPool.earned(Bob.address, await iBGT8Token.getAddress()));

    iBGTCaroBribes = ethers.parseUnits('400', await iBGT.decimals());
    iBGT8CaroBribes = 0n;
    expectBigNumberEquals(iBGTCaroBribes, await bribesPool.earned(Caro.address, await iBGT.getAddress()));
    expectBigNumberEquals(iBGT8CaroBribes, await bribesPool.earned(Caro.address, await iBGT8Token.getAddress()));

     // Bob claims bribes for a specific token
     trans = await bribesPool.connect(Bob).getBribe(await iBGT.getAddress());
     await expect(trans)
       .to.emit(bribesPool, 'BribesPaid').withArgs(Bob.address, await iBGT.getAddress(), iBGTBobBribes);
     await expect(trans).to.changeTokenBalances(
       iBGT,
       [Bob.address, await bribesPool.getAddress()],
       [iBGTBobBribes, -iBGTBobBribes]
     );
     expectBigNumberEquals(0n, await bribesPool.earned(Bob.address, await iBGT.getAddress()));
 
     // Caro claims bribes for a specific token
     trans = await bribesPool.connect(Caro).getBribe(await iBGT.getAddress());
     await expect(trans)
       .to.emit(bribesPool, 'BribesPaid').withArgs(Caro.address, await iBGT.getAddress(), iBGTCaroBribes);
     await expect(trans).to.changeTokenBalances(
       iBGT,
       [Caro.address, await bribesPool.getAddress()],
       [iBGTCaroBribes, -iBGTCaroBribes]
     );
     expectBigNumberEquals(0n, await bribesPool.earned(Caro.address, await iBGT.getAddress()));
  });

});
