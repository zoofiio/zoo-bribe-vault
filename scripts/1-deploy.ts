import * as _ from "lodash";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import dotenv from "dotenv";
import { ethers } from "hardhat";
import { deployContract, wait1Tx } from "./hutils";
import { MockERC20__factory, ProtocolSettings__factory, ZooProtocol__factory, MockStakingPool__factory, Vault__factory } from "../typechain";

dotenv.config();

const treasuryAddress = "0xC73ce0c5e473E68058298D9163296BebAC2b729C";

let deployer: SignerWithAddress;

const testers: any[] = ["0x956Cd653e87269b5984B8e1D2884E1C0b1b94442", "0xc97B447186c59A5Bb905cb193f15fC802eF3D543", "0x1851CbB368C7c49B997064086dA94dBAD90eB9b5"];

async function main() {
  const signers = await ethers.getSigners();
  deployer = signers[0];
  const nonce = await deployer.getNonce();
  console.log("nonce:", nonce);

  const protocolAddress = await deployContract("ZooProtocol", []);
  const protocol = ZooProtocol__factory.connect(await protocolAddress, deployer);

  const protocolSettingsAddress = await deployContract("ProtocolSettings", [protocolAddress, treasuryAddress]);
  const settings = ProtocolSettings__factory.connect(await protocolSettingsAddress, deployer);
  // add Vault to protocol
  async function addVault(vault: string) {
    const isVault = await protocol.connect(deployer).isVault(vault);
    if (!isVault) {
      await protocol
        .connect(deployer)
        .addVault(vault)
        .then((tx) => tx.wait(1));
    }
  }

  // Deploy mocked iRED
  const iREDAddress = await deployContract("MockERC20", [protocolAddress, "Mocked iRED Token", "iRED"]);
  const iRED = MockERC20__factory.connect(iREDAddress, deployer);
  for (let i = 0; i < _.size(testers); i++) {
    const isTester = iRED.connect(deployer).isTester(testers[i]);
    if (!isTester) {
      const trans = await iRED.connect(deployer).setTester(testers[i], true);
      await trans.wait();
    }
    console.log(`${await iRED.symbol()}: ${testers[i]} is now a tester`);
  }

  // Deploy mocked iRED staking pool
  // const stakingPoolAddress = await deployContract("MockStakingPool", [protocolAddress, iREDAddress]);
  // const stakingPool = MockStakingPool__factory.connect(stakingPoolAddress, deployer);

  const vaultCalculatorAddress = await deployContract("VaultCalculator", []);
  const redeemPoolFactoryAddress = await deployContract("RedeemPoolFactory", [protocolAddress]);

  const deployVault = async (asset: string, pool: string, name: string, index: number = 1) => {
    const vaultAddress = await deployContract(
      "Vault",
      [protocolAddress, protocolSettingsAddress, redeemPoolFactoryAddress, pool, asset, `Zoo p${name}`, `p${name.slice(0, 10)}`],
      `${name}_${index}_Vault`,
      {
        libraries: {
          VaultCalculator: vaultCalculatorAddress,
        },
      }
    );
    console.info(`${name}_${index}_Vault pToken:`, await Vault__factory.connect(vaultAddress, ethers.provider).pToken());
    await addVault(vaultAddress);
    console.log(`Added vault ${name}_${index} to protocol`);
  };

  // Deploy $HONEY-USDC-LP vault
  // await deployVault("0xD69ADb6FB5fD6D06E6ceEc5405D95A37F96E3b96", "0x675547750F4acdf64eD72e9426293f38d8138CA8", "HONEY-USDC-LP", 1);
  // HONEY-WBERA
  await deployVault("0xd28d852cbcc68dcec922f6d5c7a8185dbaa104b7", "0x5c5f9a838747fb83678ECe15D85005FD4F558237", "HONEY-WBERA-LP", 1);
  await deployVault("0xd28d852cbcc68dcec922f6d5c7a8185dbaa104b7", "0x5c5f9a838747fb83678ECe15D85005FD4F558237", "HONEY-WBERA-LP", 2);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
