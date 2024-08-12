import _ from 'lodash';
import { expect } from "chai";
import { ethers } from "hardhat";
import { FactoryOptions } from "@nomicfoundation/hardhat-ethers/types";
import {
  MockERC20__factory,
  ERC20__factory,
  MarginToken__factory,
  ProtocolSettings__factory,
  MockRebasableERC20__factory,
  Usd__factory,
  VaultCalculator__factory,
  StableVaultCalculator__factory,
  ZooProtocol__factory,
  Vault,
  StableVault,
  VaultQuery,
  VaultQuery__factory,
  PtyPoolBuyLow__factory,
  PtyPoolSellHigh__factory,
  MockPriceFeed__factory,
  ZooProtocol,
  ProtocolSettings,
  MockPriceFeed,
  Vault__factory,
  StableVault__factory,
  MockBoundValidator__factory,
  MockAbsPyth__factory,
  PythOracle__factory,
  ChainlinkOracle__factory,
  MockV3Aggregator__factory,
  BoundValidator__factory
} from "../typechain";

const { provider } = ethers;

export const ONE_DAY_IN_SECS = 24 * 60 * 60;

export const nativeTokenAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const PRICE_DECIMALS = 8n;

export enum VaultMode {
  Empty = 0,
  Stability = 1,
  AdjustmentBelowAARS = 2,
  AdjustmentAboveAARU = 3,
}

export enum VaultType {
  Volatile = 0,
  Stable = 1
}

// export const maxContractSize = 24576;

export async function deployBaseContractsFixture() {
  const [Alice, Bob, Caro, Dave, Ivy] = await ethers.getSigners();

  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const MockERC20 = await MockERC20Factory.deploy("ERC20 Mock", "MockERC20");
  const erc20 = MockERC20__factory.connect(await MockERC20.getAddress(), provider);

  const WBTC = await MockERC20Factory.deploy("WBTC Token", "WBTC");
  const wbtc = MockERC20__factory.connect(await WBTC.getAddress(), provider);

  const MockRebasableERC20Factory = await ethers.getContractFactory("MockRebasableERC20");
  const MockRebasableERC20 = await MockRebasableERC20Factory.deploy("Liquid staked Ether 2.0", "stETH");
  const stETH = MockRebasableERC20__factory.connect(await MockRebasableERC20.getAddress(), provider);

  const UsdcMock = await MockRebasableERC20Factory.deploy("USDC Token", "USDC");
  const usdc = MockRebasableERC20__factory.connect(await UsdcMock.getAddress(), provider);

  const ZooProtocolFactory = await ethers.getContractFactory("ZooProtocol");
  // expect(ZooProtocolFactory.bytecode.length / 2).lessThan(maxContractSize);
  const ZooProtocol = await ZooProtocolFactory.deploy();
  const protocol = ZooProtocol__factory.connect(await ZooProtocol.getAddress(), provider);

  const ProtocolSettingsFactory = await ethers.getContractFactory("ProtocolSettings");
  // expect(ProtocolSettingsFactory.bytecode.length / 2).lessThan(maxContractSize);
  const ProtocolSettings = await ProtocolSettingsFactory.deploy(await protocol.getAddress(), Ivy.address);
  const settings = ProtocolSettings__factory.connect(await ProtocolSettings.getAddress(), provider);

  const USDFactory = await ethers.getContractFactory("Usd");
  // expect(USDFactory.bytecode.length / 2).lessThan(maxContractSize);
  const Usd = await USDFactory.deploy(await protocol.getAddress(), await settings.getAddress());
  const usd = Usd__factory.connect(await Usd.getAddress(), provider);

  const MockPriceFeedFactory = await ethers.getContractFactory("MockPriceFeed");
  const EthPriceFeedMock = await MockPriceFeedFactory.deploy();
  const ethPriceFeed = MockPriceFeed__factory.connect(await EthPriceFeedMock.getAddress(), provider);

  const stETHPriceFeedMock = await MockPriceFeedFactory.deploy();
  const stethPriceFeed = MockPriceFeed__factory.connect(await stETHPriceFeedMock.getAddress(), provider);

  const WbtcPriceFeedMock = await MockPriceFeedFactory.deploy();
  const wbtcPriceFeed = MockPriceFeed__factory.connect(await WbtcPriceFeedMock.getAddress(), provider);

  const UsdcPriceFeedMock = await MockPriceFeedFactory.deploy();
  const usdcPriceFeed = MockPriceFeed__factory.connect(await UsdcPriceFeedMock.getAddress(), provider);

  // let trans = await protocol.connect(Alice).initialize(await Usd.getAddress());
  // await trans.wait();

  const VaultCalculatorFactory = await ethers.getContractFactory("VaultCalculator");
  const VaultCalculator = await VaultCalculatorFactory.deploy();
  const vaultCalculator = VaultCalculator__factory.connect(await VaultCalculator.getAddress(), provider);

  const Vault = await ethers.getContractFactory("Vault", {
    libraries: {
      VaultCalculator: await vaultCalculator.getAddress(),
    }
  });
  console.log(`Vault code size: ${Vault.bytecode.length / 2} bytes`);

  const StableVaultCalculatorFactory = await ethers.getContractFactory("StableVaultCalculator");
  const StableVaultCalculator = await StableVaultCalculatorFactory.deploy();
  const stableVaultCalculator = StableVaultCalculator__factory.connect(await StableVaultCalculator.getAddress(), provider);

  const VaultQueryFactory = await ethers.getContractFactory("VaultQuery", {
    libraries: {
      VaultCalculator: await vaultCalculator.getAddress(),
      StableVaultCalculator: await stableVaultCalculator.getAddress(),
    }
  });
  const VaultQuery = await VaultQueryFactory.deploy();
  const vaultQuery = VaultQuery__factory.connect(await VaultQuery.getAddress(), provider);

  return {
    Alice,
    Bob,
    Caro,
    Dave,
    Ivy,
    erc20,
    wbtc,
    stETH,
    usdc,
    usd,
    protocol,
    settings,
    vaultCalculator,
    stableVaultCalculator,
    vaultQuery,
    ethPriceFeed,
    stethPriceFeed,
    wbtcPriceFeed,
    usdcPriceFeed
  };
}

