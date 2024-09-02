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
  
  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  // const MockERC20 = await MockERC20Factory.deploy("ERC20 Mock", "MockERC20");
  // const erc20 = MockERC20__factory.connect(await MockERC20.getAddress(), provider);
  const iBGTToken = await MockERC20Factory.deploy(await protocol.getAddress(), "iBGT Token", "iBGT");
  const iBGT = MockERC20__factory.connect(await iBGTToken.getAddress(), provider);

  const MockRebasableERC20Factory = await ethers.getContractFactory("MockRebasableERC20");
  const MockRebasableERC20 = await MockRebasableERC20Factory.deploy(await protocol.getAddress(),"Liquid staked Ether 2.0", "stETH");
  const stETH = MockRebasableERC20__factory.connect(await MockRebasableERC20.getAddress(), provider);

  const MockStakingPoolFactory = await ethers.getContractFactory("MockStakingPool");
  const MockStakingPool = await MockStakingPoolFactory.deploy(await protocol.getAddress(), await iBGT.getAddress());
  const stakingPool = MockStakingPool__factory.connect(await MockStakingPool.getAddress(), provider);

  const VaultCalculatorFactory = await ethers.getContractFactory("VaultCalculator");
  const VaultCalculator = await VaultCalculatorFactory.deploy();
  const vaultCalculator = VaultCalculator__factory.connect(await VaultCalculator.getAddress(), provider);

  const VaultFactory = await ethers.getContractFactory("Vault", {
    libraries: {
      VaultCalculator: await vaultCalculator.getAddress(),
    }
  });
  const iBGTVaultContract = await VaultFactory.deploy(
    await protocol.getAddress(), await settings.getAddress(), await stakingPool.getAddress(),
    await iBGT.getAddress(), "Zoo piBGT", "piBGT"
  );
  const vault = Vault__factory.connect(await iBGTVaultContract.getAddress(), provider);

  let trans = await protocol.connect(Alice).addVault(await vault.getAddress());
  await trans.wait();

  return { 
    Alice, Bob, Caro, Dave,
    protocol, settings, stakingPool,
    iBGT, stETH, vaultCalculator, vault
  };
}

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
  const ERC20 = await MockERC20Factory.deploy(protocol, name, symbol);
  const erc20 = MockERC20__factory.connect(await ERC20.getAddress(), provider);

  const [Alice] = await ethers.getSigners();
  await erc20.connect(Alice).setDecimals(decimals);
  return erc20
};

export interface SwapResultF0 {
  deltaT: number;
  D: number;
  T: number;
  t: number;
  t0: number;
  M: number;
  S: number;
  e1: number;
  e2: number;

  APRi: number;
  APRl: number;
  a: number;
  P_floor_scaled: number;
  P_scaled: number;
  A: number;
  B: number;
  C: number;
  X: number;
  Y: number;
}

