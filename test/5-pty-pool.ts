import _ from "lodash";
import { ethers } from "hardhat";
import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { deployBaseContractsFixture, nativeTokenAddress, VaultMode, ONE_DAY_IN_SECS, expectBigNumberEquals } from "./utils";
import { MockUsd__factory, MockVault__factory, MarginToken__factory, PtyPoolBuyLow__factory, PtyPoolSellHigh__factory } from "../typechain";

const { provider } = ethers;

describe("PytPool", () => {

  async function deployAllContractsFixture() {
    const { Alice, Bob, protocol, settings } = await loadFixture(deployBaseContractsFixture);

    const MockUsdFactory = await ethers.getContractFactory("MockUsd");
    const MockUsd = await MockUsdFactory.deploy(await protocol.getAddress(), await settings.getAddress());
    const usd = MockUsd__factory.connect(await MockUsd.getAddress(), provider);

    let trans = await protocol.connect(Alice).initialize(await usd.getAddress());
    await trans.wait();

    const MarginTokenFactory = await ethers.getContractFactory("MarginToken");
    const ETHx = await MarginTokenFactory.deploy(await protocol.getAddress(), await settings.getAddress(), "ETHx Token", "ETHx");
    const ethx = MarginToken__factory.connect(await ETHx.getAddress(), provider);

    const MockVaultFactory = await ethers.getContractFactory("MockVault");
    const MockVault = await MockVaultFactory.deploy(nativeTokenAddress, await usd.getAddress(), await ethx.getAddress());
    const vault = MockVault__factory.connect(await MockVault.getAddress(), provider);

    trans = await ethx.connect(Alice).setVault(await vault.getAddress());
    await trans.wait();

    const PtyPoolBuyLowFactory = await ethers.getContractFactory("PtyPoolBuyLow");
    const PtyPoolBuyLow = await PtyPoolBuyLowFactory.deploy(
      await protocol.getAddress(),
      await settings.getAddress(),
      await vault.getAddress(),
      await ethx.getAddress(),
      nativeTokenAddress
    );
    const ptyPoolBuyLow = PtyPoolBuyLow__factory.connect(await PtyPoolBuyLow.getAddress(), provider);

    const PtyPoolSellHighFactory = await ethers.getContractFactory("PtyPoolSellHigh");
    const PtyPoolSellHigh = await PtyPoolSellHighFactory.deploy(
      await protocol.getAddress(),
      await settings.getAddress(),
      await vault.getAddress(),
      nativeTokenAddress,
      await ethx.getAddress()
    );
    const ptyPoolSellHigh = PtyPoolSellHigh__factory.connect(await PtyPoolSellHigh.getAddress(), provider);

    trans = await vault.connect(Alice).setPtyPools(await ptyPoolBuyLow.getAddress(), await ptyPoolSellHigh.getAddress());
    await trans.wait();

    return { usd, vault, ethx, ptyPoolBuyLow, ptyPoolSellHigh };
  }

  it("PtyPoolBuyLow works", async () => {
    const { Alice, Bob, Caro } = await loadFixture(deployBaseContractsFixture);
    const { usd, vault, ethx, ptyPoolBuyLow } = await loadFixture(deployAllContractsFixture);

    /**
     * Mint 1000 $zUSD to Alice and Bob, and rebase to 4000
     *
     * zUSD
     *  Shares: total 2000, Alice 1000, Bob 1000
     *  Balance: total 4000, Alice 2000, Bob 2000
     */
    await expect(usd.connect(Alice).mint(Alice.address, ethers.parseUnits("1000", await usd.decimals()))).not.to.be.rejected;
    await expect(usd.connect(Alice).mint(Bob.address, ethers.parseUnits("1000", await usd.decimals()))).not.to.be.rejected;
    await expect(usd.connect(Alice).rebase(ethers.parseUnits("2000", await usd.decimals()))).not.to.be.rejected;
    expect(await usd.balanceOf(Alice.address)).to.equal(ethers.parseUnits("2000", await usd.decimals()));
    expect(await usd.balanceOf(Bob.address)).to.equal(ethers.parseUnits("2000", await usd.decimals()));

    // Day 0
    const genesisTime = await time.latest();

    /**
     * Alice stakes 200 $zUSD to PtyPoolBuyLow, and got 200 Pty LP
     *
     * zUSD
     *  Shares: total 2000, Alice 900, Bob 1000, PtyPoolBuyLow 100
     *  Balance: total 4000, Alice 1800, Bob 2000, PtyPoolBuyLow 200
     * PtyPoolBuyLow
     *  LP Shares: total 200, Alice 200
     */
    await expect(usd.connect(Alice).approve(await ptyPoolBuyLow.getAddress(), ethers.parseUnits("200", await usd.decimals()))).not.to.be
      .rejected;
    await expect(ptyPoolBuyLow.connect(Alice).stake(ethers.parseUnits("200", await usd.decimals())))
      .to.emit(usd, "Transfer")
      .withArgs(Alice.address, await ptyPoolBuyLow.getAddress(), ethers.parseUnits("200", await usd.decimals()))
      .to.emit(usd, "TransferShares")
      .withArgs(Alice.address, await ptyPoolBuyLow.getAddress(), ethers.parseUnits("100", await usd.decimals()))
      .to.emit(ptyPoolBuyLow, "Staked")
      .withArgs(Alice.address, ethers.parseUnits("200", await usd.decimals()));
    expect(await usd.sharesOf(await ptyPoolBuyLow.getAddress())).to.equal(ethers.parseUnits("100", await usd.decimals()));
    expect(await usd.balanceOf(await ptyPoolBuyLow.getAddress())).to.equal(ethers.parseUnits("200", await usd.decimals()));
    expect(await ptyPoolBuyLow.userStakingBalance(Alice.address)).to.equal(ethers.parseUnits("200", await usd.decimals()));
    expect(await ptyPoolBuyLow.userStakingShares(Alice.address)).to.equal(ethers.parseUnits("200", await usd.decimals()));
    expect(await ptyPoolBuyLow.totalStakingBalance()).to.equal(ethers.parseUnits("200", await usd.decimals()));

    /**
     * Vault add 100 $ETHx staking yields
     *
     * Staking Yiels ($ETHx)
     *  Alice: 100 yields
     */
    await expect(vault.connect(Alice).mockAddStakingYieldsToPtyPoolBuyLow(ethers.parseUnits("100", await ethx.decimals())))
      .to.emit(ethx, "Transfer")
      .withArgs(await vault.getAddress(), await ptyPoolBuyLow.getAddress(), ethers.parseUnits("100", await ethx.decimals()))
      .to.emit(ptyPoolBuyLow, "StakingYieldsAdded")
      .withArgs(ethers.parseUnits("100", await ethx.decimals()));
    expect(await ptyPoolBuyLow.earnedStakingYields(Alice.address)).to.equal(ethers.parseUnits("100", await ethx.decimals()));

    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 1);

    /**
     * zUSD rebase from 4000 to 8000 ====>
     *
     * zUSD
     *  Shares: total 2000, Alice 900, Bob 1000, PtyPoolBuyLow 100
     *  Balance: total 8000, Alice 3600, Bob 4000, PtyPoolBuyLow 400
     *
     * PtyPoolBuyLow
     *  Total balance: 400
     *  LP Shares: total 200, Alice 200
     *
     * -------------------------
     *
     * Bob stakes 200 $zUSD to PtyPoolBuyLow, and got 50 Pty LP  ===>
     *
     *  zUSD
     *  Shares: total 2000, Alice 850, Bob 1000, PtyPoolBuyLow 150
     *  Balance: total 8000, Alice 3400, Bob 4000, PtyPoolBuyLow 600
     *
     * PtyPoolBuyLow
     *  Total balance: 400 + 200 = 600, Alice 400, Bob 200
     *  LP Shares: total 300, Alice 200, Bob 100
     */
    await expect(usd.connect(Alice).rebase(ethers.parseUnits("4000", await usd.decimals()))).not.to.be.rejected;
    expect(await ptyPoolBuyLow.totalStakingBalance()).to.equal(ethers.parseUnits("400", await usd.decimals()));
    expect(await ptyPoolBuyLow.totalStakingShares()).to.equal(ethers.parseUnits("200", await usd.decimals()));
    await expect(usd.connect(Bob).approve(await ptyPoolBuyLow.getAddress(), ethers.parseUnits("200", await usd.decimals()))).not.to.be
      .rejected;
    await expect(ptyPoolBuyLow.connect(Bob).stake(ethers.parseUnits("200", await usd.decimals())))
      .to.emit(usd, "Transfer")
      .withArgs(Bob.address, await ptyPoolBuyLow.getAddress(), ethers.parseUnits("200", await usd.decimals()))
      .to.emit(usd, "TransferShares")
      .withArgs(Bob.address, await ptyPoolBuyLow.getAddress(), ethers.parseUnits("50", await usd.decimals()))
      .to.emit(ptyPoolBuyLow, "Staked")
      .withArgs(Bob.address, ethers.parseUnits("200", await usd.decimals()));
    expect(await usd.sharesOf(await ptyPoolBuyLow.getAddress())).to.equal(ethers.parseUnits("150", await usd.decimals()));
    expect(await usd.balanceOf(await ptyPoolBuyLow.getAddress())).to.equal(ethers.parseUnits("600", await usd.decimals()));
    expect(await ptyPoolBuyLow.userStakingBalance(Bob.address)).to.equal(ethers.parseUnits("200", await usd.decimals()));
    expect(await ptyPoolBuyLow.userStakingShares(Bob.address)).to.equal(ethers.parseUnits("100", await usd.decimals()));
    expect(await ptyPoolBuyLow.totalStakingBalance()).to.equal(ethers.parseUnits("600", await usd.decimals()));
    expect(await ptyPoolBuyLow.earnedStakingYields(Bob.address)).to.equal(ethers.parseUnits("0", await ethx.decimals()));

    /**
     * Alice withdraw 200 $zUSD (50 shares) from PtyPoolBuyLow  ====>
     *
     * zUSD
     *  Shares: total 2000, Alice 850 -> 900, Bob 1000, PtyPoolBuyLow 150 -> 100
     *  Balance: total 8000, Alice 3400 -> 3600, Bob 4000, PtyPoolBuyLow 600 -> 400
     *
     * PtyPoolBuyLow
     *  Total balance: 600 -> 400, Alice 400 -> 200, Bob 200
     *  LP Shares: total 300 -> 200, Alice 200 -> 100, Bob 100
     */
    await expect(ptyPoolBuyLow.connect(Alice).withdraw(ethers.parseUnits("600", await usd.decimals()))).to.be.reverted;
    await expect(ptyPoolBuyLow.connect(Alice).withdraw(ethers.parseUnits("200", await usd.decimals())))
      .to.emit(usd, "Transfer")
      .withArgs(await ptyPoolBuyLow.getAddress(), Alice.address, ethers.parseUnits("200", await usd.decimals()))
      .to.emit(usd, "TransferShares")
      .withArgs(await ptyPoolBuyLow.getAddress(), Alice.address, ethers.parseUnits("50", await usd.decimals()))
      .to.emit(ptyPoolBuyLow, "Withdrawn")
      .withArgs(Alice.address, ethers.parseUnits("200", await usd.decimals()));
    expect(await usd.sharesOf(await ptyPoolBuyLow.getAddress())).to.equal(ethers.parseUnits("100", await usd.decimals()));
    expect(await ptyPoolBuyLow.userStakingBalance(Alice.address)).to.equal(ethers.parseUnits("200", await usd.decimals()));
    expect(await ptyPoolBuyLow.userStakingShares(Alice.address)).to.equal(ethers.parseUnits("100", await usd.decimals()));
    expect(await ptyPoolBuyLow.totalStakingBalance()).to.equal(ethers.parseUnits("400", await usd.decimals()));

    await time.increaseTo(genesisTime + ONE_DAY_IN_SECS * 2);

    /**
     * Vault add 20 $ETH matching yeilds
     *
     * Staking Yiels ($ETHx)
     *  Alice: 100 yields
     * Matching Yields ($ETH) not distributed, so:
     *  Alice: 0, Bob: 0
     */
    // https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-chai-matchers#chaining-async-matchers
    let tx = vault.connect(Alice).mockAddMatchingYieldsToPtyPoolBuyLow(ethers.parseUnits("20"), { value: ethers.parseUnits("20") });
    await expect(tx).to.changeEtherBalances([Alice.address, await ptyPoolBuyLow.getAddress()], [ethers.parseEther("-20"), ethers.parseEther("20")]);
    await expect(tx).to.emit(ptyPoolBuyLow, "MatchingYieldsAdded").withArgs(ethers.parseUnits("20"));
    expect(await ptyPoolBuyLow.earnedMatchingYields(Alice.address)).to.equal(ethers.parseUnits("0"));
    expect(await ptyPoolBuyLow.earnedMatchingYields(Bob.address)).to.equal(ethers.parseUnits("0"));

    /**
     * Vault match 360 $zUSD (90 shares burned) to 36 $ETH
     *
     * zUSD
     *  Shares: total 2000 - 90 = 1910, Alice 900, Bob 1000, PtyPoolBuyLow 100 - 90 = 10
     *  Balance: total 8000 - 360 = 7640, Alice 3600, Bob 4000, PtyPoolBuyLow 400 - 360 = 40
     *
     * PtyPoolBuyLow
     *  Total balance: 400 -> 40, Alice 200 -> 20, Bob 200 -> 20
     *  LP Shares: total 200, Alice 100, Bob 100
     *
     * Staking Yiels ($ETHx)
     *  Alice: 100 yields
     * Matched Tokens ($ETH):
     *  Total: 36, Alice: 18, Bob: 18
     * Matching Yields ($ETH) also distributed, so:
     *  Alice: 10, Bob: 10
     */
    // await expect(
    //   vault
    //     .connect(Alice)
    //     .mockMatchedPtyPoolBuyLow(ethers.parseUnits("36"), ethers.parseUnits("360"), {
    //       value: ethers.parseUnits("36"),
    //     })
    // ).to.be.rejectedWith("Vault not in adjustment below AARS mode");
    await expect(vault.connect(Alice).mockSetVaultMode(VaultMode.AdjustmentBelowAARS)).not.to.be.rejected;
    tx = vault.connect(Alice).mockMatchedPtyPoolBuyLow(ethers.parseUnits("36"), ethers.parseUnits("360"), {
      value: ethers.parseUnits("36"),
    });
    await expect(tx).to.changeEtherBalances([Alice.address, await ptyPoolBuyLow.getAddress()], [ethers.parseEther("-36"), ethers.parseEther("36")]);
    await expect(tx).to.changeTokenBalances(usd, [await ptyPoolBuyLow.getAddress()], [ethers.parseUnits("-360", await usd.decimals())])
    await expect(tx).to.emit(ptyPoolBuyLow, "MatchedTokensAdded").withArgs(ethers.parseUnits("36"));
    expect(await usd.sharesOf(await ptyPoolBuyLow.getAddress())).to.equal(ethers.parseUnits("10", await usd.decimals()));
    expect(await usd.balanceOf(await ptyPoolBuyLow.getAddress())).to.equal(ethers.parseUnits("40", await usd.decimals()));
    expect(await ptyPoolBuyLow.userStakingBalance(Alice.address)).to.equal(ethers.parseUnits("20", await usd.decimals()));
    expect(await ptyPoolBuyLow.userStakingShares(Alice.address)).to.equal(ethers.parseUnits("100", await usd.decimals()));
    expect(await ptyPoolBuyLow.userStakingBalance(Bob.address)).to.equal(ethers.parseUnits("20", await usd.decimals()));
    expect(await ptyPoolBuyLow.userStakingShares(Bob.address)).to.equal(ethers.parseUnits("100", await usd.decimals()));
    expect(await ptyPoolBuyLow.totalStakingBalance()).to.equal(ethers.parseUnits("40", await usd.decimals()));
    expect(await ptyPoolBuyLow.earnedMatchingYields(Alice.address)).to.equal(ethers.parseUnits("10"));
    expect(await ptyPoolBuyLow.earnedMatchingYields(Bob.address)).to.equal(ethers.parseUnits("10"));
    expect(await ptyPoolBuyLow.earnedMatchedToken(Alice.address)).to.equal(ethers.parseUnits("18"));
    expect(await ptyPoolBuyLow.earnedMatchedToken(Bob.address)).to.equal(ethers.parseUnits("18"));

    /**
     * Alice claims matching yields and matched tokens
     *
     * Matched Tokens ($ETH):
     *  Total: 36 - 18 = 0, Alice: 18 -> 0, Bob: 18
     * Matching Yields ($ETH) also distributed, so:
     *  Alice: 10 -> 0, Bob: 10
     */
    tx = ptyPoolBuyLow.connect(Alice).getMatchingTokensAndYields();
    await expect(tx).to.changeEtherBalances([Alice.address, await ptyPoolBuyLow.getAddress()], [ethers.parseEther("28"), ethers.parseEther("-28")]);
    await expect(tx).to.emit(ptyPoolBuyLow, "MatchedTokenPaid")
      .withArgs(Alice.address, ethers.parseEther("18"))
      .to.emit(ptyPoolBuyLow, "MatchingYieldsPaid")
      .withArgs(Alice.address, ethers.parseEther("10"));
    expect(await ptyPoolBuyLow.earnedMatchingYields(Alice.address)).to.equal(ethers.parseUnits("0"));
    expect(await ptyPoolBuyLow.earnedMatchedToken(Alice.address)).to.equal(ethers.parseUnits("0"));

    /**
     * Bob transfer 200 $zUSD (50 shares) to Caro;
     * Caro stakes 40 $zUSD (10 shares) to PtyPoolBuyLow, and got 50 Pty LP
     *
     * zUSD
     *  Shares: total 1910, Alice 900, Bob 1000 - 50 = 950, Caro: 50, PtyPoolBuyLow 10
     *  Balance: total 7640, Alice 3600, Bob 4000 - 200 = 3800, Caro: 200, PtyPoolBuyLow 40
     *
     * PtyPoolBuyLow
     *  Total balance: 40 + 200 = 240, Alice 20, Bob 20, Caro 40
     *  LP Shares: total 200 + 200 = 400, Alice 100, Bob 100, Caro 200
     */
    await expect(usd.connect(Bob).transfer(Caro.address, ethers.parseUnits("200", await usd.decimals()))).to.changeTokenBalances(
      usd,
      [Bob.address, Caro.address],
      [ethers.parseUnits("-200", await usd.decimals()), ethers.parseUnits("200", await usd.decimals())]
    );
    await expect(usd.connect(Caro).approve(await ptyPoolBuyLow.getAddress(), ethers.parseUnits("40", await usd.decimals()))).not.to.be
      .rejected;
    tx = ptyPoolBuyLow.connect(Caro).stake(ethers.parseUnits("40", await usd.decimals()));
    await expect(tx)
      .to.changeTokenBalances(
        usd,
        [Caro.address, await ptyPoolBuyLow.getAddress()],
        [ethers.parseUnits("-40", await usd.decimals()), ethers.parseUnits("40", await usd.decimals())]
      );
    await expect(tx).to.emit(usd, "Transfer")
      .withArgs(Caro.address, await ptyPoolBuyLow.getAddress(), ethers.parseUnits("40", await usd.decimals()))
      .to.emit(usd, "TransferShares")
      .withArgs(Caro.address, await ptyPoolBuyLow.getAddress(), ethers.parseUnits("10", await usd.decimals()))
      .to.emit(ptyPoolBuyLow, "Staked")
      .withArgs(Caro.address, ethers.parseUnits("40", await usd.decimals()));
    expect(await ptyPoolBuyLow.userStakingShares(Caro.address)).to.equal(ethers.parseUnits("200", await usd.decimals()));
    expect(await ptyPoolBuyLow.userStakingBalance(Caro.address)).to.equal(ethers.parseUnits("40", await usd.decimals()));

    /**
     * Vault add 40 $ETHx staking yields
     *
     * PtyPoolBuyLow
     *  Total balance: 240, Alice 20, Bob 20, Caro 40
     *  LP Shares: total 400, Alice 100, Bob 100, Caro 200
     *
     * Staking Yiels ($ETHx)
     *  Alice: 100 + 10 = 110, Bob: 10, Caro: 20
     */
    await expect(vault.connect(Alice).mockAddStakingYieldsToPtyPoolBuyLow(ethers.parseUnits("40", await ethx.decimals())))
      .to.emit(ethx, "Transfer")
      .withArgs(await vault.getAddress(), await ptyPoolBuyLow.getAddress(), ethers.parseUnits("40", await ethx.decimals()))
      .to.emit(ptyPoolBuyLow, "StakingYieldsAdded")
      .withArgs(ethers.parseUnits("40", await ethx.decimals()));
    expect(await ptyPoolBuyLow.earnedStakingYields(Alice.address)).to.equal(ethers.parseUnits("110", await ethx.decimals()));
    expect(await ptyPoolBuyLow.earnedStakingYields(Bob.address)).to.equal(ethers.parseUnits("10", await ethx.decimals()));
    expect(await ptyPoolBuyLow.earnedStakingYields(Caro.address)).to.equal(ethers.parseUnits("20", await ethx.decimals()));
  });

  it("PtyPoolSellHigh works", async () => {
    const { Alice, Bob, Caro } = await loadFixture(deployBaseContractsFixture);
    const { usd, vault, ethx, ptyPoolSellHigh } = await loadFixture(deployAllContractsFixture);

    /**
     * Alice stakes 20 $ETH to ptyPoolSellHigh, and got 20 Pty LP; Bob stakes 10 $ETH to ptyPoolSellHigh, and got 10 Pty LP
     *
     * ptyPoolSellHigh
     *  LP Shares: total 30, Alice 20, Bob 10
     */
    let tx = ptyPoolSellHigh.connect(Alice).stake(ethers.parseEther("20"), { value: ethers.parseUnits("20") });
    await expect(tx)
      .to.changeEtherBalances([Alice.address, await ptyPoolSellHigh.getAddress()], [ethers.parseEther("-20"), ethers.parseEther("20")]);
    await expect(tx)
      .to.emit(ptyPoolSellHigh, "Staked")
      .withArgs(Alice.address, ethers.parseUnits("20", await usd.decimals()));
    tx = ptyPoolSellHigh.connect(Bob).stake(ethers.parseEther("10"), { value: ethers.parseUnits("10") });
    await expect(tx)
      .to.changeEtherBalances([Bob.address, await ptyPoolSellHigh.getAddress()], [ethers.parseEther("-10"), ethers.parseEther("10")]);
    await expect(tx)
      .to.emit(ptyPoolSellHigh, "Staked")
      .withArgs(Bob.address, ethers.parseUnits("10", await usd.decimals()));
    expect(await ptyPoolSellHigh.userStakingShares(Alice.address)).to.equal(ethers.parseEther("20"));
    expect(await ptyPoolSellHigh.userStakingBalance(Alice.address)).to.equal(ethers.parseEther("20"));
    expect(await ptyPoolSellHigh.userStakingShares(Bob.address)).to.equal(ethers.parseEther("10"));
    expect(await ptyPoolSellHigh.userStakingBalance(Bob.address)).to.equal(ethers.parseEther("10"));
    expect(await ptyPoolSellHigh.totalStakingBalance()).to.equal(ethers.parseEther("30"));

    /**
     * Vault add 3 $ETH staking yields
     *
     * ptyPoolSellHigh
     *  LP Shares: total 30, Alice 20, Bob 10
     * Staking Balances ($ETH)
     *  Alice: 22, Bob: 11
     */
    tx = vault.connect(Alice).mockAddStakingYieldsToPtyPoolSellHigh(ethers.parseEther("3"), { value: ethers.parseUnits("3") });
    await expect(tx)
      .to.changeEtherBalances([Alice.address, await ptyPoolSellHigh.getAddress()], [ethers.parseEther("-3"), ethers.parseEther("3")]);
    await expect(tx)
      .to.emit(ptyPoolSellHigh, "StakingYieldsAdded")
      .withArgs(ethers.parseEther("3"));
    expect(await ptyPoolSellHigh.userStakingBalance(Alice.address)).to.equal(ethers.parseEther("22"));
    expect(await ptyPoolSellHigh.userStakingBalance(Bob.address)).to.equal(ethers.parseEther("11"));

    /**
     * Vault add 30 $ETHx matching yields
     */
    await expect(vault.connect(Alice).mockAddMatchingYieldsToPtyPoolSellHigh(ethers.parseUnits("30", await ethx.decimals())))
      .to.emit(ethx, "Transfer")
      .withArgs(await vault.getAddress(), await ptyPoolSellHigh.getAddress(), ethers.parseUnits("30", await ethx.decimals()))
      .to.emit(ptyPoolSellHigh, "MatchingYieldsAdded")
      .withArgs(ethers.parseUnits("30", await ethx.decimals()));
    expect(await ptyPoolSellHigh.earnedMatchingYields(Alice.address)).to.equal(ethers.parseUnits("0", await ethx.decimals()));
    expect(await ptyPoolSellHigh.earnedMatchingYields(Bob.address)).to.equal(ethers.parseUnits("0", await ethx.decimals()));

    /**
     * Rebase 1 $ETH to 1.1 $ETH (By transfering 3.3 $ETH to PtyPoolSellHigh)
     * 
     * Vault match 27 $ETH to 270 $zUSD, remaining 33 * 1.1 - 27 = 9.3 $ETH
     *
     * ptyPoolSellHigh
     *  LP Shares: total 30, Alice 20, Bob 10
     * Staking Balances ($ETH)
     *  Alice: 22, Bob: 11
     * Matched Tokens ($zUSD)
     *  Total: 270, Alice: 180, Bob: 90
     * Matching Yields ($ETHx) also distributed, so:
     *  Alice: 20, Bob: 10
     */
    await expect(Alice.sendTransaction({ to: await ptyPoolSellHigh.getAddress(), value: ethers.parseEther("3.3") })).not.to.be.rejected;
    // await expect(
    //   vault.connect(Alice).mockMatchedPtyPoolSellHigh(ethers.parseEther("27"), ethers.parseUnits("270", await usd.decimals()))
    // ).to.be.rejectedWith("Vault not in adjustment above AARU mode");
    await expect(vault.connect(Alice).mockSetVaultMode(VaultMode.AdjustmentAboveAARU)).not.to.be.rejected;
    tx = vault.connect(Alice).mockMatchedPtyPoolSellHigh(ethers.parseEther("27"), ethers.parseUnits("270", await usd.decimals()));
    await expect(tx)
      .to.changeEtherBalances([await vault.getAddress(), await ptyPoolSellHigh.getAddress()], [ethers.parseEther("27"), ethers.parseEther("-27")]);
    await expect(tx)
      .to.changeTokenBalances(usd, [await ptyPoolSellHigh.getAddress()], [ethers.parseUnits("270", await usd.decimals())]);
    await expect(tx)
      .to.emit(ptyPoolSellHigh, "MatchedTokensAdded")
      .withArgs(ethers.parseUnits("270", await usd.decimals()));
    expect(await ptyPoolSellHigh.totalStakingBalance()).to.equal(ethers.parseEther("9.3"));
    expect(await ptyPoolSellHigh.earnedMatchingYields(Alice.address)).to.equal(ethers.parseUnits("20", await ethx.decimals()));
    expect(await ptyPoolSellHigh.earnedMatchingYields(Bob.address)).to.equal(ethers.parseUnits("10", await ethx.decimals()));
    expect(await ptyPoolSellHigh.earnedMatchedToken(Alice.address)).to.equal(ethers.parseUnits("180", await usd.decimals()));
    expect(await ptyPoolSellHigh.earnedMatchedToken(Bob.address)).to.equal(ethers.parseUnits("90", await usd.decimals()));

    /**
     * Rebase 1 $zUSD to 1.1 $zUSD (By rebasing $zUSD).
     * 
     * Matched Tokens ($zUSD)
     *  Total: 270 * 1.1 = 297, Alice: 180 * 1.1 = 198, Bob: 90 * 1.1 = 99
     * 
     * Staking Balances ($ETH)
     *  Total: 9.3, Alice: 6.2, Bob: 3.1
     */
    expect(await usd.balanceOf(await ptyPoolSellHigh.getAddress())).to.equal(ethers.parseUnits("270", await usd.decimals()));
    await expect(usd.connect(Alice).rebase((await usd.totalSupply()) / 10n)).not.to.be.rejected;
    expect(await usd.balanceOf(await ptyPoolSellHigh.getAddress())).to.equal(ethers.parseUnits("297", await usd.decimals()));
    expect(await ptyPoolSellHigh.earnedMatchedToken(Alice.address)).to.equal(ethers.parseUnits("198", await usd.decimals()));
    expect(await ptyPoolSellHigh.earnedMatchedToken(Bob.address)).to.equal(ethers.parseUnits("99", await usd.decimals()));

    expect(await ptyPoolSellHigh.totalStakingBalance()).to.equal(ethers.parseEther("9.3"));
    expect(await ptyPoolSellHigh.userStakingBalance(Alice.address)).to.equal(ethers.parseEther("6.2"));
    expect(await ptyPoolSellHigh.userStakingBalance(Bob.address)).to.equal(ethers.parseEther("3.1"));

    /**
     * Alice exit all stakings.
     *
     * ptyPoolSellHigh
     *  Total balance ($ETH): 9.3 - 6.2 = 3.1, Alice 6.2 - 6.2 = 0, Bob 3.1
     *  LP Shares: total 30 - 20 = 10, Alice 20 - 20 = 0, Bob 10
     * 
     * Staking Balances ($ETH)
     *  Alice: 6.2 => 0, Bob: 3.1
     * Matched Tokens ($zUSD)
     *  Alice: 198 => 0, Bob: 99
     * Matching Yields ($ETHx) also distributed, so:
     *  Alice: 20 => 0, Bob: 10
     */
    tx = ptyPoolSellHigh.connect(Alice).exit();
    await expect(tx)
      .to.changeEtherBalances([Alice.address, await ptyPoolSellHigh.getAddress()], [ethers.parseEther("6.2"), ethers.parseEther("-6.2")]);
    await expect(tx)
      .to.changeTokenBalances(
        usd,
        [Alice.address, await ptyPoolSellHigh.getAddress()],
        [ethers.parseUnits("198", await usd.decimals()), ethers.parseUnits("-198", await usd.decimals())]
      );
    await expect(tx)
      .to.changeTokenBalances(
        ethx,
        [Alice.address, await ptyPoolSellHigh.getAddress()],
        [ethers.parseUnits("20", await ethx.decimals()), ethers.parseUnits("-20", await ethx.decimals())]
      );
    await expect(tx)
      .to.emit(ptyPoolSellHigh, "Withdrawn")
      .withArgs(Alice.address, ethers.parseEther("6.2"))
      .to.emit(ptyPoolSellHigh, "MatchedTokenPaid")
      .withArgs(Alice.address, ethers.parseUnits("198", await usd.decimals()))
      .to.emit(ptyPoolSellHigh, "MatchingYieldsPaid")
      .withArgs(Alice.address, ethers.parseUnits("20", await ethx.decimals()));

    /**
     * Caro stakes 15.5 $ETH to ptyPoolSellHigh, and got 50 Pty LP
     */
    await expect(ptyPoolSellHigh.connect(Caro).stake(ethers.parseEther("15.5"), { value: ethers.parseUnits("15.4999") })).to.be.rejected;
    await expect(ptyPoolSellHigh.connect(Caro).stake(ethers.parseEther("15.5"), { value: ethers.parseUnits("15.5001") })).to.be.rejected;
    tx = ptyPoolSellHigh.connect(Caro).stake(ethers.parseEther("15.5"), { value: ethers.parseUnits("15.5") });
    await expect(tx)
      .to.changeEtherBalances([Caro.address, await ptyPoolSellHigh.getAddress()], [ethers.parseEther("-15.5"), ethers.parseEther("15.5")]);
    await expect(tx)
      .to.emit(ptyPoolSellHigh, "Staked")
      .withArgs(Caro.address, ethers.parseUnits("15.5", await usd.decimals()));
    expect(await ptyPoolSellHigh.userStakingShares(Caro.address)).to.equal(ethers.parseEther("50"));
  });

  it("Withdraw all works for PtyPoolBuyLow", async () => {
    const { Alice, Bob } = await loadFixture(deployBaseContractsFixture);
    const { usd, vault, ethx, ptyPoolBuyLow } = await loadFixture(deployAllContractsFixture);

    await expect(usd.connect(Alice).mint(Alice.address, ethers.parseUnits("1000", await usd.decimals()))).not.to.be.rejected;
    await expect(usd.connect(Alice).mint(Bob.address, ethers.parseUnits("500", await usd.decimals()))).not.to.be.rejected;
    await expect(usd.connect(Alice).rebase(ethers.parseUnits("100", await usd.decimals()))).not.to.be.rejected;
    expectBigNumberEquals(await usd.balanceOf(Alice.address), ethers.parseUnits("1066.66666667", await usd.decimals()));
    expectBigNumberEquals(await usd.balanceOf(Bob.address), ethers.parseUnits("533.333333333", await usd.decimals()));

    let stakeAmount = ethers.parseUnits("971.333216134", await usd.decimals());
    await expect(usd.connect(Alice).approve(await ptyPoolBuyLow.getAddress(), stakeAmount)).not.to.be.rejected;
    await expect(ptyPoolBuyLow.connect(Alice).stake(stakeAmount)).not.to.be.rejected;

    await expect(vault.connect(Alice).mockAddStakingYieldsToPtyPoolBuyLow(ethers.parseUnits("0.000000024238965803", await ethx.decimals()))).not.to.be.rejected;

    await expect(vault.connect(Alice).mockSetVaultMode(VaultMode.AdjustmentBelowAARS)).not.to.be.rejected;
    await expect(vault.connect(Alice).mockMatchedPtyPoolBuyLow(
      ethers.parseUnits("0.333913509295048329"), ethers.parseUnits("768.001071378611158649"),
      {value: ethers.parseUnits("0.333913509295048329")})
    ).not.to.be.rejected;

    await expect(ptyPoolBuyLow.connect(Alice).claimAll()).not.to.be.rejected;
    let aliceStakingBalance = await ptyPoolBuyLow.userStakingBalance(Alice.address);
    await expect(ptyPoolBuyLow.connect(Alice).withdraw(aliceStakingBalance + 1n)).to.be.rejected;
    await expect(ptyPoolBuyLow.connect(Alice).withdraw(aliceStakingBalance)).not.to.be.rejected;

    expect(await ptyPoolBuyLow.totalStakingShares()).to.equal(0);
    // expect(await ptyPoolBuyLow.totalStakingBalance()).to.equal(0);

    stakeAmount = ethers.parseUnits("100.13849166", await usd.decimals());
    await expect(usd.connect(Bob).approve(await ptyPoolBuyLow.getAddress(), stakeAmount)).not.to.be.rejected;
    await expect(ptyPoolBuyLow.connect(Bob).stake(stakeAmount)).not.to.be.rejected;
    expect(await ptyPoolBuyLow.totalStakingShares()).to.be.gt(0);
  });

  it("Withdraw all works for PtyPoolSellHigh", async () => {
    const { Alice, Bob, Caro, protocol } = await loadFixture(deployBaseContractsFixture);
    const { vault, ethx, ptyPoolSellHigh } = await loadFixture(deployAllContractsFixture);

    await expect(ptyPoolSellHigh.connect(Alice).stake(ethers.parseEther("20"), { value: ethers.parseUnits("20") })).not.to.be.rejected;
    await expect(ptyPoolSellHigh.connect(Bob).stake(ethers.parseEther("10"), { value: ethers.parseUnits("10") })).not.to.be.rejected;

    await expect(vault.connect(Alice).mockAddStakingYieldsToPtyPoolSellHigh(ethers.parseEther("3"), { value: ethers.parseUnits("3") })).not.to.be.rejected;
    await expect(vault.connect(Alice).mockAddMatchingYieldsToPtyPoolSellHigh(ethers.parseUnits("30", await ethx.decimals()))).not.to.be.rejected;

    await expect(ptyPoolSellHigh.connect(Alice).exit()).not.to.be.rejected;
    await expect(ptyPoolSellHigh.connect(Bob).withdraw(await ptyPoolSellHigh.userStakingBalance(await Bob.address) + 1n)).to.be.rejected;
    await expect(ptyPoolSellHigh.connect(Bob).withdraw(await ptyPoolSellHigh.userStakingBalance(await Bob.address))).not.to.be.rejected;

    await expect(ptyPoolSellHigh.connect(Alice).stake(ethers.parseEther("5"), { value: ethers.parseUnits("5") })).not.to.be.rejected;
    expect(await ptyPoolSellHigh.totalStakingShares()).to.be.equal(ethers.parseEther("5"));
    expect(await ptyPoolSellHigh.userStakingBalance(Alice.address)).to.be.equal(ethers.parseEther("5"));

  });

});