async function deployVault(
  protocol: ZooProtocol, settings: ProtocolSettings, priceFeed: MockPriceFeed, vaultContractName: "Vault" | "Vault",
  ptyPoolBuyLowName: "PtyPoolBuyLow" | "PtyPoolBuyLow", ptyPoolSellHighName: "PtyPoolSellHigh" | "PtyPoolSellHigh",
  assetTokenAddress: string, marginTokenName: string, marginTokenSymbol: string, factoryOptions?: FactoryOptions,
) {
  const [Alice, Bob] = await ethers.getSigners();

   const MarginTokenFactory = await ethers.getContractFactory("MarginToken");
   const MarginToken = await MarginTokenFactory.deploy(await protocol.getAddress(), await settings.getAddress(), marginTokenName, marginTokenSymbol);
   const marginToken = MarginToken__factory.connect(await MarginToken.getAddress(), provider);
 
   const VaultFactory = await ethers.getContractFactory(vaultContractName, factoryOptions);
   const Vault = await VaultFactory.deploy(
     await protocol.getAddress(),
     await settings.getAddress(),
     assetTokenAddress,
     await marginToken.getAddress(),
     await priceFeed.getAddress()
   );
   const vault = Vault__factory.connect(await Vault.getAddress(), provider);
   await expect(protocol.connect(Alice).addVault(await vault.getAddress()))
     .to.emit(protocol, "VaultAdded")
     .withArgs(assetTokenAddress, await vault.getAddress());
 
   await expect(marginToken.connect(Bob).setVault(await vault.getAddress())).to.be.revertedWith("Ownable: caller is not the owner");
   await expect(marginToken.connect(Alice).setVault(await vault.getAddress())).to.emit(marginToken, "SetVault").withArgs(await vault.getAddress());
 
   // Create PtyPools
   const PtyPoolBuyLowFactory = await ethers.getContractFactory(ptyPoolBuyLowName);
   const PtyPoolBuyLow = await PtyPoolBuyLowFactory.deploy(
     await protocol.getAddress(),
     await settings.getAddress(),
     await vault.getAddress(),
     await marginToken.getAddress(),
     assetTokenAddress
   );
   const ptyPoolBuyLow = PtyPoolBuyLow__factory.connect(await PtyPoolBuyLow.getAddress(), provider);

   const PtyPoolSellHighFactory = await ethers.getContractFactory(ptyPoolSellHighName);
   const PtyPoolSellHigh = await PtyPoolSellHighFactory.deploy(
     await protocol.getAddress(),
     await settings.getAddress(),
     await vault.getAddress(),
     assetTokenAddress,
     await marginToken.getAddress()
   );
   const ptyPoolSellHigh = PtyPoolSellHigh__factory.connect(await PtyPoolSellHigh.getAddress(), provider);
   let trans = await vault.connect(Alice).setPtyPools(await ptyPoolBuyLow.getAddress(), await ptyPoolSellHigh.getAddress());
   await trans.wait();

   return { marginToken, vault, ptyPoolBuyLow, ptyPoolSellHigh };
}

