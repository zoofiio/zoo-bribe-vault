import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { encodeBytes32String, parseEther, parseUnits } from "ethers";
import { ethers } from "hardhat";
import {
  DumpVS, VaultsFixture, deployAllContractsFixture, dumpVaultState, printVaultState,
  expectBigNumberEquals, power, VaultMode,
  getBoundValidator, getChainlinkOracle, getPythOracle, getMockChainlinkFeed,
  nativeTokenAddress, getBytes32String, getTime
} from "./utils";
import {
  Vault, MockV3Aggregator__factory, ResilientOracle__factory, ResilientOracle, OracleInterface,
  ChainlinkOracle,
  PythOracle
} from "../typechain";

const { provider } = ethers;

const PRICE_DECIMALS = 18n;
const PRICE_BOUND_RATIO_EXP_SCALE = 10n ** 18n;
// Check: https://bscscan.com/address/0x8455EFA4D7Ff63b8BFD96AdD889483Ea7d39B70a#readProxyContract:tokenConfigs('0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB')
const PRICE_MAX_STALE_PERIOD = 100n; // 100 seconds

describe("Vaults", () => {
  let vf: VaultsFixture;
  let mainOracle: ChainlinkOracle, pivotOracle: PythOracle, fallbackOracle: OracleInterface;
  let resilientOracle: ResilientOracle;

  beforeEach(async () => {
    vf = await loadFixture(deployAllContractsFixture);

    // Update ethVault to use ResilientOracle
    const boundValidator = await getBoundValidator(await vf.protocol.getAddress());
    // https://bscscan.com/address/0x6E332fF0bB52475304494E4AE5063c1051c7d735#readProxyContract('0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB')
    await boundValidator.connect(vf.Alice).setValidateConfigs([{
      asset: nativeTokenAddress,
      upperBoundRatio: PRICE_BOUND_RATIO_EXP_SCALE * 101n / 100n,
      lowerBoundRatio: PRICE_BOUND_RATIO_EXP_SCALE * 99n/ 100n
    }]);

    mainOracle = await getChainlinkOracle(await vf.protocol.getAddress());
    await mainOracle.connect(vf.Alice).setTokenConfigs([
      {
        asset: nativeTokenAddress,
        feed: await (await getMockChainlinkFeed(18n, 0n)).getAddress(),
        maxStalePeriod: PRICE_MAX_STALE_PERIOD,
      },
    ]);

    pivotOracle = await getPythOracle(await vf.protocol.getAddress());
    await pivotOracle.connect(vf.Alice).setTokenConfigs([
      {
        asset: nativeTokenAddress,
        pythId: getBytes32String(1),
        maxStalePeriod: PRICE_MAX_STALE_PERIOD,
      }
    ]);

    fallbackOracle = await getChainlinkOracle(await vf.protocol.getAddress());

    const ResilientOracleFactory = await ethers.getContractFactory("ResilientOracle");
    const ResilientOracle = await ResilientOracleFactory.deploy(await vf.protocol.getAddress(), await boundValidator.getAddress());
    resilientOracle = ResilientOracle__factory.connect(await ResilientOracle.getAddress(), provider);
    await resilientOracle.connect(vf.Alice).setTokenConfigs([
      {
        asset: nativeTokenAddress,
        oracles: [await mainOracle.getAddress(), await pivotOracle.getAddress(), await fallbackOracle.getAddress()],
        enableFlagsForOracles: [true, true, false],
      }
    ]);

    const ResilientPriceFeedFactory = await ethers.getContractFactory("ResilientPriceFeed");
    const ResilientPriceFeed = await ResilientPriceFeedFactory.deploy(nativeTokenAddress, await resilientOracle.getAddress());
    await vf.ethVault.connect(vf.Alice).updatePriceFeed(await ResilientPriceFeed.getAddress());
  });

  const isEmpty = (S: DumpVS) => {
    return S.M_ETH <= 0 || S.M_ETHx <= 0 || S.M_USD_ETH <= 0;
  };

  const mockPrice = async (vault: Vault, price: bigint) => {
    let [, feed, ] = await mainOracle.tokenConfigs(nativeTokenAddress);
    let feedInstance = MockV3Aggregator__factory.connect(feed, provider);
    await expect(feedInstance.connect(vf.Alice).updateAnswer(price * (10n ** PRICE_DECIMALS))).not.to.be.reverted;

    const UnderlyingPythFactory = await ethers.getContractFactory("MockAbsPyth");
    const underlyingPythOracle = UnderlyingPythFactory.attach(await pivotOracle.underlyingPythOracle());
    // Set pivot price to 99.9% of main price, which should be within the bound [99%, 101%]
    await underlyingPythOracle.connect(vf.Alice).updatePriceFeedsHarness([
      {
        id: getBytes32String(1),
        price: { price: price * 999n / 1000n, conf: 10, expo: 0, publishTime: await getTime() },
        emaPrice: { price: 0, conf: 0, expo: 0, publishTime: 0 },
      }
    ]);
  }

  const mockRebaseEthVaultV2 = async (percentage: number) => {
    expect(percentage).to.be.gt(0);
    expect(percentage).to.be.lte(10);

    const tokenPot = await vf.ethVault.tokenPot();
    const balance = await ethers.provider.getBalance(tokenPot);
    const rebaseAmount = balance * BigInt(percentage) / 100n;
    await vf.Alice.sendTransaction({ to: tokenPot, value: rebaseAmount });
  }

  const log = false;
  const expectCalcMintPair = (deltaAsset: string, S: DumpVS): [bigint, bigint] => {
    const asset = parseEther(deltaAsset);
    const result: [bigint, bigint] = isEmpty(S)
      ? [
          asset * S.P_ETH / power(S.P_ETH_DECIMALS) * power(S.AARDecimals) / S.AART,
          asset * (S.AART - power(S.AARDecimals)) / S.AART,
        ]
      : [asset * S.M_USD_ETH / S.M_ETH, asset * S.M_ETHx / S.M_ETH];
    log && console.info("calc:", result);
    return result;
  };

  const expectCalcMintUsdAARU = (deltaAsset: string, S: DumpVS) => {
    const asset = parseEther(deltaAsset);
    //@TODO isEmpty
    // if (isEmpty(S)) return BigInt(0);
    //@TODO (M_ETH * P_ETH - Musd-eth) < 0

    const result = asset * S.P_ETH / power(S.P_ETH_DECIMALS);
    log && console.info("calc:", result);
    return result;
  };

  const expectCalcMintXtokenAARS = (deltaAsset: string, S: DumpVS) => {
    const asset = parseEther(deltaAsset);
    let result = BigInt(0);
    //@TODO isEmpty

    //@TODO (M_ETH * P_ETH - Musd-eth) < 0
    if (S.M_ETH * S.P_ETH / power(S.P_ETH_DECIMALS) <= S.M_USD_ETH) result = BigInt(0);
    else
      result = asset
        * S.P_ETH
        / power(S.P_ETH_DECIMALS)
        * S.M_ETHx
        / (S.M_ETH * S.P_ETH / power(S.P_ETH_DECIMALS) - S.M_USD_ETH);
    log && console.info("calc:", result);
    return result;
  };
  const subFee = (amount: bigint, S: DumpVS) => amount - (amount * S.C / power(S.settingDecimals));
  const expectCalcRedeemByPairWithUsd = (deltaUsd: string, S: DumpVS) => {
    const usdAmount = parseEther(deltaUsd);
    const xAmount = usdAmount * S.M_ETHx / S.M_USD_ETH;
    const expectAssetOut = xAmount * S.M_ETH / S.M_ETHx;
    const result = [xAmount, expectAssetOut];
    log && console.info("calc:", result);
    return result;
  };

  const expectCalcRedeemByXtokenAARU = (deltaX: string, S: DumpVS) => {
    const xAmount = parseEther(deltaX);
    const assetOut = xAmount
      * (S.M_ETH * S.P_ETH / power(S.P_ETH_DECIMALS) - S.M_USD_ETH)
      / (S.M_ETHx * S.P_ETH / power(S.P_ETH_DECIMALS));
    const result = assetOut;
    log && console.info("calc:", result);
    return result;
  };

  const expectCalcRedeemByUsdAARS = (deltaUsd: string, S: DumpVS) => {
    const usdAmount = parseEther(deltaUsd);
    let result = BigInt(0);
    if (S.AAR < power(S.AARDecimals)) {
      result = usdAmount * S.M_ETH / S.M_USD_ETH;
    } else {
      result = usdAmount * power(S.P_ETH_DECIMALS) / S.P_ETH;
    }
    log && console.info("calc:", result);
    return result;
  };

  const expectCalcUsdToEthxAmount = async (deltaUsd: bigint, S: DumpVS) => {
    const aar101 = power(S.AARDecimals) * 101n / 100n;
    let deltaUsdcx = BigInt(0);
    if (S.AAR < aar101) {
      deltaUsdcx = deltaUsd * S.M_ETHx * 100n / S.M_USD_ETH;
    }
    else {
      let now = await time.latest();
      const RateR = await vf.settings.vaultParamValue(await vf.ethVault.getAddress(), encodeBytes32String("RateR"));
      const r = RateR * (BigInt(now) - S.AARBelowSafeLineTime) / BigInt(60 * 60);
      deltaUsdcx = deltaUsd * (S.M_ETHx) * (
        power(S.AARDecimals) + r
      ) / power(S.AARDecimals) / (
        S.M_ETH * (S.P_ETH) / power(S.P_ETH_DECIMALS) - S.M_USD_ETH
      );
    }

    return deltaUsdcx;
  }

  // mint pair
  const expectMintPair = async (assetAmount: string, price: bigint) => {
    const { vaultQuery, ethVault, Alice, usd, ethx } = vf;
    await mockPrice(ethVault, price);
    const S = await dumpVaultState(ethVault, vaultQuery);

    let ethDepositAmount = ethers.parseEther(assetAmount);
    let [expectedUsdAmount, expectedEthxAmount] = expectCalcMintPair(assetAmount, S);
    let calcOut = await vaultQuery.calcMintPairs(await ethVault.getAddress(), ethDepositAmount);
    
    expectBigNumberEquals(expectedUsdAmount, calcOut[1]);
    expectBigNumberEquals(expectedEthxAmount, calcOut[2]);
    
    await expect(ethVault.connect(Alice).mintPairs(ethDepositAmount, { value: ethDepositAmount / 2n })).to.be.rejected;
    await expect(ethVault.connect(Alice).mintPairs(ethDepositAmount, { value: ethDepositAmount * 2n })).to.be.rejected;
    const mint = ethVault.connect(Alice).mintPairs(ethDepositAmount, { value: ethDepositAmount });
  
    await expect(mint)
      .to.changeTokenBalance(usd, Alice, expectedUsdAmount);
    await expect(mint)
      .to.changeTokenBalance(ethx, Alice, expectedEthxAmount);
    await expect(mint)
      .to.emit(ethVault, "UsdMinted")
      .withArgs(Alice.address, ethDepositAmount, expectedUsdAmount, anyValue, S.P_ETH, PRICE_DECIMALS)
      .to.emit(ethVault, "MarginTokenMinted")
      .withArgs(Alice.address, ethDepositAmount, expectedEthxAmount, S.P_ETH, PRICE_DECIMALS);
  };

  // mint usd
  const expectMintUsdAARU = async (assetAmount: string, price: bigint) => {
    const { vaultQuery, ethVault, Alice, usd } = vf;
    await mockPrice(ethVault, price);
    const S = await dumpVaultState(ethVault, vaultQuery);
    let ethDepositAmount = ethers.parseEther(assetAmount);
    expect(S.mode).to.equal(3, "Not support mint usd aaru");
    const expectedUsdAmount = expectCalcMintUsdAARU(assetAmount, S);
    const calcOut = await vaultQuery.calcMintUsdAboveAARU(await ethVault.getAddress(), ethDepositAmount);
    expectBigNumberEquals(expectedUsdAmount, calcOut[1]);
    
    const tx = ethVault.connect(Alice).mintUsdAboveAARU(ethDepositAmount, { value: ethDepositAmount });
    await expect(tx)
      // .to.changeEtherBalances([Alice, ethVault], [ethDepositAmount * (-1), ethDepositAmount])
      .to.changeTokenBalance(usd, Alice, expectedUsdAmount);
    await expect(tx)
      .to.emit(ethVault, "UsdMinted")
      .withArgs(Alice.address, ethDepositAmount, expectedUsdAmount, anyValue, S.P_ETH, PRICE_DECIMALS);
  };

  // mint xtoken
  const expectMintXTokenAARS = async (assetAmount: string, price: bigint) => {
    const { vaultQuery, ethVault, Alice, ethx } = vf;
    await mockPrice(ethVault, price);
    const S = await dumpVaultState(ethVault, vaultQuery);
    let ethDepositAmount = ethers.parseEther(assetAmount);
    expect(S.mode).to.equal(2, "Not support mint xtoken aaru");
    const expectedXtokenAmount = expectCalcMintXtokenAARS(assetAmount, S);
    const calcOut = await vaultQuery.calcMintMarginTokensBelowAARS(await ethVault.getAddress(), ethDepositAmount);
    expectBigNumberEquals(expectedXtokenAmount, calcOut[1]);

    const tx = ethVault.connect(Alice).mintMarginTokensBelowAARS(ethDepositAmount, { value: ethDepositAmount });
    await expect(tx)
      // .to.changeEtherBalances([Alice, ethVault], [ethDepositAmount * (-1), ethDepositAmount])
      .to.changeTokenBalance(ethx, Alice, expectedXtokenAmount);
    await expect(tx)
      .to.emit(ethVault, "MarginTokenMinted")
      .withArgs(Alice.address, ethDepositAmount, expectedXtokenAmount, S.P_ETH, PRICE_DECIMALS);
  };

  // redeem ByPairWithUsd
  const expectRedeemByPairWithUsd = async (usdAmount: string, price: bigint) => {
    const { vaultQuery, ethVault, Alice, usd, ethx } = vf;
    await mockPrice(ethVault, price);
    const S = await dumpVaultState(ethVault, vaultQuery);
    const usdInput = parseEther(usdAmount);
    const xInput = await vaultQuery.calcPairdMarginTokenAmount(await ethVault.getAddress(), usdInput);
    const [, assetOut] = await vaultQuery.calcPairedRedeemAssetAmount(await ethVault.getAddress(), xInput);
    const [expectXInput, expectAssetOut] = expectCalcRedeemByPairWithUsd(usdAmount, S);
    expectBigNumberEquals(xInput, expectXInput);
    expectBigNumberEquals(assetOut, expectAssetOut);
    const shouldAssetOut = subFee(assetOut, S);
    await ethx.connect(Alice).approve(await ethVault.getAddress(), xInput);
    await usd.connect(Alice).approve(await ethVault.getAddress(), usdInput);
    
    const tx = ethVault.connect(Alice).redeemByPairsWithExpectedUsdAmount(usdInput);
    await expect(tx)
      // .to.changeEtherBalances([Alice, ethVault], [shouldAssetOut, shouldAssetOut * (-1)])
      .to.changeTokenBalances(usd, [Alice], [-usdInput]);
    await expect(tx)
      .to.changeTokenBalances(ethx, [Alice], [-xInput]);
  };

  // redeem By usd
  const expectRedeemByUsdAARS = async (usdAmount: string, price: bigint) => {
    const { vaultQuery, ethVault, Alice, usd } = vf;
    await mockPrice(ethVault, price);
    const S = await dumpVaultState(ethVault, vaultQuery);
    expect(S.mode).to.equal(2, "Not support redeem by usd aars");
    const usdInput = parseEther(usdAmount);
    const [, assetOut] = await vaultQuery.calcRedeemByUsdBelowAARS(await ethVault.getAddress(), usdInput);
    const expectAssetOut = expectCalcRedeemByUsdAARS(usdAmount, S);
    expectBigNumberEquals(assetOut, expectAssetOut);
    const shouldAssetOut = subFee(assetOut, S);
    await usd.connect(Alice).approve(await ethVault.getAddress(), usdInput);
    
    await expect(ethVault.connect(Alice).redeemByUsdBelowAARS(usdInput))
      // .to.changeEtherBalances([Alice, ethVault], [shouldAssetOut, -shouldAssetOut])
      .to.changeTokenBalances(usd, [Alice], [-usdInput]);
  };

  // redeem By xtoken
  const expectRedeemByXtokenAARU = async (xAmount: string, price: bigint) => {
    const { vaultQuery, ethVault, Alice, ethx } = vf;
    await mockPrice(ethVault, price);
    const S = await dumpVaultState(ethVault, vaultQuery);
    expect(S.mode).to.equal(3, "Not support redeem by Xtoken aaru");
    const xInput = parseEther(xAmount);
    const [, assetOut] = await vaultQuery.calcRedeemByMarginTokenAboveAARU(await ethVault.getAddress(), xInput);
    const expectAssetOut = expectCalcRedeemByXtokenAARU(xAmount, S);
    expectBigNumberEquals(assetOut, expectAssetOut);
    const shouldAssetOut = subFee(assetOut, S);
    await ethx.connect(Alice).approve(await ethVault.getAddress(), xInput);
    
    await expect(ethVault.connect(Alice).redeemByMarginTokenAboveAARU(xInput))
      // .to.changeEtherBalances([Alice, ethVault], [shouldAssetOut, -shouldAssetOut])
      .to.changeTokenBalances(ethx, [Alice], [-xInput]);
  };

  const expectUsdToEthxSuspended = async (deltaUsdAmount: string, price: bigint) => {
    const { settings, vaultQuery, ethVault, Alice, usd } = vf;
    await mockPrice(ethVault, price);
    const S = await dumpVaultState(ethVault, vaultQuery);
    expect([VaultMode.AdjustmentAboveAARU, VaultMode.AdjustmentBelowAARS]).to.be.includes(Number(S.mode));

    const deltaUsd = parseUnits(deltaUsdAmount, await usd.decimals());
    await expect(vaultQuery.connect(Alice).calcUsdToMarginTokens(await ethVault.getAddress(), await settings.getAddress(), deltaUsd)).to.be.revertedWith("Conditional Discount Purchase suspended");
    await expect(ethVault.connect(Alice).usdToMarginTokens(deltaUsd)).to.be.revertedWith("Conditional Discount Purchase suspended");
  };

  const expectUsdToEthx = async (deltaUsdAmount: string, price: bigint) => {
    const { settings, vaultQuery, ethVault, Alice, usd } = vf;
    await mockPrice(ethVault, price);
    const S = await dumpVaultState(ethVault, vaultQuery);
    // expect(S.AAR).to.be.lt(S.AARS);
    expect([VaultMode.AdjustmentAboveAARU, VaultMode.AdjustmentBelowAARS]).to.be.includes(Number(S.mode));

    const deltaUsd = parseUnits(deltaUsdAmount, await usd.decimals());
    const expectedEthxAmount = await expectCalcUsdToEthxAmount(deltaUsd, S);
    const [, deltaEthx] = await vaultQuery.calcUsdToMarginTokens(await ethVault.getAddress(), await settings.getAddress(), deltaUsd);
    expectBigNumberEquals(expectedEthxAmount, deltaEthx);
    
    const tx = ethVault.connect(Alice).usdToMarginTokens(deltaUsd);
    await expect(tx)
      // .to.changeTokenBalance(ethx, Alice, deltaEthx)
      .to.changeTokenBalance(usd, Alice, -deltaUsd);
    await expect(tx)
      .to.emit(ethVault, "UsdToMarginTokens").withArgs(Alice.address, deltaUsd, anyValue, S.P_ETH, PRICE_DECIMALS);
  };

  it("First mint work", async () => {
    await expectMintPair("3", 2300n);
  });
  
  it("All Mints work", async () => {
    await vf.settings.connect(vf.Alice).updateVaultParamValue(await vf.ethVault.getAddress(), encodeBytes32String("Y"), 0);

    console.log(`\nPrice: 2300; initial mint pairs with 3 $ETH`);
    await expectMintPair("3", 2300n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    console.log(`\nPrice: 1800; AAR < AARS (130%), mint pairs with 1 $ETH`);
    await expectMintPair("1", 1800n);
    await printVaultState(vf.ethVault, vf.vaultQuery);
    
    console.log(`\nRebase $ETH by 1% increase`);
    await mockRebaseEthVaultV2(1);
    console.log(`Price: 1800; AAR < AARS (130%), mint $ETHx with 1 $ETH`);
    await expectMintXTokenAARS("1", 1800n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    console.log(`\nPrice: 1800; AAR within [130%, 150%], mint pairs with 1 $ETH`);
    await expectMintPair("1", 1800n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    console.log(`\nRebase $ETH by 1% increase`);
    await mockRebaseEthVaultV2(1);
    console.log(`Price: 2200; AAR > 150%, mint $ETHx with 1 $ETH`);
    await expectMintXTokenAARS("1", 2200n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    console.log(`\nRebase $ETH by 1% increase`);
    await mockRebaseEthVaultV2(1);
    console.log(`Price: 2200; AAR > 150%, mint $zUSD with 1 $ETH`);
    await expectMintUsdAARU("1", 2200n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    console.log(`\nRebase $ETH by 1% increase`);
    await mockRebaseEthVaultV2(1);
    console.log(`\nPrice: 1700; AAR < 150%, mint pairs with 1 $ETH`);
    await expectMintPair("1", 1700n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    console.log(`\nPrice: 1100; AAR (95%) < AARS (130%), mint pairs to update vault state to adjustment mode`);
    await expectMintPair("1", 1100n);
    expect(await vf.ethVault.AARBelowSafeLineTime()).to.greaterThan(BigInt(0));
    await printVaultState(vf.ethVault, vf.vaultQuery);

    console.log(`\nPrice: 1100; AAR (95%) < AARS (130%), conditional discount purchase suspended`);
    // fast forward by 10 minutes
    await time.increase(10 * 60);
    await expectUsdToEthxSuspended("50", 1100n);

    console.log(`\nPrice: 1100; AAR (95%) < 101%, 30 minutes later, swap $zUSD to $ETHx`);
    await time.increase(30 * 10 * 60);
    await expectUsdToEthx("1000", 1100n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    console.log(`\nPrice: 1100; AAR (103%) > 101%, swap $zUSD to $ETHx`);
    await expectUsdToEthx("1000", 1100n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    console.log(`\nPrice: 1400; AAR (145%) within [130%, 150%], mint pairs with 1 $ETH`);
    await expectMintPair("1", 1400n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    /**
     $ETH Pool:
      P_ETH: 1400.0
      M_ETH: 11.25311804
      M_USD: 10826.713371965798489281
      M_USD_ETH: 10826.713371965798489281
      M_ETHx: 247.663618259908985434
      AAR: 145.51383%
      APY: 0.0
      Mode: AdjustmentBelowAARS
     */
    console.log(`\nPrice: 2000; AAR (207%) > 200%, mint pairs with 0.1 $ETH, Pty Pool Sell High should be triggered`);
    await expectMintPair("0.1", 2000n);
    console.log(`ETH Vault asset balance: ${ethers.formatEther(await vf.ethVault.assetBalance())} $ETH`);
    console.log(`ETH Vault $ETH balance: ${ethers.formatEther(await ethers.provider.getBalance(await vf.ethVault.getAddress()))} $ETH`);
    console.log(`ETH Vault token pot $ETH balance: ${ethers.formatEther(await ethers.provider.getBalance(await vf.ethVault.tokenPot()))} $ETH`);
    const ptyPoolSellHighMinAssetAmount = await vf.settings.vaultParamValue(await vf.ethVault.getAddress(), encodeBytes32String("PtyPoolMinAssetAmount"));
    console.log(`ETH Vault PtyPoolSellHigh minimal balance: ${ethers.formatUnits(ptyPoolSellHighMinAssetAmount, await vf.settings.decimals())} $ETH`);

    // Alice stakes 0.1 to PtyPoolSellHigh
    await expect(vf.ethVaultPtyPoolSellHigh.connect(vf.Alice).stake(ethers.parseEther("0.1"), { value: ethers.parseUnits("0.1") })).not.to.be.rejected;
    await expectMintPair("0.1", 2000n);
    expect(await vf.ethVaultPtyPoolSellHigh.userStakingBalance(vf.Alice.address)).to.equal(ethers.parseEther("0.1"));
    expect(await vf.ethVaultPtyPoolSellHigh.totalStakingBalance()).to.equal(ethers.parseEther("0.1"));
    await expect(vf.ethVaultPtyPoolSellHigh.connect(vf.Bob).stake(ethers.parseEther("0.1"), { value: ethers.parseUnits("0.1") })).not.to.be.rejected;
    
    console.log(`\nBefore PtyPoolSellHigh triggered`);
    await printVaultState(vf.ethVault, vf.vaultQuery);
    await expectMintPair("0.1", 2000n);
    console.log(`\After depositing 0.1 $ETH and PtyPoolSellHigh triggered`);
    await printVaultState(vf.ethVault, vf.vaultQuery);
    expect(await ethers.provider.getBalance(await vf.ethVault.getAddress())).to.equal(0);
    console.log(`ETH Vault asset balance: ${ethers.formatEther(await vf.ethVault.assetBalance())} $ETH`);
    console.log(`ETH Vault token pot balance: ${ethers.formatEther(await ethers.provider.getBalance(await vf.ethVault.tokenPot()))} $ETH`);
    console.log(`ETH Vault PtyPoolSellHigh Alice staking balance: ${ethers.formatEther(await vf.ethVaultPtyPoolSellHigh.userStakingBalance(vf.Alice.address))}`);
    console.log(`ETH Vault PtyPoolSellHigh Alice earned: ${ethers.formatUnits(await vf.ethVaultPtyPoolSellHigh.earnedMatchedToken(vf.Alice.address), 18)} $zUSD`);
    console.log(`ETH Vault PtyPoolSellHigh Bob staking balance: ${ethers.formatEther(await vf.ethVaultPtyPoolSellHigh.userStakingBalance(vf.Bob.address))}`);
    console.log(`ETH Vault PtyPoolSellHigh Bob earned: ${ethers.formatUnits(await vf.ethVaultPtyPoolSellHigh.earnedMatchedToken(vf.Bob.address), 18)} $zUSD`);

    console.log(`\nBob stakes 10 $ETH to PtyPoolSellHigh`);
    await expect(vf.ethVaultPtyPoolSellHigh.connect(vf.Bob).stake(ethers.parseEther("10"), { value: ethers.parseUnits("1") })).to.be.rejected;
    await expect(vf.ethVaultPtyPoolSellHigh.connect(vf.Bob).stake(ethers.parseEther("10"), { value: ethers.parseUnits("20") })).to.be.rejected;
    await expect(vf.ethVaultPtyPoolSellHigh.connect(vf.Bob).stake(ethers.parseEther("10"), { value: ethers.parseUnits("10") })).not.to.be.rejected;
    console.log(`ETH Vault PtyPoolSellHigh Alice staking balance: ${ethers.formatEther(await vf.ethVaultPtyPoolSellHigh.userStakingBalance(vf.Alice.address))}`);
    console.log(`ETH Vault PtyPoolSellHigh Bob staking balance: ${ethers.formatEther(await vf.ethVaultPtyPoolSellHigh.userStakingBalance(vf.Bob.address))}`);

    console.log(`\nBefore PtyPoolSellHigh triggered again`);
    await printVaultState(vf.ethVault, vf.vaultQuery);
    await expectMintPair("0.1", 2000n);
    console.log(`\nAfter depositing 0.1 $ETH and PtyPoolSellHigh triggered again`);
    await printVaultState(vf.ethVault, vf.vaultQuery);
    expect(await ethers.provider.getBalance(await vf.ethVault.getAddress())).to.equal(0);
    console.log(`ETH Vault asset balance: ${ethers.formatEther(await vf.ethVault.assetBalance())} $ETH`);
    console.log(`ETH Vault $ETH balance: ${ethers.formatEther(await ethers.provider.getBalance(await vf.ethVault.getAddress()))} $ETH`);
    console.log(`ETH Vault token pot $ETH balance: ${ethers.formatEther(await ethers.provider.getBalance(await vf.ethVault.tokenPot()))} $ETH`);
    console.log(`ETH Vault PtyPoolSellHigh Alice staking balance: ${ethers.formatEther(await vf.ethVaultPtyPoolSellHigh.userStakingBalance(vf.Alice.address))}`);
    console.log(`ETH Vault PtyPoolSellHigh Alice earned: ${ethers.formatUnits(await vf.ethVaultPtyPoolSellHigh.earnedMatchedToken(vf.Alice.address), 18)} $zUSD`);
    console.log(`ETH Vault PtyPoolSellHigh Bob staking balance: ${ethers.formatEther(await vf.ethVaultPtyPoolSellHigh.userStakingBalance(vf.Bob.address))}`);
    console.log(`ETH Vault PtyPoolSellHigh Bob earned: ${ethers.formatUnits(await vf.ethVaultPtyPoolSellHigh.earnedMatchedToken(vf.Bob.address), 18)} $zUSD`);
    await expect(vf.ethVaultPtyPoolSellHigh.connect(vf.Bob).exit()).not.to.be.rejected;

    /**
    $ETH Pool:
      P_ETH: 2000.0
      M_ETH: 18.140683358818174467
      M_USD: 24187.577811757565955874
      M_USD_ETH: 24187.577811757565955874
      M_ETHx: 256.448109548271992075
      AAR: 150.00%
      APY: 0.0
      Mode: Stability
     */
    console.log(`\nPrice: 1600; AAR (120%) < 130%, mint pairs with 0.1 $ETH, Pty Pool Buy Low should be triggered`);
    await expectMintPair("0.1", 1600n);
    await printVaultState(vf.ethVault, vf.vaultQuery);
    console.log(`ETH Vault asset balance: ${ethers.formatEther(await vf.ethVault.assetBalance())} $ETH`);
    console.log(`ETH Vault token pot balance: ${ethers.formatEther(await ethers.provider.getBalance(await vf.ethVault.tokenPot()))} $ETH`);
    const ptyPoolBuyLowPtyPoolMinUsdAmount = await vf.settings.vaultParamValue(await vf.ethVault.getAddress(), encodeBytes32String("PtyPoolMinUsdAmount"));
    console.log(`ETH Vault PtyPoolBuyLow minimal $zUSD amount: ${ethers.formatUnits(ptyPoolBuyLowPtyPoolMinUsdAmount, await vf.settings.decimals())} $zUSD`);

    await expect(vf.usd.connect(vf.Alice).transfer(vf.Bob.address, ethers.parseUnits("1000", await vf.usd.decimals()))).not.to.be.rejected;
    await expect(vf.usd.connect(vf.Alice).approve(vf.ethVaultPtyPoolBuyLow.getAddress(), ethers.parseUnits("1000000", await vf.usd.decimals()))).not.to.be.rejected;
    await expect(vf.usd.connect(vf.Bob).approve(vf.ethVaultPtyPoolBuyLow.getAddress(), ethers.parseUnits("1000000", await vf.usd.decimals()))).not.to.be.rejected;
    await expect(vf.ethVaultPtyPoolBuyLow.connect(vf.Alice).stake(ethers.parseUnits("100", await vf.usd.decimals()))).not.to.be.rejected;
    await expect(vf.ethVaultPtyPoolBuyLow.connect(vf.Bob).stake(ethers.parseUnits("100", await vf.usd.decimals()))).not.to.be.rejected;
    await expectMintPair("0.1", 1600n);
    console.log(`ETH Vault PtyPoolBuyLow Alice staking balance: ${ethers.formatUnits(await vf.ethVaultPtyPoolBuyLow.userStakingBalance(vf.Alice.address), 18)} $zUSD`);
    console.log(`ETH Vault PtyPoolBuyLow Alice earned: ${ethers.formatEther(await vf.ethVaultPtyPoolBuyLow.earnedMatchedToken(vf.Alice.address))} $ETH`);
    console.log(`ETH Vault PtyPoolBuyLow Bob staking balance: ${ethers.formatUnits(await vf.ethVaultPtyPoolBuyLow.userStakingBalance(vf.Bob.address), 18)} $zUSD`);
    console.log(`ETH Vault PtyPoolBuyLow Bob earned: ${ethers.formatEther(await vf.ethVaultPtyPoolBuyLow.earnedMatchedToken(vf.Bob.address))} $ETH`);

    console.log(`Alice $zUSD balance: ${ethers.formatUnits(await vf.usd.balanceOf(vf.Alice.address), await vf.usd.decimals())} $zUSD`);
    console.log(`Bob $zUSD balance: ${ethers.formatUnits(await vf.usd.balanceOf(vf.Bob.address), await vf.usd.decimals())} $zUSD`);
    await expect(vf.ethVaultPtyPoolBuyLow.connect(vf.Alice).stake(ethers.parseUnits("10000", await vf.usd.decimals()))).not.to.be.rejected;
    await expect(vf.ethVaultPtyPoolBuyLow.connect(vf.Bob).stake(ethers.parseUnits("10000", await vf.usd.decimals()))).not.to.be.rejected;

    console.log(`\nBefore PtyPoolBuyLow triggered`);
    await printVaultState(vf.ethVault, vf.vaultQuery);
    await expectMintPair("0.1", 1600n);
    console.log(`\nAfter depositing 0.1 $ETH and PtyPoolBuyLow triggered`);
    await printVaultState(vf.ethVault, vf.vaultQuery);
    console.log(`ETH Vault asset balance: ${ethers.formatEther(await vf.ethVault.assetBalance())} $ETH`);
    console.log(`ETH Vault token pot balance: ${ethers.formatEther(await ethers.provider.getBalance(await vf.ethVault.tokenPot()))} $ETH`);
    console.log(`ETH Vault PtyPoolBuyLow Alice staking balance: ${ethers.formatUnits(await vf.ethVaultPtyPoolBuyLow.userStakingBalance(vf.Alice.address), 18)} $zUSD`);
    console.log(`ETH Vault PtyPoolBuyLow Alice earned: ${ethers.formatEther(await vf.ethVaultPtyPoolBuyLow.earnedMatchedToken(vf.Alice.address))} $ETH`);
    console.log(`ETH Vault PtyPoolBuyLow Bob staking balance: ${ethers.formatUnits(await vf.ethVaultPtyPoolBuyLow.userStakingBalance(vf.Bob.address), 18)} $zUSD`);
    console.log(`ETH Vault PtyPoolBuyLow Bob earned: ${ethers.formatEther(await vf.ethVaultPtyPoolBuyLow.earnedMatchedToken(vf.Bob.address))} $ETH`);

  });

  it("All Redeem work", async () => {
    await vf.settings.connect(vf.Alice).updateVaultParamValue(await vf.ethVault.getAddress(), encodeBytes32String("Y"), 0);
    await expectMintPair("4", 2300n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    // to Low
    await expectRedeemByPairWithUsd("1000", 1800n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    // Already to low
    await expectRedeemByUsdAARS("1000", 1800n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    await expectRedeemByPairWithUsd("1000", 1800n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    // expect to High
    await expectRedeemByPairWithUsd("100", 3200n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    // Already to High
    await expectRedeemByXtokenAARU("0.5", 3200n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    // expect to stable
    await expectRedeemByPairWithUsd("100", 1700n);
    await printVaultState(vf.ethVault, vf.vaultQuery);

    // Already to stable
  });
});
