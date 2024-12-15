import { ethers } from "hardhat";
import { IInfrared__factory } from "../typechain";

async function main() {
  const [deployer] = await ethers.getSigners();

  // https://infrared.finance/docs/testnet/deployments
  const infraredAddress = "0xe41779952f5485db5440452DFa43350556AA4673";

  // https://infrared.finance/docs/developers/smart-contract-apis/infrared
  const infrared = IInfrared__factory.connect(infraredAddress, deployer);

  // https://bartio.bex.berachain.com/pool/0xd28d852cbcc68dcec922f6d5c7a8185dbaa104b7
  const lpHoneyWbera = "0xd28d852cbcc68dcec922f6d5c7a8185dbaa104b7";

  // On bera-bartio, should output: 0x5c5f9a838747fb83678ECe15D85005FD4F558237
  // Which matches https://infrared.finance/docs/testnet/deployments
  const vaultHoneyWbera = await infrared.vaultRegistry(lpHoneyWbera);

  console.info("vaultHoneyWbera", vaultHoneyWbera);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
