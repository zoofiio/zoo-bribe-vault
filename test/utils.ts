import _ from 'lodash';
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  MockERC20__factory,
  ProtocolSettings__factory,
  MockRebasableERC20__factory,
  ZooProtocol__factory,
  Vault__factory,
  MockStakingPool__factory,
} from "../typechain";

const { provider } = ethers;

export const ONE_DAY_IN_SECS = 24 * 60 * 60;

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

  const VaultFactory = await ethers.getContractFactory("Vault");
  const iBGTVaultContract = await VaultFactory.deploy(
    await protocol.getAddress(), await settings.getAddress(), await stakingPool.getAddress(),
    await iBGT.getAddress(), "Zoo piBGT", "piBGT"
  );
  const iBGTVault = Vault__factory.connect(await iBGTVaultContract.getAddress(), provider);

  return { 
    Alice, Bob, Caro, Dave,
    protocol, settings, stakingPool,
    iBGT, stETH, iBGTVault
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
