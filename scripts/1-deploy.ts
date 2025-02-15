import * as _ from "lodash";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import dotenv from "dotenv";
import { ethers } from "hardhat";
import { deployContract, wait1Tx } from "./hutils";
import { MockERC20__factory, ProtocolSettings__factory, ZooProtocol__factory, Vault__factory, ERC4626BribeVault__factory } from "../typechain";

dotenv.config();

const treasuryAddress = "0x54c56e149f6d655aa784678057d1f96612b0cf1a";

let deployer: SignerWithAddress;

// const testers: any[] = ["0x956Cd653e87269b5984B8e1D2884E1C0b1b94442", "0xc97B447186c59A5Bb905cb193f15fC802eF3D543", "0x1851CbB368C7c49B997064086dA94dBAD90eB9b5"];

async function main() {
  const signers = await ethers.getSigners();
  deployer = signers[0];
  const nonce = await deployer.getNonce();
  console.log("nonce:", nonce);

  // const protocolAddress = await deployContract("ZooProtocol", []);
  const protocolAddress = "0xc0fA386aE92f18A783476d09121291A1972C30Dc";
  const protocol = ZooProtocol__factory.connect(protocolAddress, deployer);

  // const protocolSettingsAddress = await deployContract("ProtocolSettings", [protocolAddress, treasuryAddress]);
  const protocolSettingsAddress = "0x8c6E434Bb1C51728BdCc250255c1F654471d85eB";
  const settings = ProtocolSettings__factory.connect(protocolSettingsAddress, deployer);

  // add Vault to protocol
  async function addVault(vault: string) {
    const isVault = await protocol.connect(deployer).isVault(vault);
    if (!isVault) {
      await protocol.connect(deployer).addVault(vault).then(wait1Tx);
    }
  }

  // Deploy mocked iRED
  // const iREDAddress = await deployContract("MockERC20", [protocolAddress, "Mocked iRED Token", "iRED"]);
  // const iRED = MockERC20__factory.connect(iREDAddress, deployer);
  // for (let i = 0; i < _.size(testers); i++) {
  //   const isTester = iRED.connect(deployer).isTester(testers[i]);
  //   if (!isTester) {
  //     const trans = await iRED.connect(deployer).setTester(testers[i], true);
  //     await trans.wait();
  //   }
  //   console.log(`${await iRED.symbol()}: ${testers[i]} is now a tester`);
  // }

  // Deploy mocked iRED staking pool
  // const stakingPoolAddress = await deployContract("MockStakingPool", [protocolAddress, iREDAddress]);
  // const stakingPool = MockStakingPool__factory.connect(stakingPoolAddress, deployer);

  // const vaultCalculatorAddress = await deployContract("VaultCalculator", []);
  // const redeemPoolFactoryAddress = await deployContract("RedeemPoolFactory", [protocolAddress]);
  // const bribesPoolFactoryAddress = await deployContract("BribesPoolFactory", [protocolAddress]);

  const vaultCalculatorAddress = "0x38d913835FA8115B60665d902F05b0Cd772377Fe";

  // const redeemPoolFactoryAddress = "0xF6F4a88ffD26fb14da4cFf997Ca773b06E3b2db3";
  const redeemPoolFactoryAddress = await deployContract("RedeemPoolFactory", [protocolAddress]);

  const bribesPoolFactoryAddress = "0x550b031acbc56B309A8ef28914959115f6a97202";

  // const bQueryAddress = await deployContract("BQuery", []);

  const deployVault = async (asset: string, pool: string, name: string) => {
    const vaultAddress = await deployContract(
      "InfraredBribeVault",
      [protocolAddress, protocolSettingsAddress, redeemPoolFactoryAddress, bribesPoolFactoryAddress, pool, asset, `Zoo p${name}`, `p${name.slice(0, 10)}`],
      `${name}_Vault`,
      {
        libraries: {
          VaultCalculator: vaultCalculatorAddress,
        },
      }
    );
    console.info(`${name}_Vault pToken:`, await Vault__factory.connect(vaultAddress, ethers.provider).pToken());
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

  // HONEY-USDC.e
  // await deployVault("0xf961a8f6d8c69e7321e78d254ecafbcc3a637621", "0x59945c5be54ff1d8deb0e8bc7f132f950da910a2", "HONEY-USDC.e");

  // Deploy $HONEY-USDC-LP vault
  // await deployVault("0xD69ADb6FB5fD6D06E6ceEc5405D95A37F96E3b96", "0x675547750F4acdf64eD72e9426293f38d8138CA8", "HONEY-USDC-LP", 1);
  
  // HONEY-WBERA
  // await deployVault("0xd28d852cbcc68dcec922f6d5c7a8185dbaa104b7", "0x5c5f9a838747fb83678ECe15D85005FD4F558237", "HONEY-WBERA-LP", 1);
  // await deployVault("0xd28d852cbcc68dcec922f6d5c7a8185dbaa104b7", "0x5c5f9a838747fb83678ECe15D85005FD4F558237", "HONEY-WBERA-LP", 2);

  // await deployYeetVault("0x0001513F4a1f86da0f02e647609E9E2c630B3a14", "0x208008F377Ad00ac07A646A1c3eA6b70eB9Fc511", "Zoo pBERAYEET", "pBERAYEET");

  await deployYeetVault("0xec8ba456b4e009408d0776cde8b91f8717d13fa1", "0xd3908da797ecec7ea0fbfbacf3118302e215556c", "Zoo pBERAYEET", "pBERAYEET");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