export async function expectedSwapForYTokensF0(vault: Vault, assetAmount: number) {
  const result: SwapResultF0 = {
    deltaT: 0, D: 0, T: 0, t: 0, t0: 0, M: 0, S: 0, e1: 0, e2: 0,
    APRi: 0, APRl: 0, a: 0, P_floor_scaled: 0, P_scaled: 0,
    A: 0, B: 0, C: 0, X: 0, Y: 0,
  };

  const yTokenDecimals = 18;
  const epochId = await vault.currentEpochId();

  let firstEpochSwap = true;
  let epochLastSwapPriceScaled = 0;
  let epochEndTime = 0;

  // const D = ethers.formatUnits(await vault.paramValue("D"), SETTINGS_DECIMALS);
  // let D, M, S, t0, deltaT;
  result.D = Number(await vault.paramValue(encodeBytes32String("D")));
  console.log(`expectedSwapForYTokensF0, D: ${result.D}`);
  const epoch = await vault.epochInfoById(epochId);
  if (epoch.startTime + epoch.duration >= await time.latest()) {
    // in current epoch
    result.M = Number(formatUnits(await vault.yTokenTotalSupply(epochId), yTokenDecimals));
    result.S = Number(formatUnits(await vault.yTokenUserBalance(epochId, await vault.getAddress()), yTokenDecimals));
    result.t0 = Number(epoch.startTime);
    console.log(`expectedSwapForYTokensF0, current epoch, M: ${result.M}, S: ${result.S}, t0: ${result.t0}`);

    if (await vault.epochLastSwapTimestampF0(epochId) > 0) {
      result.deltaT = (await time.latest()) - Number(await vault.epochLastSwapTimestampF0(epochId));
      firstEpochSwap = false;
      epochLastSwapPriceScaled = Number(await vault.epochLastSwapPriceScaledF0(epochId));
    } else {
      result.deltaT = (await time.latest()) - Number(epoch.startTime);
    }
    epochEndTime = Number(epoch.startTime + epoch.duration);
    console.log(`expectedSwapForYTokensF0, current epoch, deltaT: ${result.deltaT}`);
  }
  else {
    // in a new epoch
    result.M = Number(formatUnits(await vault.yTokenUserBalance(epochId, await vault.getAddress()), yTokenDecimals));
    result.S = Number(formatUnits(await vault.yTokenUserBalance(epochId, await vault.getAddress()), yTokenDecimals));
    result.t0 = await time.latest();
    result.deltaT = 0;
    epochEndTime = await time.latest() + result.D;

    console.log(`expectedSwapForYTokensF0, new epoch, M: ${result.M}, S: ${result.S}, t0: ${result.t0}, deltaT: ${result.deltaT}`);
  }

  result.T = Number(await vault.paramValue(encodeBytes32String("T")));
  result.t = await time.latest();
  result.e1 = Number(await vault.paramValue(encodeBytes32String("e1")));
  result.e2 = Number(await vault.paramValue(encodeBytes32String("e2")));
  console.log(`expectedSwapForYTokensF0, T: ${result.T}, t: ${result.t}`);
  console.log(`expectedSwapForYTokensF0, e1: ${result.e1}, e2: ${result.e2}`);

  // let APRi, APRl, a;
  if (firstEpochSwap) {
    // a = APRi * D / 365
    result.APRi = Number(formatUnits(await vault.paramValue(encodeBytes32String("APRi")), SETTINGS_DECIMALS));
    result.a = result.APRi * result.D / (365 * ONE_DAY_IN_SECS);
    console.log(`expectedSwapForYTokensF0, first swap of epoch, APRi: ${result.APRi}, a: ${result.a}`);
  }
  else {
    // a = P / (1 + e1 * (M - S) / M)
    if (epochLastSwapPriceScaled <= 0) { console.log("Invalid last epoch swap price"); return -1; }
    result.a = epochLastSwapPriceScaled / (10 ** 28) / (
      1 + result.e1 * (result.M - result.S) / result.M
    );
    console.log(`expectedSwapForYTokensF0, not first swap of epoch, a: ${result.a}`);
  }

  // P(L(t)) = APRl * (ED - t) / 365
  result.APRl = Number(formatUnits(await vault.paramValue(encodeBytes32String("APRl")), SETTINGS_DECIMALS));
  const P_floor_scaled = result.APRl * (epochEndTime - result.t) / (365 * ONE_DAY_IN_SECS);
  console.log(`expectedSwapForYTokensF0, APRl: ${result.APRl}, P_floor_scaled: ${P_floor_scaled}`);

  /**
   * P(S,t) = a * (
   *    (1 + e1 * (M - S) / M) - deltaT / (
   *      T * (1 + (M - S) / (e2 * M))
   *    )
   * )
   * 
   */
  const P_scaled = result.a * (
    (1 + result.e1 * (result.M - result.S) / result.M) - result.deltaT / (
      result.T * (1 + (result.M - result.S) / (result.e2 * result.M))
    )
  );
  console.log(`expectedSwapForYTokensF0, P_scaled: ${P_scaled}`);

  const useFloorPrice = P_scaled < P_floor_scaled;
  if (useFloorPrice) {
    /**
     * a1 = P_floor / (
     *    (1 + e1 * (M - S) / M) 
     * )
     */
    result.a = P_floor_scaled / (
      (1 + result.e1 * (result.M - result.S) / result.M) 
    );
    console.log(`expectedSwapForYTokensF0, useFloorPrice, a: ${result.a}`);
  }

  // A = a / M
  result.A = result.a / result.M;  // scale: 10 ** (10 + 18)
  console.log(`expectedSwapForYTokensF0, A: ${result.A}`);

  /**
   * B = a * deltaT / (
   *    T * (1 + (M - S) / (e2 * M))
   * ) - a - e1 * a
   */
  result.B = result.a * result.deltaT / (
    result.T * (1 + (result.M - result.S) / (result.e2 * result.M))
  ) - result.a - result.e1 * result.a;
  console.log(`expectedSwapForYTokensF0, B: ${result.B}`);

  // C = X
  result.C = assetAmount;
  console.log(`expectedSwapForYTokensF0, C: ${result.C}`);

  /**
   * Y(X) = (B + sqrt(B * B + 4 * A * C)) / (2 * A)
   */
  result.Y = (result.B + Math.sqrt(result.B * result.B + 4 * result.A * result.C)) / (2 * result.A);
  console.log(`expectedSwapForYTokensF0, Y: ${result.Y}`);

  return result.Y;
}
