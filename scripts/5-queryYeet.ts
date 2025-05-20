import { ethers } from "hardhat";
import { IYeetTrifectaVault__factory } from "../typechain";

async function main() {
  const [deployer] = await ethers.getSigners();

  // https://bartio.beratrail.io/token/0x208008F377Ad00ac07A646A1c3eA6b70eB9Fc511
  // https://berascan.com/address/0xd3908da797ecec7ea0fbfbacf3118302e215556c
  const yeetTrifectaVaultAddress = "0xd3908da797ecec7ea0fbfbacf3118302e215556c";

  const yeetTrifectaVault = IYeetTrifectaVault__factory.connect(yeetTrifectaVaultAddress, deployer);

  // https://bartio.beratrail.io/address/0x0001513F4a1f86da0f02e647609E9E2c630B3a14
  // https://berascan.com/token/0xec8ba456b4e009408d0776cde8b91f8717d13fa1
  const asset = await yeetTrifectaVault.asset();
  console.log(`Yeet Trifecta Asset: ${asset}`);

  const maxFeeBps = await yeetTrifectaVault.maxAllowedFeeBps();
  console.log(`Yeet Trifecta maxAllowedFeeBps: ${maxFeeBps}`);

  const feeBps = await yeetTrifectaVault.exitFeeBasisPoints();
  console.log(`Yeet Trifecta exitFeeBasisPoints: ${feeBps}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
