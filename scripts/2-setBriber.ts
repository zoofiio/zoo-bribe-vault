import { ethers } from "hardhat";
import { Vault__factory } from "../typechain";
import { wait1Tx } from "./hutils";

async function main() {
  const [deployer] = await ethers.getSigners();
  const vaults = [
    "0x686C72Aecf2D08410A8270D514B0Dc3Cc72e5288",
    "0xB0a0C11a77E67acBD161cc44743a1774f2C4Fff5",
    "0xF4396DEe48A44A2191ec5763Fc4b6E5aDE7e41e7",
    "0x90e0A49726c2fF0fa6e4382446688AF883d10133",
    "0x9700FEa232560E4048DD924623491926282125bE",
  ];
  const testers = ["0x956Cd653e87269b5984B8e1D2884E1C0b1b94442", "0xc97B447186c59A5Bb905cb193f15fC802eF3D543", "0x1851CbB368C7c49B997064086dA94dBAD90eB9b5"];

  for (const vault of vaults) {
    const bv = Vault__factory.connect(vault, deployer);
    for (const tester of testers) {
      const isBriber = await bv.isBriber(tester);
      if (!isBriber) {
        await bv.setBriber(tester, true).then(wait1Tx);
      }
      console.info(`${vault}: set Briber: ${tester}`);
    }
  }
}
main();
