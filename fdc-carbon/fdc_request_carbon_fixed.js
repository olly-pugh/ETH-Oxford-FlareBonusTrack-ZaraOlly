// fdc_request_carbon_fixed.js
// Node >=16, npm install node-fetch ethers
const fetch = globalThis.fetch;
const crypto = require('crypto');
const fs = require('fs');
const { ethers } = require('ethers');

/* ===== CONFIG - REPLACE THESE BEFORE RUNNING ===== */
const RPC = "https://coston2-api.flare.network/ext/C/rpc"; // Flare Coston2 RPC endpoint
const PRIVATE_KEY = "659e79e52fadbf7af89cd7d2959f295de9ba388c4818ad5f2f889ce835606df4"; // NEW key, not the leaked one
const FDC_HUB_ADDRESS = "0x48aC463d7975828989331F4De43341627b9c5f1D"; // your known FDC hub address
const API_URL = "https://api.carbonintensity.org.uk/intensity/2026-01-31T00:00Z/2026-02-07T00:00Z";
const JQ = '.data | map({t: .from, carbon_gCO2_per_kWh: .intensity.forecast})';
const FEE_WEI = ethers.parseEther("0.01"); // adjust as needed
/* Verifier settings - REPLACE with actual testnet verifier info */
const VERIFIER_BASE = "https://fdc-verifiers-testnet.flare.network"; // testnet verifier base
const VERIFIER_API_KEY = "REPLACE_WITH_VERIFIER_API_KEY";
/* ================================================== */

async function prepareAbiEncodedRequest(mic) {
  // Build the request body matching verifier swagger for JsonApi prepareRequest
  const payload = {
    attestationType: "0x4a736f6e41706900000000000000000000000000000000000000000000000000", // "JsonApi" padded hex
    sourceId: "0x0000000000000000000000000000000000000000000000000000000000000000",
    requestBody: {
      url: API_URL,
      jq: JQ,
      expectedResponseHash: mic,
      emissionTimestamp: Math.floor(Date.now() / 1000).toString()
    }
  };

  const res = await fetch(`${VERIFIER_BASE}/verifier/jsonapi/prepareRequest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': VERIFIER_API_KEY
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Verifier prepareRequest failed: ${JSON.stringify(data)}`);
  if (!data.abiEncodedRequest) throw new Error(`Verifier did not return abiEncodedRequest: ${JSON.stringify(data)}`);
  return data.abiEncodedRequest; // hex string starting with 0x
}

async function main() {
  // 0) read exact bytes and compute MIC
  if (!fs.existsSync('api_response.json')) {
    console.error("api_response.json not found in working dir. Run curl to save exact API response first.");
    process.exit(1);
  }
  const body = fs.readFileSync('api_response.json', 'utf8');
  const mic = '0x' + crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  console.log("MIC computed from saved file:", mic);

  // 1) prepare abiEncodedRequest via verifier
  console.log("Calling verifier prepareRequest to get abiEncodedRequest...");
  const abiEncodedRequest = await prepareAbiEncodedRequest(mic);
  console.log("Received abiEncodedRequest (truncated):", abiEncodedRequest.slice(0,120) + '...');

  // 2) submit to FDC hub
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const fdcHub = new ethers.Contract(FDC_HUB_ADDRESS, ["function requestAttestation(bytes abiEncodedRequest) payable"], wallet);

  console.log("Submitting requestAttestation to FDC hub...");
  const tx = await fdcHub.requestAttestation(abiEncodedRequest, { value: FEE_WEI });
  console.log("tx sent:", tx.hash);
  const receipt = await tx.wait();
  console.log("tx mined in block:", receipt.blockNumber, "blockHash:", receipt.blockHash);
  // Save tx info for later
  fs.writeFileSync('attestation_tx.json', JSON.stringify({ txHash: tx.hash, blockNumber: receipt.blockNumber }, null, 2));
  console.log("Saved attestation_tx.json - next: compute roundId and fetch proof from DA layer once the round finalises.");
}

main().catch(err => {
  console.error("Error:", err && err.message ? err.message : err);
  process.exit(1);
});

