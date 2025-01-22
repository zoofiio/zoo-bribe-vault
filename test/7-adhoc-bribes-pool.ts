import _ from 'lodash';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { time, loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { ONE_DAY_IN_SECS, deployContractsFixture, expectBigNumberEquals } from './utils';
import { 
  MockVault, AdhocBribesPool, MockERC20,
  MockVault__factory, AdhocBribesPool__factory,
  MockERC20__factory
} from "../typechain";

describe('AdhocBribesPool', () => {

  let mockVault: MockVault;
  let bribesPool: AdhocBribesPool;
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

    const AdhocBribesPoolFactory = await ethers.getContractFactory("AdhocBribesPool");
    const AdhocBribesPool = await AdhocBribesPoolFactory.deploy(await mockVault.getAddress(), await time.latest() + 60);
    bribesPool = AdhocBribesPool__factory.connect(await AdhocBribesPool.getAddress(), ethers.provider);

    await expect(iBGT.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000000000000000", await iBGT.decimals()))).not.to.be.reverted;
    await expect(iBGT8.connect(Alice).mint(Alice.address, ethers.parseUnits("1000000000000000000", await iBGT8.decimals()))).not.to.be.reverted;
  });

  /**
   * second 0: Bob swaps for 10 YT
   * second +11 (+10s): Bob swaps for 20 YT
   * second +6 (+5s): Bob swaps for 30 YT
   * second +11 (+10s): Bob collects YT
   * second +9 (+5s): Caro swaps for 10 YT
   * second +13 (+10s): Caro collects YT
   * - second +5: Epoch ends
   * second +10? (+10s): Caro collects YT
   */
  it('AdhocBribesPool Time Weighted YT Works', async () => {
    const [Alice, Bob, Caro] = await ethers.getSigners();

    const iBGT = MockERC20__factory.connect(await mockVault.assetToken(), ethers.provider);

    // Cannot add bribes if no YT is staked
    await expect(iBGT.connect(Alice).approve(await mockVault.getAddress(), ethers.parseUnits("1", await iBGT.decimals()))).not.to.be.reverted;
    await expect(mockVault.connect(Alice).mockAddBribes(
      bribesPool,
      await iBGT.getAddress(),
      ethers.parseUnits("1", await iBGT.decimals()))
    ).to.be.revertedWith('Cannot add bribes without YT staked');

    // Bob swaps for 10 YT
    let bobYTAmount = ethers.parseUnits('10');
    let trans = await mockVault.connect(Alice).mockNotifyYTSwappedForUser(await bribesPool.getAddress(), Bob.address, bobYTAmount);
    await expect(trans).to.emit(bribesPool, "YTSwapped").withArgs(Bob.address, bobYTAmount);
    let lastTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    
    expect(await bribesPool.ytSum(Bob.address)).to.equal(bobYTAmount);
    expect(await bribesPool.ytLastCollectTime(Bob.address)).to.equal(lastTimestamp1);
    expect(await bribesPool.balanceOf(Bob.address)).to.equal(0);
    expect(await bribesPool.totalSupply()).to.equal(0);

    // 10 seconds later, Bob swaps for 20 YT
    await time.increase(10);
    bobYTAmount = ethers.parseUnits('20');
    trans = await mockVault.connect(Alice).mockNotifyYTSwappedForUser(await bribesPool.getAddress(), Bob.address, bobYTAmount);
    let lastTimestamp2 = BigInt((await trans.getBlock())!.timestamp);
    let ytSumBob = ethers.parseUnits('30');
    let ytTimeWeightedBob = (lastTimestamp2 - lastTimestamp1) * ethers.parseUnits('10');
    console.log(`ytTimeWeightedBob: ${lastTimestamp2 - lastTimestamp1} seconds passed, ${ethers.formatUnits(ytTimeWeightedBob, await iBGT.decimals())}`);

    expect(await bribesPool.ytSum(Bob.address)).to.equal(ytSumBob);
    expect(await bribesPool.ytLastCollectTime(Bob.address)).to.equal(lastTimestamp2);
    expect(await bribesPool.balanceOf(Bob.address)).to.equal(ytTimeWeightedBob);
    expect(await bribesPool.totalSupply()).to.equal(ytTimeWeightedBob);

    // 5 seconds later, Bob swaps for 30 YT
    await time.increase(5);
    bobYTAmount = ethers.parseUnits('30');
    trans = await mockVault.connect(Alice).mockNotifyYTSwappedForUser(await bribesPool.getAddress(), Bob.address, bobYTAmount);
    lastTimestamp1 = BigInt((await trans.getBlock())!.timestamp);
    ytSumBob = ethers.parseUnits('60');
    ytTimeWeightedBob = ytTimeWeightedBob + (lastTimestamp1 - lastTimestamp2) * ethers.parseUnits('30');
    console.log(`ytTimeWeightedBob: ${lastTimestamp1 - lastTimestamp2} seconds passed, ${ethers.formatUnits(ytTimeWeightedBob, await iBGT.decimals())}`);
    await expect(trans).to.emit(bribesPool, "TimeWeightedYTAdded").withArgs(Bob.address, (lastTimestamp1 - lastTimestamp2) * ethers.parseUnits('30'));

    expect(await bribesPool.ytSum(Bob.address)).to.equal(ytSumBob);
    expect(await bribesPool.ytLastCollectTime(Bob.address)).to.equal(lastTimestamp1);
    expect(await bribesPool.balanceOf(Bob.address)).to.equal(ytTimeWeightedBob);
    expect(await bribesPool.totalSupply()).to.equal(ytTimeWeightedBob);

    // 10 seconds laster, Bob collects bribes
    await time.increase(10);
    let ytCollectable = await bribesPool.collectableYT(Bob.address);
    console.log(`ytTimeWeightedBob: ${ethers.formatUnits(ytCollectable[1], await iBGT.decimals())}`);
    trans = await bribesPool.connect(Bob).collectYT();
    lastTimestamp2 = BigInt((await trans.getBlock())!.timestamp);
    ytTimeWeightedBob = ytTimeWeightedBob + (lastTimestamp2 - lastTimestamp1) * ethers.parseUnits('60');
    console.log(`ytTimeWeightedBob: ${lastTimestamp2 - lastTimestamp1} seconds passed, ${ethers.formatUnits(ytTimeWeightedBob, await iBGT.decimals())}`);
    await expect(trans).to.emit(bribesPool, "TimeWeightedYTAdded").withArgs(Bob.address, (lastTimestamp2 - lastTimestamp1) * ethers.parseUnits('60'));

    expect(await bribesPool.ytSum(Bob.address)).to.equal(ytSumBob);  // 60
    expect(await bribesPool.ytLastCollectTime(Bob.address)).to.equal(lastTimestamp2);  // 11 + 6 + 11 = 28
    expect(await bribesPool.balanceOf(Bob.address)).to.equal(ytTimeWeightedBob);  // 950
    expect(await bribesPool.totalSupply()).to.equal(ytTimeWeightedBob);

    console.log(`Epoch end in seconds: ${await bribesPool.epochEndTimestamp() - lastTimestamp2}`);  // 27

    // Deposit 10000 $iBGT as bribes
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

    // Bob get all the bribes
    expectBigNumberEquals(totalBribes, await bribesPool.earned(Bob.address, await iBGT.getAddress()));

    // Caro could collect YT, but nothing collected
    ytCollectable = await bribesPool.collectableYT(Caro.address);
    expect(ytCollectable[1]).to.equal(0);
    await expect(bribesPool.connect(Caro).collectYT()).not.to.be.reverted;

    // 5 seconds later, Caro swaps for 10 YT
    await time.increase(5);
    let caroYTAmount = ethers.parseUnits('10');
    let ytSumCaro = ethers.parseUnits('10');
    trans = await mockVault.connect(Alice).mockNotifyYTSwappedForUser(await bribesPool.getAddress(), Caro.address, caroYTAmount);
    await expect(trans).to.emit(bribesPool, "YTSwapped").withArgs(Caro.address, caroYTAmount);
    let lastTimestamp3 = BigInt((await trans.getBlock())!.timestamp);
    console.log(`${lastTimestamp3 - lastTimestamp2} seconds passed, Caro swapped for 10 YT`);  // 9 seconds
    console.log(`Epoch end in seconds: ${await bribesPool.epochEndTimestamp() - lastTimestamp3}`);  // 18 seconds
    
    expect(await bribesPool.ytSum(Caro.address)).to.equal(caroYTAmount);
    expect(await bribesPool.ytLastCollectTime(Caro.address)).to.equal(lastTimestamp3);
    expect(await bribesPool.balanceOf(Caro.address)).to.equal(0);

    expect((await bribesPool.collectableYT(Bob.address))[1]).to.equal(ethers.parseUnits((60 * 9) + "", await iBGT.decimals()));
    expect((await bribesPool.collectableYT(Caro.address))[1]).to.equal(0);

    // Alice add iGBT8 bribes, and Bob still get all the bribes
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
    expectBigNumberEquals(iBGT8Bribes, await bribesPool.earned(Bob.address, await iBGT8Token.getAddress()));
    expect(await bribesPool.earned(Caro.address, await iBGT8Token.getAddress())).to.equal(0);

    // 10 seconds later, Caro collect YT
    await time.increase(10);
    trans = await bribesPool.connect(Caro).collectYT();
    let lastTimestamp4 = BigInt((await trans.getBlock())!.timestamp);  // 13 seconds
    let ytTimeWeightedCaro =  (lastTimestamp4 - lastTimestamp3) * ethers.parseUnits('10');
    console.log(`ytTimeWeightedCaro: ${lastTimestamp4 - lastTimestamp3} seconds passed, ${ethers.formatUnits(ytTimeWeightedCaro, await iBGT.decimals())}`);
    await expect(trans).to.emit(bribesPool, "TimeWeightedYTAdded").withArgs(Caro.address, (lastTimestamp4 - lastTimestamp3) * ethers.parseUnits('10'));
    console.log(`Epoch end in seconds: ${await bribesPool.epochEndTimestamp() - lastTimestamp4}`);  // 5 seconds

    expect(await bribesPool.ytSum(Bob.address)).to.equal(ytSumBob);  // 60
    expect(await bribesPool.ytSum(Caro.address)).to.equal(ytSumCaro);  // 10
    expect(await bribesPool.ytLastCollectTime(Bob.address)).to.equal(lastTimestamp2);  // 11 + 6 + 11 = 28
    expect(await bribesPool.ytLastCollectTime(Caro.address)).to.equal(lastTimestamp4);  // 11 + 6 + 11 + 13
    expect(await bribesPool.balanceOf(Bob.address)).to.equal(ytTimeWeightedBob);  // 950
    expect(await bribesPool.balanceOf(Caro.address)).to.equal(ytTimeWeightedCaro);  // 130
    expect(await bribesPool.totalSupply()).to.equal(ytTimeWeightedBob + ytTimeWeightedCaro);

    // 10 seconds later, Caro collect YT. It's truncated to epoch ends (+5s)
    let epochEndTimestamp = await bribesPool.epochEndTimestamp();
    await time.increase(10);
    let ytCollectableCaro = await bribesPool.collectableYT(Caro.address);
    expect(ytCollectableCaro[0]).to.equal(epochEndTimestamp);
    expect(ytCollectableCaro[1]).to.equal(ethers.parseUnits((10 * 5) + "", await iBGT.decimals()));  // 50

    let ytCollectableBob = await bribesPool.collectableYT(Bob.address);
    expect(ytCollectableBob[0]).to.equal(epochEndTimestamp);
    expect(ytCollectableBob[1]).to.equal(ethers.parseUnits((60 * (9 + 13 + 5)) + "", await iBGT.decimals()));  // 1620

    trans = await bribesPool.connect(Caro).collectYT();
    lastTimestamp2 = BigInt((await trans.getBlock())!.timestamp);
    ytTimeWeightedCaro = ytTimeWeightedCaro + (epochEndTimestamp - lastTimestamp4) * ethers.parseUnits('10');
    console.log(`ytTimeWeightedCaro: ${epochEndTimestamp - lastTimestamp4} seconds passed, ${ethers.formatUnits(ytTimeWeightedCaro, await iBGT.decimals())}`);
    await expect(trans).to.emit(bribesPool, "TimeWeightedYTAdded").withArgs(Caro.address, ethers.parseUnits('50'));

    expect(await bribesPool.balanceOf(Bob.address)).to.equal(ytTimeWeightedBob);  // 950
    expect(await bribesPool.balanceOf(Caro.address)).to.equal(ytTimeWeightedCaro);  // 180

    // Bob claimed all bribes
    expect(await bribesPool.earned(Caro.address, await iBGT.getAddress())).to.equal(0);
    expect(await bribesPool.earned(Caro.address, await iBGT8Token.getAddress())).to.equal(0);
    trans = await bribesPool.connect(Bob).getBribes();
    expect(await bribesPool.earned(Bob.address, await iBGT.getAddress())).to.equal(0);
    expect(await bribesPool.earned(Bob.address, await iBGT8Token.getAddress())).to.equal(0);

    // Epoch ends. 10 seconds later, Bob swaps for 100 YT. But only cause previous YT collected (60 YT and 9 + 13 +5 = 27 seconds)
    await time.increase(10);
    bobYTAmount = ethers.parseUnits('100');
    trans = await mockVault.connect(Alice).mockNotifyYTSwappedForUser(await bribesPool.getAddress(), Bob.address, bobYTAmount);
    ytSumBob = ethers.parseUnits((60 + 100) + "");
    ytTimeWeightedBob = ytTimeWeightedBob + (9n + 13n + 5n) * ethers.parseUnits('60');
    console.log(`ytTimeWeightedBob: ${9n + 13n + 5n} seconds passed, ${ethers.formatUnits(ytTimeWeightedBob, await iBGT.decimals())}`);
    await expect(trans).to.emit(bribesPool, "TimeWeightedYTAdded").withArgs(Bob.address, (9n + 13n + 5n) * ethers.parseUnits('60'));

    expect(await bribesPool.ytSum(Bob.address)).to.equal(ytSumBob);
    expect(await bribesPool.ytLastCollectTime(Bob.address)).to.equal(epochEndTimestamp);
    expect(await bribesPool.balanceOf(Bob.address)).to.equal(ytTimeWeightedBob);  // 950 + 1620 = 2570
    expect(await bribesPool.balanceOf(Caro.address)).to.equal(ytTimeWeightedCaro);  // 180

    // 10 seconds later, Bob and Caro swaps for more YT, but no YT is collectable
    await time.increase(10);
    await mockVault.connect(Alice).mockNotifyYTSwappedForUser(await bribesPool.getAddress(), Bob.address, ethers.parseUnits('100'));
    await mockVault.connect(Alice).mockNotifyYTSwappedForUser(await bribesPool.getAddress(), Caro.address, ethers.parseUnits('100'));
    expect(await bribesPool.collectableYT(Bob.address)).to.deep.equal([epochEndTimestamp, 0]);
    expect(await bribesPool.collectableYT(Caro.address)).to.deep.equal([epochEndTimestamp, 0]);

    // New bribes added. Bob and Caro should get bribes proportionally
    const newBribes = ethers.parseUnits('30000');
    await expect(iBGT.connect(Alice).approve(await mockVault.getAddress(), newBribes)).not.to.be.reverted;
    await mockVault.connect(Alice).mockAddBribes(bribesPool, await iBGT.getAddress(), newBribes);
    let iBGTBobBribes = newBribes * ytTimeWeightedBob / (ytTimeWeightedBob + ytTimeWeightedCaro);
    let iBGTCaroBribes = newBribes * ytTimeWeightedCaro / (ytTimeWeightedBob + ytTimeWeightedCaro);
    expectBigNumberEquals(iBGTBobBribes, await bribesPool.earned(Bob.address, await iBGT.getAddress()));
    expectBigNumberEquals(iBGTCaroBribes, await bribesPool.earned(Caro.address, await iBGT.getAddress()));
  });

});
