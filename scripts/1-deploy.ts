import * as _ from "lodash";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { FactoryOptions } from "@nomicfoundation/hardhat-ethers/types";
import dotenv from "dotenv";
import { ethers } from "hardhat";
import { deployContract } from "./hutils";

dotenv.config();

const treasuryAddress = '0xC73ce0c5e473E68058298D9163296BebAC2b729C';
const ibgtPriceFeed = '';

// https://docs.infrared.finance/testnet/deployments#contracts
const vaults = [
  {
    assetsToken: "0x46eFC86F0D7455F135CC9df501673739d513E982",
    assetsSymbol: "iBGT",
    marginTokenName: "Zoo xiBGT",
    marginTokenSymbol: "xiBGT",
    chainlinkPriceFeed: ibgtPriceFeed,
  },
];

const stableVaults: any[] = [
  
];
let deployer: SignerWithAddress;

const testers: any[] = [

];


async function deployValut(
  vault: (typeof vaults)[0],
  settingsAddress: string,
  protocalAddress: string,
  factoryOptions?: FactoryOptions
) {
  const priceFeedName = vault.assetsSymbol + "_PriceFeed";

  let priceFeedAddress;
  if (vault.chainlinkPriceFeed) {
    priceFeedAddress = await deployContract("CommonPriceFeed", [vault.chainlinkPriceFeed], priceFeedName);
  } 
  else {
    priceFeedAddress = await deployContract("MockPriceFeed", [], priceFeedName);
    const mockPriceFeed = await ethers.getContractAt("MockPriceFeed", priceFeedAddress);
    for (let i = 0; i < _.size(testers); i++) {
      const tester = testers[i];
      const isTester = await mockPriceFeed.isTester(tester);
      if (isTester) {
        console.log(`${priceFeedName}: ${tester} is already a tester`);
      } else {
        const trans = await mockPriceFeed.connect(deployer).setTester(tester, true);
        await trans.wait();
        console.log(`${priceFeedName}: ${tester} is now a tester`);
      }
    }
  }

  const marginTokenAddress = await deployContract(
    "MarginToken",
    [
      protocalAddress,
      settingsAddress,
      vault.marginTokenName,
      vault.marginTokenSymbol,
    ],
    `${vault.marginTokenSymbol}`
  );

  const marginToken = await ethers.getContractAt("MarginToken", marginTokenAddress);
  const vaultAddress = await deployContract(
    "Vault",
    [
      protocalAddress,
      settingsAddress,
      vault.assetsToken,
      marginTokenAddress,
      priceFeedAddress,
    ],
    vault.assetsSymbol + "_Vault",
    factoryOptions
  );
  const Vault = await ethers.getContractAt("Vault", vaultAddress);
  // below buy pool
  const belowPoolAddress = await deployContract(
    "PtyPoolBuyLow",
    [
      protocalAddress,
      settingsAddress,
      vaultAddress,
      marginTokenAddress,
      vault.assetsToken,
    ],
    `${vault.assetsSymbol}_PtyPoolBuyLow`
  );
  // above sell pool
  const abovePoolAddress = await deployContract(
    "PtyPoolSellHigh",
    [
      protocalAddress,
      settingsAddress,
      vaultAddress,
      vault.assetsToken,
      marginTokenAddress,
    ],
    `${vault.assetsSymbol}_PtyPoolSellHigh`
  );

  // setPtyPools
  let trans = await Vault.connect(deployer).setPtyPools(belowPoolAddress, abovePoolAddress);
  await trans.wait();
  console.log(`Set ${vault.assetsSymbol} Vault PtyPools`);

  // marginToken setVault
  trans = await marginToken.connect(deployer).setVault(vaultAddress);
  await trans.wait();
  console.log(`Connect margin token to ${vault.assetsSymbol} Vault`);

  return vaultAddress;
}

