const { ethers } = require("ethers");

// ===== CONFIG =====
const RPC_URL = "https://coston2-api.flare.network/ext/C/rpc";
const CONTRACT_REGISTRY_ADDRESS = "0xACc0bE44264b7Ca9d0bB543d3228c9A041Cc90F5";
// ==================

async function main() {
  // Read-only provider (no wallet needed)
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // Minimal ABI: only what we need
  const REGISTRY_ABI = [
    "function getFdcHub() view returns (address)"
  ];

  const registry = new ethers.Contract(
    CONTRACT_REGISTRY_ADDRESS,
    REGISTRY_ABI,
    provider
  );

  const fdcHubAddress = await registry.getFdcHub();

  console.log("✅ FDC Hub address (from registry):");
  console.log(fdcHubAddress);
}

main().catch(console.error);



