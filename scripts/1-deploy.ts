import * as _ from "lodash";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import dotenv from "dotenv";
import { ethers } from "hardhat";
import { deployContract, wait1Tx } from "./hutils";
import { 
  ProtocolSettings__factory, ZooProtocol__factory,
  RedeemPoolFactory__factory, BribesPoolFactory__factory, VaultCalculator__factory,
  Vault__factory, ERC4626BribeVault__factory
} from "../typechain";

dotenv.config();

const treasuryAddress = "0x54c56e149f6d655aa784678057d1f96612b0cf1a";
let deployer: SignerWithAddress;

async function main() {
  const signers = await ethers.getSigners();
  deployer = signers[0];
  const nonce = await deployer.getNonce();
  console.log(`Deployer: ${deployer.address}, nonce: ${nonce}`);

  const bqueryAddress = await deployContract("BQuery", []);
  const bquery = await ethers.getContractAt("BQuery", bqueryAddress);

  const protocolAddress = await deployContract("ZooProtocol", []);
  const protocol = ZooProtocol__factory.connect(protocolAddress, deployer);

  const protocolSettingsAddress = await deployContract("ProtocolSettings", [protocolAddress, treasuryAddress]);
  const settings = ProtocolSettings__factory.connect(protocolSettingsAddress, deployer);

  const redeemPoolFactoryAddress = await deployContract("RedeemPoolFactory", [protocolAddress]);
  const redeemPoolFactory = RedeemPoolFactory__factory.connect(redeemPoolFactoryAddress, deployer);

  const bribesPoolFactoryAddress = await deployContract("BribesPoolFactory", [protocolAddress]);
  const bribesPoolFactory = BribesPoolFactory__factory.connect(bribesPoolFactoryAddress, deployer);

  const vaultCalculatorAddress = await deployContract("VaultCalculator", []);
  const vaultCalculator = VaultCalculator__factory.connect(vaultCalculatorAddress, deployer);

  async function addVault(vault: string) {
    const isVault = await protocol.connect(deployer).isVault(vault);
    if (!isVault) {
      await protocol.connect(deployer).addVault(vault).then(wait1Tx);
    }
  }

  const deployVault = async (asset: string, pool: string, name: string, pTokenSymbol: string) => {
    const vaultAddress = await deployContract(
      "InfraredBribeVaultV2",
      [protocolAddress, protocolSettingsAddress, redeemPoolFactoryAddress, bribesPoolFactoryAddress, pool, asset, `Zoo p${name}`, pTokenSymbol],
      `${name}_InfraredBribeVaultV2`,
      {
        libraries: {
          VaultCalculator: vaultCalculatorAddress,
        },
      }
    );
    console.info(`${name}_VaultV2 pToken:`, await Vault__factory.connect(vaultAddress, ethers.provider).pToken());
    await addVault(vaultAddress);
    console.log(`Added vault ${name} to protocol`);
  };

  const deployYeetVault = async (asset: string, yeetTrifectaVault: string, pTokenName: string, pTokenSymbol: string) => {
    const vaultAddress = await deployContract(
      "ERC4626BribeVault",
      [protocolAddress, protocolSettingsAddress, redeemPoolFactoryAddress, bribesPoolFactoryAddress, yeetTrifectaVault, asset, pTokenName, pTokenSymbol],
      `ERC4626BribeVault`,
      {
        libraries: {
          VaultCalculator: vaultCalculatorAddress,
        },
      }
    );
    console.info(`$ERC4626BribeVault pToken:`, await ERC4626BribeVault__factory.connect(vaultAddress, ethers.provider).pToken());
    await addVault(vaultAddress);
    console.log(`Added ERC4626BribeVault to protocol`);
  };

  // USDC.e-HONEY
  // await deployVault("0xf961a8f6d8c69e7321e78d254ecafbcc3a637621", "0x1419515d3703d8F2cc72Fa6A341685E4f8e7e8e1", "USDC.e-HONEY", "pUSDCeHONEY");

  // WBERA-WETH
  // await deployVault("0xdd70a5ef7d8cfe5c5134b5f9874b09fb5ce812b4", "0x0dF14916796854d899576CBde69a35bAFb923c22", "WBERA-WETH", "pWBERAWETH");

  // HONEY-BYUSD
  await deployVault("0xde04c469ad658163e2a5e860a03a86b52f6fa8c8", "0xbbb228b0d7d83f86e23a5ef3b1007d0100581613", "HONEY-BYUSD", "pHONEYBYUSD");

  // Bera bArtio Testnet: Deploy $HONEY-USDC-LP vault
  // await deployVault("0xD69ADb6FB5fD6D06E6ceEc5405D95A37F96E3b96", "0x675547750F4acdf64eD72e9426293f38d8138CA8", "HONEY-USDC-LP");

  // await deployYeetVault("0xec8ba456b4e009408d0776cde8b91f8717d13fa1", "0xd3908da797ecec7ea0fbfbacf3118302e215556c", "Zoo pBERAYEET", "pBERAYEET");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
