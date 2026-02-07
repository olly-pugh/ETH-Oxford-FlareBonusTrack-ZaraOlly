#!/usr/bin/env node
/**
 * FlexDAO — FDC Stub (Flare Data Connector simulation)
 *
 * In production, the Flare Data Connector fetches Web2 data via attestation
 * providers, who independently verify the data and submit Merkle-root proofs
 * on-chain. This stub simulates that flow:
 *
 *   1. Reads backend/data/carbon_week.json  (the "Web2 source")
 *   2. For each half-hour slot, creates an attestation record:
 *        key    = keccak256(timestamp)
 *        value  = actual carbon intensity (uint)
 *   3. Writes backend/data/fdc_attestations.json
 *
 * WHAT IS SIMULATED:
 *   - The multi-provider voting / Merkle-tree construction
 *   - The on-chain relay transaction
 *
 * WHAT IS REAL:
 *   - The carbon intensity data (fetched live from the UK Grid API)
 *   - The keccak256 key derivation (same algo as production)
 */

const fs = require("fs");
const path = require("path");
const { keccak256, toUtf8Bytes } = require("ethers");

const DATA_DIR = path.join(__dirname, "data");
const CARBON_FILE = path.join(DATA_DIR, "carbon_week.json");
const OUT_FILE = path.join(DATA_DIR, "fdc_attestations.json");

function run() {
  if (!fs.existsSync(CARBON_FILE)) {
    console.error("ERROR: carbon_week.json not found. Run fetch_carbon.py first.");
    process.exit(1);
  }

  const carbon = JSON.parse(fs.readFileSync(CARBON_FILE, "utf-8"));
  console.log(`FDC Stub — processing ${carbon.length} slots …`);

  const attestations = carbon.map((slot) => {
    const timestamp = slot.from; // ISO string
    const key = keccak256(toUtf8Bytes(timestamp));
    const actual =
      slot.intensity.actual ?? slot.intensity.forecast ?? 0;

    return {
      timestamp,
      key, // bytes32 oracle key
      intensity: actual, // uint256 value to store on-chain
      index: slot.intensity.index || "unknown",
    };
  });

  fs.writeFileSync(OUT_FILE, JSON.stringify(attestations, null, 2));
  console.log(`✓ Wrote ${attestations.length} attestations → ${OUT_FILE}`);

  // Print first 2
  console.log("\nSample attestations:");
  attestations.slice(0, 2).forEach((a) => {
    console.log(`  ${a.timestamp}  intensity=${a.intensity}  key=${a.key.slice(0, 18)}…`);
  });
}

run();