async function deployStableVault(
  protocol: ZooProtocol, settings: ProtocolSettings, priceFeed: MockPriceFeed, vaultContractName: "StableVault" | "StableVault",
  assetTokenAddress: string, marginTokenName: string, marginTokenSymbol: string, factoryOptions?: FactoryOptions
) {
  const [Alice, Bob] = await ethers.getSigners();

  const MarginTokenFactory = await ethers.getContractFactory("MarginToken");
  const MarginToken = await MarginTokenFactory.deploy(await protocol.getAddress(), await settings.getAddress(), marginTokenName, marginTokenSymbol);
  const marginToken = MarginToken__factory.connect(await MarginToken.getAddress(), provider);

  const StableVault = await ethers.getContractFactory(vaultContractName, factoryOptions);
  console.log(`StableVault code size: ${StableVault.bytecode.length / 2} bytes`);
  const Vault = await StableVault.deploy(
    await protocol.getAddress(),
    await settings.getAddress(),
    assetTokenAddress,
    await marginToken.getAddress(),
    await priceFeed.getAddress()
  );
  const vault = StableVault__factory.connect(await Vault.getAddress(), provider);
  await expect(protocol.connect(Alice).addVault(await vault.getAddress()))
    .to.emit(protocol, "VaultAdded")
    .withArgs(await assetTokenAddress, await vault.getAddress());

  await expect(marginToken.connect(Bob).setVault(await vault.getAddress())).to.be.revertedWith("Ownable: caller is not the owner");
  await expect(marginToken.connect(Alice).setVault(await vault.getAddress())).to.emit(marginToken, "SetVault").withArgs(await vault.getAddress());

  // Adjust StableVault settings. Set AARS to 110% (default to 130%)
  await expect(settings.connect(Alice).updateVaultParamValue(
    await vault.getAddress(), ethers.encodeBytes32String("AARS"), 110n * power(Number(await settings.decimals())) / 100n)
  )
    .to.emit(settings, "UpdateVaultParamValue")
    .withArgs(await vault.getAddress(), ethers.encodeBytes32String("AARS"), 110n * power(Number(await settings.decimals())) / 100n);

  return { marginToken, vault };
}