async function deployStableValut(
  vault: (typeof stableVaults)[0],
  settingsAddress: string,
  protocalAddress: string,
  factoryOptions?: FactoryOptions
) {
  const priceFeedName = vault.assetsSymbol + "_PriceFeed";

  let priceFeedAddress;
  if (vault.chainlinkPriceFeed) {
    priceFeedAddress = await deployContract(
      "CommonPriceFeed",
      [vault.chainlinkPriceFeed],
      priceFeedName
    );
  }
  else {
    priceFeedAddress = await deployContract("MockPriceFeed", [], priceFeedName);
    const mockPriceFeed = await ethers.getContractAt("MockPriceFeed", priceFeedAddress);
    for (let i = 0; i < _.size(testers); i++) {
      const tester = testers[i];
      const isTester = await mockPriceFeed.isTester(tester);
      if (isTester) {
        console.log(`${priceFeedName}: ${tester} is already a tester`);
      } else {
        const trans = await mockPriceFeed.connect(deployer).setTester(tester, true);
        await trans.wait();
        console.log(`${priceFeedName}: ${tester} is now a tester`);
      }
    }
  }

  const marginTokenAddress = await deployContract(
    "MarginToken",
    [
      protocalAddress,
      settingsAddress,
      vault.marginTokenName,
      vault.marginTokenSymbol,
    ],
    `${vault.marginTokenSymbol}`
  );
  const marginToken = await ethers.getContractAt("MarginToken", marginTokenAddress);
  const vaultAddress = await deployContract(
    "StableVault",
    [
      protocalAddress,
      settingsAddress,
      vault.assetsToken,
      marginTokenAddress,
      priceFeedAddress,
    ],
    vault.assetsSymbol + "_StableVault",
    factoryOptions
  );

  let trans = await marginToken.connect(deployer).setVault(vaultAddress);
  await trans.wait();
  console.log(`Connect margin token to ${vault.assetsSymbol} Vault`);

  return vaultAddress;
}

async function main() {
  const signers = await ethers.getSigners();
  deployer = signers[0];
  const nonce = await deployer.getNonce();
  console.log("nonce:", nonce);

  // Deploy Protocol
  const protocalAddress = await deployContract("ZooProtocol", []);
  const protocol = await ethers.getContractAt("ZooProtocol", protocalAddress);

  //  Deploy Protocol core contracts
  const protocolSettingsAddress = await deployContract("ProtocolSettings", [protocalAddress, treasuryAddress]);
  const settings = await ethers.getContractAt("ProtocolSettings", protocolSettingsAddress);

  // Deploy Usd
  const usdAddress = await deployContract("Usd", [protocalAddress, await settings.getAddress()]);
  const Usd = await ethers.getContractAt("Usd", usdAddress);

  // initProtocal Usd
  if (!(await protocol.initialized())) {
    await protocol
      .connect(deployer)
      .initialize(await Usd.getAddress())
      .then((tx) => tx.wait(1));
  }
  console.log(`Initialized ZooProtocol with $zUSD token`);

  const vaultCalculatorAddress = await deployContract("VaultCalculator", []);
  for (const vc of vaults) {
    const ethVaultAddress = await deployValut(vc, protocolSettingsAddress, protocalAddress, {
      libraries: {
        VaultCalculator: vaultCalculatorAddress,
      },
    });
    // protocal Add Vault
    if (!(await protocol.isVault(ethVaultAddress)))
      await protocol
        .connect(deployer)
        .addVault(ethVaultAddress)
        .then((tx) => tx.wait(1));
  }

  const stableVaultCalculatorAddress = await deployContract("StableVaultCalculator", []);
  for (const vc of stableVaults) {
    const usdbVaultAddress = await deployStableValut(vc, protocolSettingsAddress, protocalAddress, {
      libraries: {
        StableVaultCalculator: stableVaultCalculatorAddress,
      },
    });
    // protocal Add Vault
    if (!(await protocol.isVault(usdbVaultAddress)))
      await protocol
        .connect(deployer)
        .addVault(usdbVaultAddress)
        .then((tx) => tx.wait(1));

    // set Y to 2.0%
    await settings.connect(deployer).updateVaultParamValue(usdbVaultAddress, ethers.encodeBytes32String("Y"), 2 * 10 ** 8);
    console.log(`Set USDB vault Y to 2.0%`);

    // set AARS to 115%
    await settings.connect(deployer).updateVaultParamValue(usdbVaultAddress, ethers.encodeBytes32String("AARS"), 115 * 10 ** 8);
    console.log(`Set USDB vault AARS to 115%`);
  }
  await deployContract("VaultQuery", [], "VaultQuery", {
    libraries: {
      VaultCalculator: vaultCalculatorAddress,
      StableVaultCalculator: stableVaultCalculatorAddress,
    },
  });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
