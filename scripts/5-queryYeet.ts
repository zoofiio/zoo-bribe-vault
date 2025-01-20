import { ethers } from "hardhat";
import { IYeetTrifectaVault__factory } from "../typechain";

async function main() {
  const [deployer] = await ethers.getSigners();

  // https://bartio.beratrail.io/token/0x208008F377Ad00ac07A646A1c3eA6b70eB9Fc511
  const yeetTrifectaVaultAddress = "0x208008F377Ad00ac07A646A1c3eA6b70eB9Fc511";

  const yeetTrifectaVault = IYeetTrifectaVault__factory.connect(yeetTrifectaVaultAddress, deployer);

  // https://bartio.beratrail.io/address/0x0001513F4a1f86da0f02e647609E9E2c630B3a14
  const asset = await yeetTrifectaVault.asset();
  console.log(`Yeet Trifecta Asset: ${asset}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
