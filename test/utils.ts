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
  const iBGTToken = await MockERC20Factory.deploy("iBGT Token", "iBGT");
  const iBGT = MockERC20__factory.connect(await iBGTToken.getAddress(), provider);

  const MockRebasableERC20Factory = await ethers.getContractFactory("MockRebasableERC20");
  const MockRebasableERC20 = await MockRebasableERC20Factory.deploy("Liquid staked Ether 2.0", "stETH");
  const stETH = MockRebasableERC20__factory.connect(await MockRebasableERC20.getAddress(), provider);

  const MockStakingPoolFactory = await ethers.getContractFactory("MockStakingPool");
  const MockStakingPool = await MockStakingPoolFactory.deploy(await protocol.owner(), await iBGT.getAddress());
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
  const iBGTVault = Vault__factory.connect(await iBGTVaultContract.getAddress(), provider);

  let trans = await protocol.connect(Alice).addVault(await iBGTVault.getAddress());
  await trans.wait();

  return { 
    Alice, Bob, Caro, Dave,
    protocol, settings, stakingPool,
    iBGT, stETH, vaultCalculator, iBGTVault
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

export const makeToken = async (name: string, symbol: string, decimals: number = 18) => {
  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const ERC20 = await MockERC20Factory.deploy(name, symbol);
  const erc20 = MockERC20__factory.connect(await ERC20.getAddress(), provider);

  const [Alice] = await ethers.getSigners();
  await erc20.connect(Alice).setDecimals(decimals);
  return erc20
};

export async function expectedSwapForYTokens(vault: Vault, assetAmount: number) {
  // const SCALE = 10 ** 18;
  const yTokenDecimals = 18;
  const epochId = await vault.currentEpochId();

  let firstEpochSwap = true;
  let epochLastSwapPriceScaled = 0;
  let epochEndTime = 0;

  // const D = ethers.formatUnits(await vault.paramValue("D"), SETTINGS_DECIMALS);
  let D, M, S, t0, deltaT;
  D = Number(await vault.paramValue(encodeBytes32String("D")));
  console.log(`expectedSwapForYTokens, D: ${D}`);
  const epoch = await vault.epochInfoById(epochId);
  if (epoch.startTime + epoch.duration >= await time.latest()) {
    // in current epoch
    M = Number(formatUnits(await vault.yTokenTotalSupply(epochId), yTokenDecimals));
    S = Number(formatUnits(await vault.yTokenUserBalance(epochId, await vault.getAddress()), yTokenDecimals));
    t0 = epoch.startTime;
    console.log(`expectedSwapForYTokens, M: ${M}, S: ${S}, t0: ${t0}`);

    if (await vault.epochLastSwapTimestamp(epochId) > 0) {
      deltaT = (await time.latest()) - Number(await vault.epochLastSwapTimestamp(epochId));
      firstEpochSwap = false;
      epochLastSwapPriceScaled = Number(await vault.epochLastSwapPriceScaled(epochId));
    } else {
      deltaT = (await time.latest()) - Number(epoch.startTime);
    }
    epochEndTime = Number(epoch.startTime + epoch.duration);
  }
  else {
    // in a new epoch
    M = Number(formatUnits(await vault.yTokenUserBalance(epochId, await vault.getAddress()), yTokenDecimals));
    S = Number(formatUnits(await vault.yTokenUserBalance(epochId, await vault.getAddress()), yTokenDecimals));
    t0 = await time.latest();
    deltaT = 0;
    epochEndTime = await time.latest() + D;

    console.log(`expectedSwapForYTokens, new epoch, M: ${M}, S: ${S}, t0: ${t0}, deltaT: ${deltaT}`);
  }

  const T = Number(await vault.paramValue(encodeBytes32String("T")));
  const t = await time.latest();
  const e1 = Number(await vault.paramValue(encodeBytes32String("e1")));
  const e2 = Number(await vault.paramValue(encodeBytes32String("e2")));
  console.log(`expectedSwapForYTokens, T: ${T}, t: ${t}`);
  console.log(`expectedSwapForYTokens, e1: ${e1}, e2: ${e2}`);

  let APRi, APRl, a;
  if (firstEpochSwap) {
    // a = APRi * D / 365
    APRi = Number(formatUnits(await vault.paramValue(encodeBytes32String("APRi")), SETTINGS_DECIMALS));
    a = APRi * D / (365 * ONE_DAY_IN_SECS);
    console.log(`expectedSwapForYTokens, first swap of epoch, APRi: ${APRi}, a: ${a}`);
  }
  else {
    // a = P / (1 + e1 * (M - S) / M)
    if (epochLastSwapPriceScaled <= 0) { console.log("Invalid last epoch swap price"); return -1; }
    a = epochLastSwapPriceScaled / (
      1 + e1 * (M - S) / M
    );
    console.log(`expectedSwapForYTokens, not first swap of epoch, a: ${a}`);
  }

  // P(L(t)) = APRl * (D - t) / 365
  APRl = Number(formatUnits(await vault.paramValue(encodeBytes32String("APRl")), SETTINGS_DECIMALS));
  const P_floor_scaled = APRl * (D - deltaT) / (365 * ONE_DAY_IN_SECS);
  console.log(`expectedSwapForYTokens, APRl: ${APRl}, P_floor_scaled: ${P_floor_scaled}`);

  /**
   * P(S,t) = a * (
   *    (1 + e1 * (M - S) / M) - deltaT / (
   *      T * (1 + (M - S) / (e2 * M))
   *    )
   * )
   * 
   */
  const P_scaled = a * (
    (1 + e1 * (M - S) / M) - deltaT / (
      T * (1 + (M - S) / (e2 * M))
    )
  );
  console.log(`expectedSwapForYTokens, P_scaled: ${P_scaled}`);

  const useFloorPrice = P_scaled < P_floor_scaled;
  if (useFloorPrice) {
    /**
     * a1 = P_floor / (
     *    (1 + e1 * (M - S) / M) 
     * )
     */
    a = P_floor_scaled / (
      (1 + e1 * (M - S) / M) 
    );
    console.log(`expectedSwapForYTokens, useFloorPrice, a: ${a}`);
  }

  // A = a / M
  const A = a / M;  // scale: 10 ** (10 + 18)
  console.log(`expectedSwapForYTokens, A: ${A}`);

  /**
   * B = a * deltaT / (
   *    T * (1 + (M - S) / (e2 * M))
   * ) - a - e1 * a
   */
  const B = a * deltaT / (
    T * (1 + (M - S) / (e2 * M))
  ) - a - e1 * a;
  console.log(`expectedSwapForYTokens, B: ${B}`);

  // C = X
  const C = assetAmount;
  console.log(`expectedSwapForYTokens, C: ${C}`);

  /**
   * Y(X) = (B + sqrt(B * B + 4 * A * C)) / (2 * A)
   */
  const Y = (B + Math.sqrt(B * B + 4 * A * C)) / (2 * A);
  console.log(`expectedSwapForYTokens, Y: ${Y}`);

  return Y;
}
