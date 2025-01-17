import _ from 'lodash';
import { expect } from "chai";
import { encodeBytes32String, formatUnits } from "ethers";
import { ethers } from "hardhat";
import { time } from '@nomicfoundation/hardhat-network-helpers';
import {
  MockERC20__factory,
  ProtocolSettings__factory,
  MockRebasableERC20__factory,
  ZooProtocol__factory,
  Vault__factory,
  VaultCalculator__factory,
  MockStakingPool__factory,
  RedeemPoolFactory__factory,
  BribesPoolFactory__factory,
  Vault,
} from "../typechain";

const { provider } = ethers;

export const ONE_DAY_IN_SECS = 24 * 60 * 60;

export const SETTINGS_DECIMALS = 10;

export const nativeTokenAddress = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const maxContractSize = 24576;

export async function deployContractsFixture() {
  const [Alice, Bob, Caro, Dave, Ivy] = await ethers.getSigners();

  const ZooProtocolFactory = await ethers.getContractFactory("ZooProtocol");
  expect(ZooProtocolFactory.bytecode.length / 2).lessThan(maxContractSize);
  const ZooProtocol = await ZooProtocolFactory.deploy();
  const protocol = ZooProtocol__factory.connect(await ZooProtocol.getAddress(), provider);

  const ProtocolSettingsFactory = await ethers.getContractFactory("ProtocolSettings");
  expect(ProtocolSettingsFactory.bytecode.length / 2).lessThan(maxContractSize);
  const ProtocolSettings = await ProtocolSettingsFactory.deploy(await protocol.getAddress(), Ivy.address);
  const settings = ProtocolSettings__factory.connect(await ProtocolSettings.getAddress(), provider);

  const RedeemPoolFactoryFactory = await ethers.getContractFactory("RedeemPoolFactory");
  const RedeemPoolFactory = await RedeemPoolFactoryFactory.deploy(await protocol.getAddress());
  const redeemPoolFactory = RedeemPoolFactory__factory.connect(await RedeemPoolFactory.getAddress(), provider);

  const BribesPoolFactoryFactory = await ethers.getContractFactory("BribesPoolFactory");
  const BribesPoolFactory = await BribesPoolFactoryFactory.deploy(await protocol.getAddress());
  const bribesPoolFactory = BribesPoolFactory__factory.connect(await BribesPoolFactory.getAddress(), provider);
  
  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  // const MockERC20 = await MockERC20Factory.deploy("ERC20 Mock", "MockERC20");
  // const erc20 = MockERC20__factory.connect(await MockERC20.getAddress(), provider);
  const iBGTToken = await MockERC20Factory.deploy(await protocol.getAddress(), "iBGT Token", "iBGT", 18);
  const iBGT = MockERC20__factory.connect(await iBGTToken.getAddress(), provider);

  const iBGT8Token = await MockERC20Factory.deploy(await protocol.getAddress(), "iBGT8 Token", "iBGT8", 8);
  const iBGT8 = MockERC20__factory.connect(await iBGT8Token.getAddress(), provider);

  const MockRebasableERC20Factory = await ethers.getContractFactory("MockRebasableERC20");
  const MockRebasableERC20 = await MockRebasableERC20Factory.deploy(await protocol.getAddress(),"Liquid staked Ether 2.0", "stETH");
  const stETH = MockRebasableERC20__factory.connect(await MockRebasableERC20.getAddress(), provider);

  const MockStakingPoolFactory = await ethers.getContractFactory("MockStakingPool");
  const MockStakingPool = await MockStakingPoolFactory.deploy(await protocol.getAddress(), await iBGT.getAddress());
  const stakingPool = MockStakingPool__factory.connect(await MockStakingPool.getAddress(), provider);

  const VaultCalculatorFactory = await ethers.getContractFactory("VaultCalculator");
  const VaultCalculator = await VaultCalculatorFactory.deploy();
  const vaultCalculator = VaultCalculator__factory.connect(await VaultCalculator.getAddress(), provider);

  const InfraredVaultFactory = await ethers.getContractFactory("InfraredVault", {
    libraries: {
      VaultCalculator: await vaultCalculator.getAddress(),
    }
  });
  // console.log(`Vault code size: ${VaultFactory.bytecode.length / 2} bytes. (max: ${maxContractSize} bytes)`);

  const iBGTVaultContract = await InfraredVaultFactory.deploy(
    await protocol.getAddress(), await settings.getAddress(), 
    await redeemPoolFactory.getAddress(),
    await bribesPoolFactory.getAddress(),
    await stakingPool.getAddress(),
    await iBGT.getAddress(), "Zoo piBGT", "piBGT"
  );
  const vault = Vault__factory.connect(await iBGTVaultContract.getAddress(), provider);
  let trans = await protocol.connect(Alice).addVault(await vault.getAddress());
  await trans.wait();

  const MockStakingPool8 = await MockStakingPoolFactory.deploy(await protocol.getAddress(), await iBGT8.getAddress());
  const stakingPool8 = MockStakingPool__factory.connect(await MockStakingPool8.getAddress(), provider);

  const iBGT8VaultContract = await InfraredVaultFactory.deploy(
    await protocol.getAddress(), await settings.getAddress(),
    await redeemPoolFactory.getAddress(),
    await bribesPoolFactory.getAddress(),
    await stakingPool8.getAddress(),
    await iBGT8.getAddress(), "Zoo piBGT8", "piBGT8"
  );
  const vault8 = Vault__factory.connect(await iBGT8VaultContract.getAddress(), provider);
  trans = await protocol.connect(Alice).addVault(await vault8.getAddress());
  await trans.wait();

  return { 
    Alice, Bob, Caro, Dave,
    protocol, settings, redeemPoolFactory, bribesPoolFactory, stakingPool, stakingPool8,
    iBGT, iBGT8, stETH, vaultCalculator, vault, vault8
  };
}