export async function deployAllContractsFixture() {
  const {
    Alice,
    Bob,
    Caro,
    usd,
    stETH,
    wbtc,
    usdc,
    protocol,
    settings,
    vaultCalculator,
    stableVaultCalculator,
    vaultQuery,
    ethPriceFeed,
    stethPriceFeed,
    wbtcPriceFeed,
    usdcPriceFeed
  } = await deployBaseContractsFixture();

  let trans = await protocol.connect(Alice).initialize(await usd.getAddress());
  await trans.wait();

  let res = await deployVault(protocol, settings, ethPriceFeed, "Vault", "PtyPoolBuyLow", "PtyPoolSellHigh", nativeTokenAddress, "Zoo Leveraged ETH", "ETHx", {
    libraries: {
      VaultCalculator: await vaultCalculator.getAddress(),
    }
  });
  const ethx = res.marginToken, ethVault = res.vault, ethVaultPtyPoolBuyLow = res.ptyPoolBuyLow, ethVaultPtyPoolSellHigh = res.ptyPoolSellHigh;

  res = await deployVault(protocol, settings, stethPriceFeed, "Vault", "PtyPoolBuyLow", "PtyPoolSellHigh", await stETH.getAddress(), "Zoo Leveraged stETH", "stETHx", {
    libraries: {
      VaultCalculator: await vaultCalculator.getAddress(),
    }
  });
  const stethx = res.marginToken, stethVault = res.vault, stethVaultPtyPoolBuyLow = res.ptyPoolBuyLow, stethVaultPtyPoolSellHigh = res.ptyPoolSellHigh;

  res = await deployVault(protocol, settings, wbtcPriceFeed, "Vault", "PtyPoolBuyLow", "PtyPoolSellHigh", await wbtc.getAddress(), "Zoo Leveraged wbtc", "wbtcx", {
    libraries: {
      VaultCalculator: await vaultCalculator.getAddress(),
    }
  });
  const wbtcx = res.marginToken, wbtcVault = res.vault, wbtcVaultPtyPoolBuyLow = res.ptyPoolBuyLow, wbtcVaultPtyPoolSellHigh = res.ptyPoolSellHigh;

  let res2 = await deployStableVault(protocol, settings, usdcPriceFeed, "StableVault", await usdc.getAddress(), "Zoo Stable USDC", "USDCx", {
    libraries: {
      StableVaultCalculator: await stableVaultCalculator.getAddress(),
    }
  });
  const usdcx = res2.marginToken, usdcVault = res2.vault;

  return {
    Alice,
    Bob,
    Caro,
    usd,
    stETH,
    wbtc,
    protocol,
    settings,
    vaultCalculator,
    vaultQuery,
    ethPriceFeed,
    stethPriceFeed,
    wbtcPriceFeed,
    usdcPriceFeed,
    ethVault,
    ethx,
    ethVaultPtyPoolBuyLow,
    ethVaultPtyPoolSellHigh,
    stethVault,
    stethx,
    stethVaultPtyPoolBuyLow,
    stethVaultPtyPoolSellHigh,
    wbtcVault,
    wbtcx,
    wbtcVaultPtyPoolBuyLow,
    wbtcVaultPtyPoolSellHigh,
    usdc,
    usdcx,
    usdcVault
  };
}

type UnPromise<T> = T extends Promise<infer U> ? U : never;
export type VaultsFixture = UnPromise<ReturnType<typeof deployAllContractsFixture>>;

export async function dumpVaultState(vault: Vault, vaultQuery: VaultQuery) {
  const protocol = ZooProtocol__factory.connect(await vault.protocol(), provider);
  const settings = ProtocolSettings__factory.connect(await vault.settings(), provider);

  const Usd = Usd__factory.connect(await protocol.usdToken(), provider);
  const mode = await vault.vaultMode();

  const state = await vaultQuery.getVaultState(await vault.getAddress());
  return {
    Y: await vault.paramValue(ethers.encodeBytes32String("Y")),
    C: await vault.paramValue(ethers.encodeBytes32String("C")),
    M_ETH: state.M_ETH,
    P_ETH: state.P_ETH,
    P_ETH_DECIMALS: state.P_ETH_DECIMALS,
    M_USD: await Usd.totalSupply(),
    M_USD_ETH: state.M_USD_ETH,
    M_ETHx: state.M_ETHx,
    AAR: state.aar,
    AART: state.AART,
    AARU: state.AARU,
    AARS: state.AARS,
    AARC: state.AARC,
    AARDecimals: state.AARDecimals,
    RateR: state.RateR,
    AARBelowSafeLineTime: state.AARBelowSafeLineTime,
    settingDecimals: await settings.decimals(),
    mode
  };
}

export async function dumpStableVaultState(vault: StableVault, vaultQuery: VaultQuery) {
  const protocol = ZooProtocol__factory.connect(await vault.protocol(), provider);
  const settings = ProtocolSettings__factory.connect(await vault.settings(), provider);

  const assetTokenERC20 = ERC20__factory.connect(await vault.assetToken(), provider);
  const assetSymbol = (await vault.assetToken()) == nativeTokenAddress ? "ETH" : await assetTokenERC20.symbol();
  const Usd = Usd__factory.connect(await protocol.usdToken(), provider);
  // const mode = await vault.vaultMode();

  const state = await vaultQuery.getStableVaultState(await vault.getAddress());
  return {
    Y: await vault.paramValue(ethers.encodeBytes32String("Y")),
    C: await vault.paramValue(ethers.encodeBytes32String("C")),
    TreasuryFeeRate: await vault.paramValue(ethers.encodeBytes32String("TreasuryFeeRate")),
    M_USDC: state.M_USDC,
    P_USDC: state.P_USDC,
    P_USDC_DECIMALS: state.P_USDC_DECIMALS,
    M_USD: await Usd.totalSupply(),
    M_USD_USDC: state.M_USD_USDC,
    M_USDCx: state.M_USDCx,
    AAR: state.aar,
    AARS: state.AARS,
    AARDecimals: state.AARDecimals,
    RateR: state.RateR,
    AARBelowSafeLineTime: state.AARBelowSafeLineTime,
    settingDecimals: await settings.decimals(),
    // mode
  };
}

