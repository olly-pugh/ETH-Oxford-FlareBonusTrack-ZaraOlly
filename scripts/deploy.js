/**
 * FlexDAO — Deploy script (Hardhat)
 *
 * Deploys FDCShim and FlexDAO to the local Hardhat network.
 * Writes addresses to backend/data/deployed.json for other scripts to consume.
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // 1. Deploy FDCShim
  const FDCShim = await ethers.getContractFactory("FDCShim");
  const shim = await FDCShim.deploy();
  await shim.waitForDeployment();
  const shimAddr = await shim.getAddress();
  console.log("FDCShim deployed to:", shimAddr);

  // 2. Deploy FlexDAO (threshold = 150 gCO2/kWh)
  const FlexDAO = await ethers.getContractFactory("FlexDAO");
  const dao = await FlexDAO.deploy(shimAddr, 150);
  await dao.waitForDeployment();
  const daoAddr = await dao.getAddress();
  console.log("FlexDAO  deployed to:", daoAddr);

  // Write addresses
  const deployed = {
    fdcShim: shimAddr,
    flexDAO: daoAddr,
    deployer: deployer.address,
    network: "localhost",
    timestamp: new Date().toISOString(),
  };
  const outPath = path.join(__dirname, "..", "backend", "data", "deployed.json");
  fs.writeFileSync(outPath, JSON.stringify(deployed, null, 2));
  console.log(`\n✓ Addresses written to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
