import * as _ from 'lodash';
import dotenv from "dotenv";
import { ethers } from "hardhat";
import {
  ZooProtocol__factory,
  Vault__factory,
  ERC20__factory,
  ProtocolSettings__factory,
  PtyPoolBuyLow__factory,
  PtyPoolSellHigh__factory,
  MarginToken__factory
} from '../typechain';

dotenv.config();

const nativeTokenAddress = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export enum VaultType {
  Volatile = 0,
  Stable = 1
}

const provider = new ethers.JsonRpcProvider(`https://sepolia.infura.io/v3/${process.env.INFURA_KEY}`);
const protocolAddress = '0xB023b91AC9d0F64B1E5CB9e9D3fa8a5bA384A191';
const protocolSettingsAddress = '0x6bD10c168fC9290D3744660B450be1157200a680';

async function main() {
  const protocol = ZooProtocol__factory.connect(protocolAddress, provider);
  const protocolSettings = ProtocolSettings__factory.connect(protocolSettingsAddress, provider);
  console.log(`ProtocolSettings: ${await protocolSettings.getAddress()}`);
  console.log(`ZooProtocol: ${await protocol.getAddress()}`);
  console.log(`  $zUSD Token: ${await protocol.usdToken()}`);
  console.log(`  Treasury: ${await protocolSettings.treasury()}`);

  const assetTokens = await protocol.assetTokens();
  console.log(`Vaults:`);
  for (let i = 0; i < assetTokens.length; i++) {
    const assetToken = assetTokens[i];
    const isETH = assetToken == nativeTokenAddress;
    const assetTokenERC20 = ERC20__factory.connect(assetToken, provider);
    const assetSymbol = isETH ? 'ETH' : await assetTokenERC20.symbol();
    const vaultAddress = (await protocol.getVaultAddresses(assetToken))[0];
    const vault = Vault__factory.connect(vaultAddress, provider);
    const marginToken = MarginToken__factory.connect(await vault.marginToken(), provider);

    console.log(`  $${assetSymbol}`);
    console.log(`    Vault Address: ${vaultAddress}`);
    console.log(`    Asset Token (${await getTokenSymbol(assetToken)}): ${assetToken}`);
    console.log(`    PriceFeed Address: ${await vault.priceFeed()}`);
    console.log(`    $${await marginToken.symbol()} Token: ${await marginToken.getAddress()}`);
    console.log(`       Vault: ${await marginToken.vault()}`);
    if (await vault.vaultType() == BigInt(VaultType.Volatile)) {
      const ptyPoolBuyLow = PtyPoolBuyLow__factory.connect(await vault.ptyPoolBuyLow(), provider);
      const ptyPoolSellHigh = PtyPoolSellHigh__factory.connect(await vault.ptyPoolSellHigh(), provider);
      console.log(`    Pty Pool Below AARS: ${await ptyPoolBuyLow.getAddress()}`);
      console.log(`       Staking Token (${await getTokenSymbol(await ptyPoolBuyLow.stakingToken())}): ${await ptyPoolBuyLow.stakingToken()}`);
      console.log(`       Target Token (${await getTokenSymbol(await ptyPoolBuyLow.targetToken())}): ${await ptyPoolBuyLow.targetToken()}`);
      console.log(`       Staking Yield Token (${await getTokenSymbol(await ptyPoolBuyLow.stakingYieldsToken())}): ${await ptyPoolBuyLow.stakingYieldsToken()}`);
      console.log(`       Matching Yield Token (${await getTokenSymbol(await ptyPoolBuyLow.matchingYieldsToken())}): ${await ptyPoolBuyLow.matchingYieldsToken()}`);
      console.log(`    Pty Pool Above AARU: ${await ptyPoolSellHigh.getAddress()}`);
      console.log(`       Staking Token (${await getTokenSymbol(await ptyPoolSellHigh.stakingToken())}): ${await ptyPoolSellHigh.stakingToken()}`);
      console.log(`       Target Token (${await getTokenSymbol(await ptyPoolSellHigh.targetToken())}): ${await ptyPoolSellHigh.targetToken()}`);
      console.log(`       Staking Yield Token (${await getTokenSymbol(await ptyPoolSellHigh.stakingYieldsToken())}): ${await ptyPoolSellHigh.stakingYieldsToken()}`);
      console.log(`       Matching Yield Token (${await getTokenSymbol(await ptyPoolSellHigh.matchingYieldsToken())}): ${await ptyPoolSellHigh.matchingYieldsToken()}`);
    }
  }
}

async function getTokenSymbol(tokenAddr: string) {
  if (tokenAddr == nativeTokenAddress) {
    return '$ETH';
  }
  const erc20 = ERC20__factory.connect(tokenAddr, provider);
  return `$${await erc20.symbol()}`;
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});