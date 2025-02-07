import { ethers } from "hardhat";
import { IInfrared__factory } from "../typechain";

async function main() {
  const [deployer] = await ethers.getSigners();

  // https://infrared.finance/docs/developers/contract-deployments
  const infraredAddress = "0xb71b3DaEA39012Fb0f2B14D2a9C86da9292fC126";

  // https://infrared.finance/docs/developers/smart-contract-apis/infrared
  const infrared = IInfrared__factory.connect(infraredAddress, deployer);

  const lp = "0xf961a8f6d8c69e7321e78d254ecafbcc3a637621";

  // On bera-bartio, should output: 0x59945c5be54ff1d8deb0e8bc7f132f950da910a2
  // Which matches https://infrared.finance/docs/testnet/deployments
  const vault = await infrared.vaultRegistry(lp);

  console.info("infrared vault: ", vault);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
