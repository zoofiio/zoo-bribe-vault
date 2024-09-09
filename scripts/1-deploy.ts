import * as _ from "lodash";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import dotenv from "dotenv";
import { ethers } from "hardhat";
import { deployContract, wait1Tx } from "./hutils";
import { MockERC20__factory, ProtocolSettings__factory, ZooProtocol__factory, MockStakingPool__factory, Vault__factory } from "../typechain";

dotenv.config();

const treasuryAddress = "0xC73ce0c5e473E68058298D9163296BebAC2b729C";

let deployer: SignerWithAddress;

const testers: any[] = [
  "0x956Cd653e87269b5984B8e1D2884E1C0b1b94442",
  "0xc97B447186c59A5Bb905cb193f15fC802eF3D543",
  "0x1851CbB368C7c49B997064086dA94dBAD90eB9b5",
];



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
   const isVault = await protocol.connect(deployer).isVault(vault)
   if(!isVault){
      await protocol.connect(deployer).addVault(vault).then(tx => tx.wait(1))
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

  // const iRedVaultAddress = await deployContract(
  //   "Vault",
  //   [protocolAddress, protocolSettingsAddress, stakingPoolAddress, iREDAddress, "Zoo piRED", "piRED"],
  //   "iRED_Vault",
  //   {
  //     libraries: {
  //       VaultCalculator: vaultCalculatorAddress,
  //     },
  //   }
  // );
  // await addVault(iRedVaultAddress)
  // console.log("Added iRED vault to protocol");

  // Deploy $HONEY-USDC-LP vault
  // https://bartio.beratrail.io/address/0xD69ADb6FB5fD6D06E6ceEc5405D95A37F96E3b96
  const honeyUsdcLPAddress = "0xD69ADb6FB5fD6D06E6ceEc5405D95A37F96E3b96";
  const honeyUsdcStakingPoolAddress = "0x675547750F4acdf64eD72e9426293f38d8138CA8";

  const honeyUsdcLPVaultAddress = await deployContract(
    "Vault",
    [protocolAddress, protocolSettingsAddress, honeyUsdcStakingPoolAddress, honeyUsdcLPAddress, "Zoo pHONEY-USDC-LP", "pHONEY-USDC"],
    "HONEY-USDC-LP_Vault",
    {
      libraries: {
        VaultCalculator: vaultCalculatorAddress,
      },
    }
  );
  console.info(
    "HONEY-USDC-LP_Vault pToken:", 
    await Vault__factory.connect(honeyUsdcLPVaultAddress, ethers.provider).pToken()
  );
  await addVault(honeyUsdcLPVaultAddress)
  console.log("Added honeyUsdcLP vault to protocol");


  // HONEY-WBERA
  const honeyWberaLpAddress = '0xd28d852cbcc68dcec922f6d5c7a8185dbaa104b7'
  const honeyWberaStakingPoolAddress = '0x5c5f9a838747fb83678ECe15D85005FD4F558237'
  const honeyWBeraLPVaultAddress1 = await deployContract(
    "Vault",
    [protocolAddress, protocolSettingsAddress, honeyWberaStakingPoolAddress, honeyWberaLpAddress, "Zoo pHONEY-WBERA-LP", "pHONEY-BERA"],
    "HONEY-WBERA-LP_1_Vault",
    {
      libraries: {
        VaultCalculator: vaultCalculatorAddress,
      },
    }
  );
  console.info(
    "HONEY-WBERA-LP_1_Vault pToken:", 
    await Vault__factory.connect(honeyWBeraLPVaultAddress1, ethers.provider).pToken()
  );
  await addVault(honeyWBeraLPVaultAddress1)
  console.log("Added honeyWberaLP vault1 to protocol");
  const honeyWBeraLPVaultAddress2 = await deployContract(
    "Vault",
    [protocolAddress, protocolSettingsAddress, honeyWberaStakingPoolAddress, honeyWberaLpAddress, "Zoo pHONEY-WBERA-LP", "pHONEY-BERA"],
    "HONEY-WBERA-LP_2_Vault",
    {
      libraries: {
        VaultCalculator: vaultCalculatorAddress,
      },
    }
  );
  console.info(
    "HONEY-WBERA-LP_1_Vault pToken:", 
    await Vault__factory.connect(honeyWBeraLPVaultAddress2, ethers.provider).pToken()
  );
  await addVault(honeyWBeraLPVaultAddress2)
  console.log("Added honeyWberaLP vault2 to protocol");

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