export async function printVaultState(vault: Vault, vaultQuery: VaultQuery) {
  const protocol = ZooProtocol__factory.connect(await vault.protocol(), provider);
  const settings = ProtocolSettings__factory.connect(await vault.settings(), provider);

  const assetTokenERC20 = ERC20__factory.connect(await vault.assetToken(), provider);
  const assetSymbol = (await vault.assetToken() == nativeTokenAddress) ? 'ETH' : await assetTokenERC20.symbol();
  const Usd = Usd__factory.connect(await protocol.usdToken(), provider);
  const ethxToken = Usd__factory.connect(await vault.marginToken(), provider);
  const priceFeed = MockPriceFeed__factory.connect(await vault.priceFeed(), provider);

  const aar = await vaultQuery.AAR(await vault.getAddress());
  const AAR = (aar == ethers.MaxUint256) ? 'MaxUint256' : numberToPercent(_.toNumber(ethers.formatUnits(aar, await vault.AARDecimals())));
  const mode = Number(await vault.vaultMode());

  console.log(`$${assetSymbol} Pool:`);
  console.log(`  P_${assetSymbol}: ${ethers.formatUnits(await priceFeed.latestPrice(), await priceFeed.decimals())}`);
  console.log(`  M_${assetSymbol}: ${ethers.formatUnits(await vault.assetBalance(), 18)}`);
  console.log(`  M_USD: ${ethers.formatUnits(await Usd.totalSupply(), 18)}`);
  console.log(`  M_USD_${assetSymbol}: ${ethers.formatUnits(await vault.usdTotalSupply(), 18)}`);
  console.log(`  M_${assetSymbol}x: ${ethers.formatUnits(await ethxToken.totalSupply(), 18)}`);
  console.log(`  AAR: ${AAR}`);
  console.log(`  APY: ${ethers.formatUnits(await vault.paramValue(ethers.encodeBytes32String('Y')), await settings.decimals())}`);
  console.log(`  Mode: ${VaultMode[mode]}`);
}

export async function printStableVaultState(vault: StableVault, vaultQuery: VaultQuery) {
  const protocol = ZooProtocol__factory.connect(await vault.protocol(), provider);
  const settings = ProtocolSettings__factory.connect(await vault.settings(), provider);

  const assetTokenERC20 = ERC20__factory.connect(await vault.assetToken(), provider);
  const assetSymbol = (await vault.assetToken() == nativeTokenAddress) ? 'ETH' : await assetTokenERC20.symbol();
  const Usd = Usd__factory.connect(await protocol.usdToken(), provider);
  const usdcxToken = Usd__factory.connect(await vault.marginToken(), provider);
  const priceFeed = MockPriceFeed__factory.connect(await vault.priceFeed(), provider);

  const aar = await vaultQuery.AAR(await vault.getAddress());
  const AAR = (aar == ethers.MaxUint256) ? 'MaxUint256' : numberToPercent(_.toNumber(ethers.formatUnits(aar, await vault.AARDecimals())));
  // const mode = await vault.vaultMode();

  console.log(`$${assetSymbol} Pool:`);
  console.log(`  P_${assetSymbol}: ${ethers.formatUnits(await priceFeed.latestPrice(), await priceFeed.decimals())}`);
  console.log(`  M_${assetSymbol}: ${ethers.formatUnits(await vault.assetBalance(), 18)}`);
  console.log(`  M_USD: ${ethers.formatUnits(await Usd.totalSupply(), 18)}`);
  console.log(`  M_USD_${assetSymbol}: ${ethers.formatUnits(await vault.usdTotalSupply(), 18)}`);
  console.log(`  M_${assetSymbol}x: ${ethers.formatUnits(await usdcxToken.totalSupply(), 18)}`);
  console.log(`  AAR: ${AAR}`);
  console.log(`  APY: ${ethers.formatUnits(await vault.paramValue(ethers.encodeBytes32String('Y')), await settings.decimals())}`);
  // console.log(`  Mode: ${VaultMode[mode]}`);
}

