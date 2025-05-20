import { ethers } from "hardhat";
import { IInfrared__factory } from "../typechain";

async function main() {
  const [deployer] = await ethers.getSigners();

  // https://infrared.finance/docs/developers/contract-deployments
  const infraredAddress = "0xb71b3DaEA39012Fb0f2B14D2a9C86da9292fC126";

  // https://infrared.finance/docs/developers/smart-contract-apis/infrared
  const infrared = IInfrared__factory.connect(infraredAddress, deployer);

  // Kodiak Island WETH-WBERA
  const lp = "0x9659dc8c1565e0bd82627267e3b4eed1a377ebe6";  // => 0x33e53c508ecFBF6DB7B07AC3A36079fBfA919352

  // // BYUSD-HONEY
  // const lp = "0xde04c469ad658163e2a5e860a03a86b52f6fa8c8";

  // // USDC.e-HONEY
  // const lp = "0xf961a8f6d8c69e7321e78d254ecafbcc3a637621";

  // WBERA-WETH
  // const lp = "0xdd70a5ef7d8cfe5c5134b5f9874b09fb5ce812b4";

  // On bera-bartio, should output: 0x59945c5be54ff1d8deb0e8bc7f132f950da910a2
  // Which matches https://infrared.finance/docs/testnet/deployments
  const vault = await infrared.vaultRegistry(lp);

  console.info("infrared vault: ", vault);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
