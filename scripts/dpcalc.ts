import dotenv from "dotenv";
import { deployContract } from "./hutils";
import { BQuery__factory } from "../typechain";
import { ethers } from "hardhat";

dotenv.config();

async function main() {
  //   const [root] = await ethers.getSigners();
  const bqueryAddress = await deployContract("BQuery", []);
  const [deployer] = await ethers.getSigners();
  const bQuery = BQuery__factory.connect(bqueryAddress, deployer);
  await bQuery.setCrocQuery("0x8685CE9Db06D40CBa73e3d09e6868FE476B5dC89").then((tx) => tx.wait(2));
  const lps = ["0xd28d852cbcc68dcec922f6d5c7a8185dbaa104b7"];
  for (const lp of lps) {
    await bQuery.setLP(lp, true).then((tx) => tx.wait(2));
  }
  const vualt = '0x90e0A49726c2fF0fa6e4382446688AF883d10133';
  const current = await bQuery.queryBVault(vualt);
  console.info("bVault", current);
  for (let i = current.epochCount; i > 0n; i--) {
    console.info("epoch:", i, await bQuery.queryBVaultEpoch("0x90e0A49726c2fF0fa6e4382446688AF883d10133", i));
    console.info("epoch:", i, await bQuery.queryBVaultEpochUser("0x90e0A49726c2fF0fa6e4382446688AF883d10133", i, deployer.address));

  }

}

main().catch(console.error);