export type DumpVS = UnPromise<ReturnType<typeof dumpVaultState>>;
export type DumpSVS = UnPromise<ReturnType<typeof dumpStableVaultState>>;

export function expandTo18Decimals(n: number) {
  return BigInt(n) * (10n ** 18n);
}

// ensure result is within .01%
export function expectBigNumberEquals(expected: bigint, actual: bigint) {
  const equals = abs(expected - actual) <= abs(expected) / 10000n;
  if (!equals) {
    console.log(`BigNumber does not equal. expected: ${expected.toString()}, actual: ${actual.toString()}`);
  }
  expect(equals).to.be.true;
}

export function numberToPercent(num: number) {
  return new Intl.NumberFormat("default", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(num);
}

export function power(pow: number | bigint) {
  return 10n ** BigInt(pow);
}

export function abs(n: bigint) {
  return n < 0n ? -n : n;
}

export function isStableVault(vault: Vault | StableVault) {
  return (vault as Vault).vaultMode === undefined;
}

export const addr0000 = "0x0000000000000000000000000000000000000000";
export const addr1111 = "0x1111111111111111111111111111111111111111";
export const getSimpleAddress = (i: number) =>
  `0x${Array.from({ length: 40 })
    .map(() => `${i}`)
    .join("")}`;

export const getBytes32String = (i: number) =>
  `0x${Array.from({ length: 64 })
    .map(() => `${i}`)
    .join("")}`;

export const increaseTime = async (time: number) => {
  await ethers.provider.send("evm_increaseTime", [time]);
  await ethers.provider.send("evm_mine"); // this one will have 02:00 PM as its timestamp
};

export const getTime = async () => {
  const block = await ethers.provider.getBlock("latest");
  return block!.timestamp;
};

export const makeToken = async (name: string, symbol: string, decimals: number = 18) => {
  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const ERC20 = await MockERC20Factory.deploy(name, symbol);
  const erc20 = MockERC20__factory.connect(await ERC20.getAddress(), provider);

  const [Alice] = await ethers.getSigners();
  await erc20.connect(Alice).setDecimals(decimals);
  return erc20
};

export const getMockBoundValidator = async () => {
  const BoundValidatorFactory = await ethers.getContractFactory("MockBoundValidator");
  const BoundValidator = await BoundValidatorFactory.deploy();
  return MockBoundValidator__factory.connect(await BoundValidator.getAddress(), provider);
};

export const getMockChainlinkFeed = async (decimals: bigint,  initialPrice: bigint) => {
  const MockV3AggregatorFactory = await ethers.getContractFactory("MockV3Aggregator");
  const MockV3Aggregator = await MockV3AggregatorFactory.deploy(decimals, initialPrice);
  return MockV3Aggregator__factory.connect(await MockV3Aggregator.getAddress(), provider);
};

export const getBoundValidator = async (protocolAddress: string) => {
  const BoundValidatorFactory = await ethers.getContractFactory("BoundValidator");
  const BoundValidator = await BoundValidatorFactory.deploy(protocolAddress);
  return BoundValidator__factory.connect(await BoundValidator.getAddress(), provider);
};

export const getChainlinkOracle = async (protocolAddress: string) => {
  const ChainlinkOracleFactory = await ethers.getContractFactory("ChainlinkOracle");
  const ChainlinkOracle = await ChainlinkOracleFactory.deploy(protocolAddress);
  return ChainlinkOracle__factory.connect(await ChainlinkOracle.getAddress(), provider);
};

export const getPythOracle = async (protocolAddress: string) => {
  const MockAbsPythFactory = await ethers.getContractFactory("MockAbsPyth");
  const MockAbsPyth = await MockAbsPythFactory.deploy(0, 0);
  const actualOracle= MockAbsPyth__factory.connect(await MockAbsPyth.getAddress(), provider);

  const PythOracleFactory = await ethers.getContractFactory("PythOracle");
  const PythOracle = await PythOracleFactory.deploy(protocolAddress, await actualOracle.getAddress());
  return PythOracle__factory.connect(await PythOracle.getAddress(), provider);
}