export function expandTo18Decimals(n: number) {
  return BigInt(n) * (10n ** 18n);
}

// ensure result is within .01%
export function expectNumberEquals(expected: number, actual: number) {
  const equals = absNum(expected - actual) <= absNum(expected) / 10000;
  if (!equals) {
    console.log(`Number does not equal. expected: ${expected.toString()}, actual: ${actual.toString()}`);
  }
  expect(equals).to.be.true;
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

export function absNum(n: number) {
  return n < 0 ? -n : n;
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

export const makeToken = async (protocol: string, name: string, symbol: string, decimals: number = 18) => {
  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const ERC20 = await MockERC20Factory.deploy(protocol, name, symbol, 18);
  const erc20 = MockERC20__factory.connect(await ERC20.getAddress(), provider);

  const [Alice] = await ethers.getSigners();
  await erc20.connect(Alice).setDecimals(decimals);
  return erc20
};

export async function expectedY(vault: Vault) {
  const epochId = await vault.currentEpochId(); 

  const epoch = await vault.epochInfoById(epochId);
  let deltaT = 0;
  if (epoch.startTime + epoch.duration >= await time.latest()) {
    // in current epoch
    deltaT = (await time.latest()) - Number(epoch.startTime);
  } 
  else {
    // in a new epoch
    deltaT = 0;
  }

  // Y = k0 / (X * (1 + ∆t / 86400)2)
  let decayPeriod = Number(await vault.paramValue(encodeBytes32String("D"))) / 30;
  let X = Number(await vault.epochNextSwapX(epochId));
  let k0 = Number(await vault.epochNextSwapK0(epochId));
  let Y = k0 / (X * (1 + deltaT / decayPeriod) * (1 + deltaT / decayPeriod));

  return Y;
}

export async function expectedInitSwapParams(vault: Vault, S: number) {
  const D = Number(await vault.paramValue(encodeBytes32String("D")));
  const APRi = Number(formatUnits(await vault.paramValue(encodeBytes32String("APRi")), SETTINGS_DECIMALS));

  const X = S;

  // Y0 = X * APRi * D / 86400 / 365
  const Y0 = X * APRi * D / 86400 / 365;

  // k0 = X * Y0
  const k0 = X * Y0; 

  console.log(`expectedInitSwapParams, D: ${D}, APRi: ${APRi}, S: ${S}, X: ${X}, Y0: ${Y0}, k0: ${k0}`);

  return { X, k0 };
}

export async function expectedSwapParamsOnDeposit(vault: Vault, m: number, decimals: number) {
  const epochId = await vault.currentEpochId(); 

  let X = Number(await vault.epochNextSwapX(epochId)) / (10 ** decimals);
  let k0 = Number(await vault.epochNextSwapK0(epochId)) / (10 ** (decimals + decimals + 10));

  let X_updated = X;

  // k'0 = ((X + m) / X)2 * k0
  let k0_updated = ((X + m) / X) * ((X + m) / X) * k0;

  return { X_updated, k0_updated };
}

export async function expectedCalcSwap(vault: Vault, n: number, decimals: number) {
  const epochId = await vault.currentEpochId();  // require epochId > 0

  let X = Number(await vault.epochNextSwapX(epochId)) / (10 ** decimals);
  let k0 = Number(await vault.epochNextSwapK0(epochId)) / (10 ** (decimals + decimals));

  const epoch = await vault.epochInfoById(epochId);
  let deltaT = 0;
  if (epoch.startTime + epoch.duration >= await time.latest()) {
    // in current epoch
    deltaT = (await time.latest()) - Number(epoch.startTime);
  } 
  else {
    // in a new epoch
    deltaT = 0;
  }
  console.log(`expectedCalcSwap, X: ${X}, k0: ${k0}, deltaT: ${deltaT}`);

  // X' = X * k0 / (k0 + X * n * (1 + ∆t / 86400)2)
  let decayPeriod = Number(await vault.paramValue(encodeBytes32String("D"))) / 30;
  let X_updated = X * k0 / (k0 + X * n * (1 + deltaT / decayPeriod) * (1 + deltaT / decayPeriod));

  // m = X - X'
  let m = X - X_updated;

  console.log(`expectedCalcSwap, X_updated: ${X_updated}, m: ${m}`);

  return { X_updated, m };
}
