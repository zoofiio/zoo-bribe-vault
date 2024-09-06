import { ethers } from "hardhat";
import { Vault__factory } from "../typechain";
import { getJson } from "./hutils";

async function main() {
  const json = getJson();
  const vaults: string[] = Object.keys(json)
    .filter((item) => item.endsWith("_Vault"))
    .map((key) => json[key].address);
  console.info("vaults:", vaults);
  for (const vault of vaults) {
    const pToken = await Vault__factory.connect(vault, ethers.provider).pToken();
    console.info(vault, "=>", pToken);
  }
}
main();
