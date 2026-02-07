// list_deployed_contracts.js
const ethers = require('ethers');

// === CONFIG ===
const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const REG_ADDR = "0xACc0bE44264b7Ca9d0bB543d3228c9A041Cc90F5";
// max entries to try (safety)
const MAX_TRIES = 500;
// ==============

// ABI snippet for the relevant function from the ABI you pasted
const ABI = [
  "function allDeployedContracts(uint256) view returns (bytes32 contractType, address contractAddress, address owner, address deployer, uint256 addedTS, string notes)"
];

function bytes32ToString(b32) {
  if (!b32) return "";
  // remove 0x and trailing zeros
  const hex = b32.startsWith("0x") ? b32.slice(2) : b32;
  // convert hex to buffer, then to utf8, trim trailing nulls
  const buf = Buffer.from(hex, 'hex');
  const s = buf.toString('utf8').replace(/\0/g, '');
  return s;
}

(async () => {
  try {
    const provider = new ethers.JsonRpcProvider(RPC);
    const registry = new ethers.Contract(REG_ADDR, ABI, provider);

    console.log("Reading up to", MAX_TRIES, "entries from allDeployedContracts(index) ...");

    for (let i = 0; i < MAX_TRIES; i++) {
      try {
        const res = await registry.allDeployedContracts(i);
        // res is an array-like object: [contractType, contractAddress, owner, deployer, addedTS, notes]
        const contractType = res.contractType ?? res[0];
        const contractAddress = res.contractAddress ?? res[1];
        const owner = res.owner ?? res[2];
        const deployer = res.deployer ?? res[3];
        const addedTS = res.addedTS ?? res[4];
        const notes = res.notes ?? res[5] ?? "";

        const ct = bytes32ToString(contractType);
        console.log(`\n[${i}] type='${ct}' | addr=${contractAddress} | owner=${owner} | deployer=${deployer} | added=${addedTS}`);
        if (notes && notes.length > 0) console.log("     notes:", notes);

        // quick match detection for FDC-ish names
        const lower = ct.toLowerCase();
        if (lower.includes("fdc") || lower.includes("flare") || lower.includes("data") || lower.includes("connector") || lower.includes("fdchub") || lower.includes("fdc_hub") || lower.includes("fired")) {
          console.log("     >>> Candidate match (looks like FDC/FdcHub) <<<");
        }
      } catch (err) {
        const m = (err && err.message) ? err.message : String(err);
        // If it's an out-of-range revert, we stop; otherwise print the error and continue
        if (m.toLowerCase().includes("revert") || m.toLowerCase().includes("execution reverted") || m.toLowerCase().includes("invalid opcode") || m.toLowerCase().includes("out of range")) {
          console.log(`\nStopped at index ${i}: read reverted or out-of-range (likely end of list).`);
          break;
        } else {
          console.log(`\nIndex ${i} -> call failed: ${m}`);
          // continue trying next indexes or break if it's serious
        }
      }
    }
    console.log("\nDone scanning registry entries.");
  } catch (e) {
    console.error("Fatal error:", e);
  }
})();

