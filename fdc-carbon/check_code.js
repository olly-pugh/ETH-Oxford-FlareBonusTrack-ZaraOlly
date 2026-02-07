// check_code.js — ethers v6 compatible
const ethers = require("ethers");

(async () => {
  try {
    const RPC = "https://coston2-api.flare.network/ext/C/rpc";
    const REG_ADDR = "0xACc0bE44264b7Ca9d0bB543d3228c9A041Cc90F5";

    // ethers v6: provider is here
    const provider = new ethers.JsonRpcProvider(RPC);

    const code = await provider.getCode(REG_ADDR);

    console.log("bytecode length (chars):", code.length);
    console.log("bytecode starts with:", code.slice(0, 10));
  } catch (err) {
    console.error("Error:", err);
  }
})();

