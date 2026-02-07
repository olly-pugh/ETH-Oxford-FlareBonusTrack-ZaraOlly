/**
 * FlexDAO — Demo Flow (90-120s judge demo)
 *
 * Runs the full Web2→Web3 pipeline on a local Hardhat node:
 *
 *   1. Read flex_responses.json (simulated household data)
 *   2. Read fdc_attestations.json (FDC-attested carbon intensity)
 *   3. Submit flex events to FlexDAO, which verifies each against FDCShim
 *   4. Print reward balances and contract stats
 *
 * Pre-requisites (run in order):
 *   python3 backend/fetch_carbon.py
 *   python3 backend/simulate.py
 *   node backend/fdc_stub.js
 *   npx hardhat node                              (keep running)
 *   npx hardhat run scripts/deploy.js --network localhost
 *   node backend/fdc_to_contract_stub.js
 *   npx hardhat run scripts/demoFlow.js --network localhost
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "backend", "data");

async function main() {
  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║        FlexDAO — Live Demo Flow          ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // --- Load data ---
  const deployed = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "deployed.json"), "utf-8")
  );
  const flexData = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "flex_responses.json"), "utf-8")
  );
  const attestations = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "fdc_attestations.json"), "utf-8")
  );

  // --- Connect to contracts ---
  const [operator, ...participants] = await ethers.getSigners();

  const FlexDAO = await ethers.getContractFactory("FlexDAO");
  const dao = FlexDAO.attach(deployed.flexDAO);

  console.log(`FlexDAO    @ ${deployed.flexDAO}`);
  console.log(`FDCShim    @ ${deployed.fdcShim}`);
  console.log(`Operator   : ${operator.address}`);
  console.log(`Participants: ${participants.length} Hardhat accounts\n`);

  // --- Build attestation lookup ---
  const keyMap = {};
  for (const a of attestations) {
    keyMap[a.timestamp] = a;
  }

  // --- Process high-carbon flex events ---
  const highEvents = flexData.events.filter((e) => e.flex_requested && e.participants.length > 0);

  console.log(`High-carbon flex events to submit: ${highEvents.length}`);
  console.log("─".repeat(50));

  let submitted = 0;
  for (const event of highEvents) {
    const att = keyMap[event.from];
    if (!att) continue;

    // Map simulated household IDs to Hardhat signer addresses (round-robin)
    const flexParticipants = event.participants.map((p, idx) => ({
      participant: participants[idx % participants.length].address,
      shiftedKw: Math.round(p.shifted_kw * 1000), // convert to milliKw
    }));

    try {
      const tx = await dao.submitFlexEvent(att.key, flexParticipants);
      await tx.wait();
      submitted++;
      process.stdout.write(
        `  ✓ ${event.from}  intensity=${event.intensity_actual}  participants=${event.participants.length}  shifted=${event.aggregate_shifted_kw}kW\n`
      );
    } catch (err) {
      // Skip slots below threshold or already processed
      if (err.message.includes("below threshold") || err.message.includes("already processed")) {
        continue;
      }
      console.error(`  ✗ ${event.from}: ${err.message.slice(0, 80)}`);
    }
  }

  // --- Print results ---
  console.log("\n" + "═".repeat(50));
  console.log("CONTRACT STATS:");
  const stats = await dao.getStats();
  console.log(`  Events verified  : ${stats[0]}`);
  console.log(`  Rewards issued   : ${stats[1]} FLEX`);
  console.log(`  Intensity thresh : ${stats[2]} gCO2/kWh`);
  console.log(`  FDC attestations : ${stats[3]}`);

  // Show top 5 participant balances
  console.log("\nTOP PARTICIPANT BALANCES:");
  const balances = [];
  for (let i = 0; i < Math.min(participants.length, 19); i++) {
    const bal = await dao.balances(participants[i].address);
    if (bal > 0n) {
      balances.push({ address: participants[i].address, balance: bal });
    }
  }
  balances.sort((a, b) => (b.balance > a.balance ? 1 : -1));
  balances.slice(0, 5).forEach((b, i) => {
    console.log(`  ${i + 1}. ${b.address.slice(0, 10)}…  ${b.balance} FLEX`);
  });

  console.log("\n✓ Demo complete — FlexDAO verified real UK carbon data on-chain!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
