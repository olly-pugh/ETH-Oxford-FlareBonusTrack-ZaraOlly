#!/usr/bin/env node
/**
 * FlexDAO — FDC-to-Contract Stub
 *
 * Simulates the relay step: reads fdc_attestations.json and "submits" each
 * attestation to the on-chain FDCShim contract.
 *
 * In production this would be an on-chain transaction calling
 *   FDCShim.submitAttestation(bytes32 key, uint256 intensity)
 * signed by the FDC relay.
 *
 * Here we simulate it by:
 *   1. Connecting to a local Hardhat node (http://127.0.0.1:8545)
 *   2. Calling FDCShim.submitAttestation() for each record
 *   3. Reading back a sample to prove round-trip
 *
 * Usage:
 *   npx hardhat node                      (terminal 1)
 *   npx hardhat run scripts/deploy.js     (terminal 2)
 *   node backend/fdc_to_contract_stub.js  (terminal 2)
 *
 * The deploy script must write deployed addresses to backend/data/deployed.json
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const DATA_DIR = path.join(__dirname, "data");
const ATTESTATION_FILE = path.join(DATA_DIR, "fdc_attestations.json");
const DEPLOYED_FILE = path.join(DATA_DIR, "deployed.json");

// Minimal ABI for the calls we need
const FDC_SHIM_ABI = [
  "function submitAttestation(bytes32 key, uint256 intensity) external",
  "function getIntensity(bytes32 key) external view returns (uint256)",
  "function attestationCount() external view returns (uint256)",
];

async function run() {
  // --- Load data ---
  if (!fs.existsSync(ATTESTATION_FILE)) {
    console.error("ERROR: fdc_attestations.json not found. Run fdc_stub.js first.");
    process.exit(1);
  }
  if (!fs.existsSync(DEPLOYED_FILE)) {
    console.error("ERROR: deployed.json not found. Deploy contracts first.");
    process.exit(1);
  }

  const attestations = JSON.parse(fs.readFileSync(ATTESTATION_FILE, "utf-8"));
  const deployed = JSON.parse(fs.readFileSync(DEPLOYED_FILE, "utf-8"));

  // --- Connect to local Hardhat node ---
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const signer = await provider.getSigner(0); // Hardhat account #0
  const shim = new ethers.Contract(deployed.fdcShim, FDC_SHIM_ABI, signer);

  console.log(`Relaying ${attestations.length} attestations to FDCShim @ ${deployed.fdcShim} …`);

  // Submit in batches of 50 for speed
  const BATCH = 50;
  for (let i = 0; i < attestations.length; i += BATCH) {
    const batch = attestations.slice(i, i + BATCH);
    const txPromises = batch.map((a) =>
      shim.submitAttestation(a.key, a.intensity)
    );
    const txs = await Promise.all(txPromises);
    await Promise.all(txs.map((tx) => tx.wait()));
    process.stdout.write(`  submitted ${Math.min(i + BATCH, attestations.length)} / ${attestations.length}\r`);
  }

  const count = await shim.attestationCount();
  console.log(`\n✓ ${count} attestations stored on-chain`);

  // Verify round-trip for first entry
  const sample = attestations[0];
  const stored = await shim.getIntensity(sample.key);
  console.log(`\nRound-trip check:`);
  console.log(`  key       = ${sample.key.slice(0, 18)}…`);
  console.log(`  expected  = ${sample.intensity}`);
  console.log(`  on-chain  = ${stored.toString()}`);
  console.log(`  match     = ${stored.toString() === String(sample.intensity) ? "✓ YES" : "✗ NO"}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
