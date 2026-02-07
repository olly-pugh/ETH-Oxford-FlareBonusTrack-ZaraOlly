// probe_registry_v6.js — robust version using Buffer for bytes32
const ethers = require('ethers');

const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const REG_ADDR = "0xACc0bE44264b7Ca9d0bB543d3228c9A041Cc90F5";

// simple bytes32 helper: pad or truncate utf8 bytes to 32 bytes
function formatBytes32StringNode(name) {
  const b = Buffer.alloc(32);
  const nb = Buffer.from(name, 'utf8');
  if (nb.length >= 32) {
    nb.copy(b, 0, 0, 32);
  } else {
    nb.copy(b, 0);
    // remaining bytes are already zeros
  }
  return '0x' + b.toString('hex');
}

async function tryCall(provider, abi, fnName, args = []) {
  try {
    const c = new ethers.Contract(REG_ADDR, [abi], provider);
    const res = await c[fnName](...args);
    console.log(`OK  -> ${fnName} returned:`, res);
    return true;
  } catch (e) {
    console.log(`NO  -> ${fnName} failed: ${e.message.split('\\n')[0]}`);
    return false;
  }
}

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC);

  // sanity
  const code = await provider.getCode(REG_ADDR);
  console.log('Contract code length chars:', code.length);

  // try direct getter
  console.log('\nTrying direct getFdcHub()...');
  await tryCall(provider, "function getFdcHub() view returns (address)", "getFdcHub");

  // try common bytes32 getters
  const nameCandidates = [
    "FdcHub", "FDC_HUB", "fdcHub", "FdcHubV1", "FdcHubAddress",
    "Fdc_Hub", "FDC_HUB_ADDRESS", "FDC_HUB_ADDR", "FdcHub_1", "FdcHubMain"
  ];

  console.log('\nTrying getContract(bytes32) and getContractAddress(bytes32) with common names...');
  for (let name of nameCandidates) {
    const b32 = formatBytes32StringNode(name);

    // try getContract
    try {
      const reg1 = new ethers.Contract(REG_ADDR, ["function getContract(bytes32) view returns (address)"], provider);
      const res1 = await reg1.getContract(b32);
      if (res1 && res1 !== ethers.ZeroAddress) {
        console.log(`FOUND: getContract("${name}") -> ${res1}`);
        return;
      } else {
        console.log(`TRY: getContract("${name}") -> zero/empty`);
      }
    } catch (e) {
      console.log(`TRY FAIL getContract("${name}"): ${e.message.split('\\n')[0]}`);
    }

    // try getContractAddress
    try {
      const reg2 = new ethers.Contract(REG_ADDR, ["function getContractAddress(bytes32) view returns (address)"], provider);
      const res2 = await reg2.getContractAddress(b32);
      if (res2 && res2 !== ethers.ZeroAddress) {
        console.log(`FOUND: getContractAddress("${name}") -> ${res2}`);
        return;
      } else {
        console.log(`TRY: getContractAddress("${name}") -> zero/empty`);
      }
    } catch (e) {
      console.log(`TRY FAIL getContractAddress("${name}"): ${e.message.split('\\n')[0]}`);
    }
  }

  // other common patterns
  console.log('\nTrying other possible getters...');
  const otherTries = [
    { abi: "function getContractByName(bytes32) view returns (address)", fn: "getContractByName" },
    { abi: "function getAddress(bytes32) view returns (address)", fn: "getAddress" },
    { abi: "function get(bytes32) view returns (address)", fn: "get" },
    { abi: "function getContractAddressByName(bytes32) view returns (address)", fn: "getContractAddressByName" }
  ];

  for (let t of otherTries) {
    try {
      const reg = new ethers.Contract(REG_ADDR, [t.abi], provider);
      const res = await reg[t.fn](formatBytes32StringNode("FdcHub"));
      if (res && res !== ethers.ZeroAddress) {
        console.log(`FOUND: ${t.fn} -> ${res}`);
        return;
      } else {
        console.log(`TRY: ${t.fn} -> zero/empty`);
      }
    } catch (e) {
      console.log(`NO   : ${t.fn} -> ${e.message.split('\\n')[0]}`);
    }
  }

  console.log('\nNo address found by probe. Next step: open the Coston2 explorer for the registry address and copy the ABI JSON here.');
})();

