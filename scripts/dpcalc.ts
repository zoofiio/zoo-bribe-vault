import dotenv from "dotenv";
import { deployContract } from "./hutils";

dotenv.config();

async function main() {
  //   const [root] = await ethers.getSigners();
  await deployContract("CalcLiq", []);
}

main().catch(console.error);
