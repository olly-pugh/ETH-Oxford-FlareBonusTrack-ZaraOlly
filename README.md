# FlexDAO

**Electricity Demand-flexibility verification and carbon-aware incentives, powered by Flare's Data Connector (FDC).**

Built at ETH Oxford 2026 - Attempting Flare's BONUS TRACK: "Show innovation by utilizing real world data in an on chain application"

---

## Use of Flare's Enshrined Data Protocols

**FlexDAO uses Flare's [Data Connector (FDC)](https://docs.flare.network/tech/fdc/) — specifically the `Web2Json` attestation type — as its trust anchor.** No reward can be issued without a verified FDC attestation. This is not a mock or stub: we have a live attestation and reward execution on Coston2.

### How it works

1. **Fetch** — Pulls 7 days of half-hourly carbon intensity from the UK National Grid API (real Web2 data)
2. **Attest** — Submits a `Web2Json` attestation request to the FDC Hub on Coston2, paying the request fee. The Flare validator set attests the API response and produces a Merkle proof via the Data Availability layer.
3. **Verify** — Calls `IFdcVerification.verifyWeb2Json()` on-chain to confirm the Merkle proof is valid. Also validates: 12+ block confirmations, payload hash (SHA-256 MIC), and timestamp range.
4. **Reward** — Only after verification passes, `RewardExecutor.executeReward()` records the reward on-chain with replay protection (one execution per attestation tx hash).

### Live on-chain evidence (Coston2, Chain ID 114)

| Step | Transaction | Block |
|------|-------------|-------|
| FDC attestation request | [`0x345fdb...2fcf`](https://coston2-explorer.flare.network/tx/0x345fdb1257ea41d1746af39dadfa9201c4902658450fe3e8d9b6bfd5384f2fcf) | 26,998,119 |
| Reward execution | [`0x3f1d17...af7f`](https://coston2-explorer.flare.network/tx/0x3f1d172f9b4cdf1c436f223dc8af7ebc0b6a4552d4295ccd5c0480d939fcaf7f) | 27,000,149 |
| RewardExecutor deploy | [`0xf7c243...b215`](https://coston2-explorer.flare.network/tx/0xf7c2434bd63d2764af45cc97f1162b0f6125934711fcde6c93ced9cdb381b215) | — |

**Contracts:**
- FDC Hub: [`0x48aC463d7975828989331F4De43341627b9c5f1D`](https://coston2-explorer.flare.network/address/0x48aC463d7975828989331F4De43341627b9c5f1D)
- FDC Verification: [`0x906507E0B64bcD494Db73bd0459d1C667e14B933`](https://coston2-explorer.flare.network/address/0x906507E0B64bcD494Db73bd0459d1C667e14B933)
- RewardExecutor: [`0x4a24DE38a2958f895e62c2E9b8D87054220101e0`](https://coston2-explorer.flare.network/address/0x4a24DE38a2958f895e62c2E9b8D87054220101e0)

### FDC pipeline detail

```
UK National Grid API (Web2)
        │
        │  GET /intensity/2026-01-31T00:00Z/2026-02-07T00:00Z
        ▼
┌─────────────────────────────────────────┐
│  1. REQUEST ATTESTATION                 │
│  FdcHub.requestAttestation() on Coston2 │
│  Type: Web2Json  │  Source: PublicWeb2  │
│  JQ: .data | tostring                  │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│  2. FETCH MERKLE PROOF                  │
│  Poll DA layer for voting round proof   │
│  (ctn2-data-availability.flare.network) │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│  3. ON-CHAIN VERIFICATION               │
│  IFdcVerification.verifyWeb2Json()      │
│  Returns: true (Merkle proof valid)     │
│  + 12 confirmations + MIC + timestamp   │
└──────────────────┬──────────────────────┘
                   ▼
┌─────────────────────────────────────────┐
│  4. REWARD EXECUTION                    │
│  RewardExecutor.executeReward()         │
│  Emits RewardExecuted event on-chain    │
│  Replay protection per attestation      │
└─────────────────────────────────────────┘
```

---

## What it does

FlexDAO brings real-world energy data on-chain to verify and reward household demand-flexibility:

- **Real carbon data** from the UK National Grid API is attested via Flare FDC — no party can fabricate or alter it after attestation.
- **25 households** are modelled with comfort-constrained flexibility (EV, heat pump, battery, appliances).
- **Carbon-proportional rewards**: FLEX tokens scale with actual carbon impact — `reward = (kWh shifted) × (intensity delta) / 1000`. Shifting during higher-intensity windows earns more.
- **On-chain audit trail**: every reward is recorded with replay protection, linking attestation tx, payload hash, participant, and shifted load.

## Why comfort constraints matter

A naive demand-response model would simply cut all load during high-carbon periods. This is unrealistic and unacceptable to real households:

- **You can't turn off the lights or stop cooking dinner.** Evening peak demand (17:00–20:00) is dominated by inflexible loads — lighting, cooking, heating. Our model explicitly protects these.
- **Flexibility comes from specific assets.** EV charging can shift overnight. Heat pumps can pre-heat. Dishwashers can delay. Batteries can discharge. Our simulation assigns each household a real appliance mix and only shifts load from those assets.
- **People have limits.** Each household has a maximum daily shift fraction (20–40% of energy) and a maximum shift duration (2–4 hours/day). These cap the contribution even for willing participants.
- **Shifted energy must go somewhere.** When load is curtailed during a high-carbon window, the same energy is re-added during a low-carbon window (overnight or midday). Total daily consumption is conserved — this is load *shifting*, not load *shedding*.

This matters for judges because **flat demand reduction models are a well-known failure mode in DSR research**. Real DSR programmes (e.g. Octopus Agile, National Grid ESO) face exactly these constraints. Our simulation reflects them.

## How it maps to real hardware

| Simulated asset | Real-world equivalent | Typical flexibility |
|---|---|---|
| EV charging | Tesla/BYD home charger | 2–4 hours shift, 3–7 kW |
| Heat pump slack | Air/ground source HP with thermal store | 1–2 hour pre-heat window |
| Battery | Tesla Powerwall / GivEnergy | Charge/discharge on signal |
| Dishwasher/laundry | Smart appliance with delay-start | 1–3 hour delay |

The simulation generates realistic UK "duck curve" demand profiles and splits each household's load into inflexible (cooking, lighting) and flexible (EV, HP, battery) components.

## What is real vs simulated

| Component | Status |
|---|---|
| UK carbon intensity data | **Real** — live API call to carbonintensity.org.uk |
| FDC attestation | **Real** — `Web2Json` attestation on Coston2, verified via `verifyWeb2Json()` |
| Merkle proof verification | **Real** — on-chain `IFdcVerification` call, not mocked |
| Reward execution | **Real** — `RewardExecutor.executeReward()` on Coston2, replay-protected |
| Solidity contract logic | **Real** — compiled and deployed on Coston2 |
| Demand profiles | **Realistic** — UK duck curve with per-household variation |
| Comfort constraints | **Realistic** — based on published DSR literature |
| Household metering | **Simulated** — numpy model, not real smart meters |
| FLEX token | **Simulated** — uint mapping, not ERC-20 (production would be ERC-20) |

> The project includes a local simulation mode (gated behind `ATTESTATION_MODE=simulation`) for rapid iteration, but the production path — check_attestation, run_reward_flow — uses only real FDC verification. No simulation code runs in the production execution path.

## Architecture

```
UK Grid API (Web2)         Flare FDC (Coston2)          On-chain contracts
┌─────────────────┐       ┌───────────────────┐       ┌──────────────────┐
│ Carbon Intensity │──────>│ Web2Json attesta- │──────>│ verifyWeb2Json() │
│ /intensity/{t}   │ fetch │ tion via FDC Hub  │ proof │ on-chain verify  │
└─────────────────┘       └───────────────────┘       └────────┬─────────┘
                                                               │ verified
┌─────────────────┐       ┌───────────────────┐       ┌───────v──────────┐
│ 25 Households   │──────>│ Flex Responses    │──────>│ executeReward()  │
│ comfort-limited  │ numpy │ who shifted what  │  call │ on-chain record  │
└─────────────────┘       └───────────────────┘       └──────────────────┘
```

## Quick start

### Prerequisites

- Python 3.9+ with `requests`, `numpy`
- Node.js 18+ with npm
- Git

### Setup

```bash
# Install Python deps
python3 -m venv .venv && source .venv/bin/activate
pip install requests numpy

# Install Node deps
npm install

# Install frontend deps
cd frontend && npm install && cd ..
```

### Run the full pipeline

```bash
# 1. Fetch real carbon intensity data (7 days)
python3 backend/fetch_carbon.py

# 2. Simulate comfort-constrained household flexibility
python3 backend/simulate.py

# 3. Copy data to frontend
cp backend/data/households.json frontend/public/data/
cp backend/data/flex_responses.json frontend/public/data/

# 4. Create FDC attestations
node backend/fdc_stub.js

# 5. Start local blockchain (keep this running in a separate terminal)
npx hardhat node

# 6. Deploy contracts (in another terminal)
npx hardhat run scripts/deploy.js --network localhost

# 7. Relay attestations to on-chain FDCShim
node backend/fdc_to_contract_stub.js

# 8. Run the full demo flow
npx hardhat run scripts/demoFlow.js --network localhost

# 9. Start frontend (optional)
cd frontend && npm start
```

## Live FDC attestation-only flow (no mocks)

Use this flow to verify an existing real Flare FDC attestation on-chain and only run rewards after confirmation.

```bash
# 1) Real-mode + Flare network config (Coston2)
export ATTESTATION_MODE="real"
export FLARE_RPC_URL="https://coston2-api.flare.network/ext/C/rpc"
export FLARE_CHAIN_ID="114"
export FDC_ATTESTATION_CONTRACT="0x48aC463d7975828989331F4De43341627b9c5f1D"
export FDC_VERIFICATION_CONTRACT="0x906507E0B64bcD494Db73bd0459d1C667e14B933"
export CONFIRMATIONS="12"

# 2) Existing attestation + proof artifacts
export ATTESTATION_TX_HASH="0x345fdb1257ea41d1746af39dadfa9201c4902658450fe3e8d9b6bfd5384f2fcf"
export REQUEST_SUBMISSION_PATH="fdc-carbon/out/request_submission.json"
export DA_PROOF_PATH="fdc-carbon/out/da_proof.json"
export API_RESPONSE_PATH="fdc-carbon/api_response.json"
export EXPECTED_MIC="0xe474421315f359e8422d0b2c0feb233a52f3029dc607cb96c5c65086aaae7846"

# 3) Check attestation on Flare (events/methods + confirmations + hash/timestamp + IFdcVerification)
npm run check:attestation

# 4) Deploy minimal RewardExecutor (MetaMask deploy tx payload)
#    This creates an on-chain contract address to use as REWARD_CONTRACT_ADDRESS.
export SIGNER_ADDRESS="0x<your_metamask_address>"
npm run reward:deploy:tx

# 5) Dry-run reward flow (verifies attestation first, no tx sent)
export DRY_RUN="1"
export SIGNER_MODE="metamask"
export REWARD_CONTRACT_ADDRESS="0x<deployed_reward_executor_address>"
export REWARD_FUNCTION_NAME="executeReward"
# args: [attestationTxHash, payloadHash, slotKey, participant, shiftedKw]
export REWARD_FUNCTION_ARGS_JSON='["0x<attestationTxHash>","0x<payloadHash>","0x<slotKey>","0x<participant>","1000"]'
npm run reward:run

# 6) Live reward execution (only after successful dry-run)
export DRY_RUN="0"
npm run reward:run
```

Outputs:
- `fdc-carbon/out/check_attestation_result.json`
- stdout fields: attestation tx hash, block number, confirmed true/false
- stdout fields (live mode): reward tx hash + block number

## On-chain proof inspectors (presentation mode)

Use these scripts to print clear, terminal-only proof that:
- the FDC attestation tx exists and verifies on-chain
- the reward tx emitted `RewardExecuted` from the reward contract

```bash
# Shared config (Coston2)
export ATTESTATION_MODE="real"
export FLARE_RPC_URL="https://coston2-api.flare.network/ext/C/rpc"
export FLARE_CHAIN_ID="114"
export CONFIRMATIONS="12"
export FDC_VERIFICATION_CONTRACT="0x906507E0B64bcD494Db73bd0459d1C667e14B933"

# Known attestation proof inputs
export ATTESTATION_TX_HASH="0x345fdb1257ea41d1746af39dadfa9201c4902658450fe3e8d9b6bfd5384f2fcf"
export DA_PROOF_PATH="fdc-carbon/out/da_proof.json"
export REQUEST_SUBMISSION_PATH="fdc-carbon/out/request_submission.json"
export API_RESPONSE_PATH="fdc-carbon/api_response.json"
export EXPECTED_MIC="0xe474421315f359e8422d0b2c0feb233a52f3029dc607cb96c5c65086aaae7846"

# Inspect attestation tx + on-chain verification
npm run attestation:inspect

# Known reward proof inputs
export REWARD_CONTRACT_ADDRESS="0x4a24DE38a2958f895e62c2E9b8D87054220101e0"
export REWARD_TX_HASH="0x3f1d172f9b4cdf1c436f223dc8af7ebc0b6a4552d4295ccd5c0480d939fcaf7f"

# Inspect reward tx + decode RewardExecuted event
npm run reward:inspect
```

Generated report files:
- `fdc-carbon/out/inspect_attestation_result.json`
- `fdc-carbon/out/inspect_reward_result.json`

## Reading the dashboard

The frontend at http://localhost:3000 shows six key visualisations:

1. **Summary metrics** — Peak demand reduction, kWh shifted, gCO2 avoided, FLEX tokens issued
2. **Community duck curve** — Grey area = baseline aggregate demand, green line = after shifting. Red shading highlights high-carbon windows where flex was requested. You should see the green line dip below grey in red zones and rise slightly during overnight/midday low-carbon periods.
3. **Carbon intensity overlay** — Dual-axis chart showing demand curves alongside the carbon intensity signal (dashed red). The 200 gCO2/kWh threshold line shows where flex events trigger.
4. **Household detail** — Select any household from the dropdown. Shows individual baseline vs shifted curves with comfort constraints visible (evening peak barely changes because cooking/lighting are inflexible).
5. **Energy shifted per household** — Horizontal bar chart sorted by contribution. Hover for detail: kWh shifted, % of demand, carbon avoided, appliance mix.
6. **Token earnings** — Rewards are proportional to (energy shifted) x (intensity delta), so households that shift during the *highest* carbon windows earn disproportionately more.

## 90-second demo script

For judges — run these commands in order:

```bash
# Terminal 1: Start blockchain
npx hardhat node

# Terminal 2: Full pipeline (~60s)
source .venv/bin/activate
python3 backend/fetch_carbon.py          # "Real carbon data from the UK Grid"
python3 backend/simulate.py              # "25 homes with comfort constraints"
cp backend/data/households.json frontend/public/data/
cp backend/data/flex_responses.json frontend/public/data/
node backend/fdc_stub.js                 # "Flare FDC attests each data point"
npx hardhat run scripts/deploy.js --network localhost
node backend/fdc_to_contract_stub.js     # "337 attestations relayed on-chain"
npx hardhat run scripts/demoFlow.js --network localhost
```

Then show the real FDC attestation verification (separate terminal, ~5s):

```bash
# Verify real attestation on Coston2
node scripts/check_attestation.js --id 0x345fdb1257ea41d1746af39dadfa9201c4902658450fe3e8d9b6bfd5384f2fcf
# → "Confirmed: true  |  Verification passed: true  |  verifyWeb2Json"
```

**Key talking points:**
- "The carbon data is REAL — fetched live from the UK National Grid API"
- "We attested this data on Flare Coston2 via FDC — here's the on-chain proof"
- "Each household has real constraints — you can't turn off the lights. Only EVs, heat pumps, and batteries shift."
- "Shifted energy is conserved — it moves to low-carbon windows, not deleted"
- "Rewards only execute after `verifyWeb2Json()` returns true — no mock, no override"
- "Rewards scale with carbon benefit: shifting at 220 gCO2 earns more than at 151 gCO2"

## File structure

```
contracts/
  RewardExecutor.sol         — On-chain reward recorder (deployed on Coston2)
  FlexDAO.sol                — Verification and reward contract (local demo)
  FDCShim.sol                — Simulated FDC oracle (local demo only, gated)

scripts/
  check_attestation.js       — Verify FDC attestation: verifyWeb2Json(), confirmations
  run_reward_flow.js         — Verify then execute reward (--dry-run or --execute)
  inspect_attestation_tx.js  — Decode and inspect attestation tx
  inspect_reward_tx.js       — Decode RewardExecuted events
  attestation_mode.js        — Mode gate: simulation vs real

fdc-carbon/
  request_jsonapi_attestation.js  — Submit Web2Json request to FDC Hub
  fetch_da_proof.js               — Poll DA layer for Merkle proof
  verify_with_fdc_verification.js — Call verifyWeb2Json() on-chain

backend/
  fetch_carbon.py            — Fetches UK carbon intensity (Web2 data source)
  simulate.py                — Comfort-constrained household flexibility model
  fdc_stub.js                — FDC attestation simulation (local demo, gated)
  fdc_to_contract_stub.js    — Relays to FDCShim (local demo, gated)

frontend/
  src/App.jsx                — React dashboard with on-chain verification display
  public/data/onchain.json   — Real attestation + reward tx data from Coston2
```

## Production roadmap

This project is currently running end-to-end on Flare’s Coston2 testnet. The roadmap below outlines the steps required to take it from a validated prototype to a production-ready system integrated with real energy markets.

1. ~~**Replace FDCShim with native Flare FDC verification**~~ **Completed**  
   The production data path now uses Flare’s real `verifyWeb2Json()` flow on Coston2, removing mocks and ensuring on-chain verifiability of Web2 energy data.

2. **Flare mainnet deployment**  
   Migrate contracts and indexing infrastructure from Coston2 to Flare mainnet, including parameter hardening and gas optimisation.

3. **Real metering integration**  
   Connect to live smart meter data providers (e.g. n3rgy, Hildebrand, DCC) to replace simulated household demand with real half-hourly consumption data.

4. **ERC-20 FLEX token**  
   Upgrade the internal flexibility balance mapping to a fully transferable ERC-20 token, enabling composability with DeFi and secondary markets.

5. **Multi-period staking**  
   Allow users to commit flexibility across longer time windows (days to weeks) in exchange for higher or more stable rewards.

6. **DAO governance**  
   Introduce on-chain governance where FLEX token holders vote on demand-shift thresholds, reward curves, and system parameters.

7. **Grid operator integration**  
   Integrate with National Grid ESO and other flexibility markets to monetise aggregated demand shifting and route real revenues back to users.

---

## Developer Feedback: Building on Flare

### What worked well

- **The FDC concept is exactly right for this use case.** Bringing Web2 API data on-chain with cryptographic guarantees is precisely what demand-response verification needs. The `Web2Json` attestation type let us attest an entire week of carbon intensity data in a single transaction — no custom oracle infrastructure required.

- **Coston2 was stable and responsive.** RPC endpoints, the DA layer, and the verification contracts all worked reliably throughout the hackathon. Block times were fast enough for rapid iteration.

- **The verifier API (prepareRequest + MIC) is well-designed.** The two-step flow — prepare the encoded request, then confirm the Message Integrity Code — gave us confidence that what we submitted matched what the verifier would attest.

- **On-chain verification is elegant once you have the proof.** Calling `verifyWeb2Json()` with the Merkle proof is a single `view` call — no gas cost for verification, which is ideal for a dApp that needs to check attestations frequently.

### What was challenging

- **Discovering the correct verification contract and ABI was the hardest part.** The `IFdcVerification` interface wasn't immediately obvious from the documentation. We wrote a registry-check script to query the Flare contract registry and tried multiple contract addresses and function signatures (`verifyJsonApi` vs `verifyWeb2Json`) before finding the working combination. Clearer documentation on which verification contract to use on each network, with a canonical ABI, would save builders significant time.

- **The MIC (Message Integrity Code) had two different values.** Our locally computed SHA-256 of the API response (`computedMic`) differed from the verifier's `messageIntegrityCode`. Both are valid in different contexts, but the relationship between them isn't well-documented. We had to test both to understand which one the on-chain verification expects.

- **DA proof polling requires patience and guesswork.** After submitting an attestation request, we polled the DA layer across multiple voting rounds (trying `latestRound - 2` through `latestRound + 1`) because there's no notification when the proof is ready. The ~10 minute wait with 15-second polling intervals is fine for production, but during a hackathon it meant a lot of staring at "proof not ready yet" messages. A webhook or WebSocket subscription for proof readiness would be a meaningful DX improvement.

- **The `postProcessJq` and `abiSignature` interaction needs more examples.** We used `.data | tostring` with `abiSignature: "string"`, which works, but it took trial and error to understand what JQ expressions the verifier supports and how the output maps to ABI-encoded response data. More worked examples in the docs — especially for JSON APIs that return nested objects — would help.

### Suggestions for Flare

1. **Publish a "first attestation" tutorial** with a complete working example: API URL, JQ transform, expected MIC, verification contract address, and ABI — all for Coston2. One copy-paste-and-run script would save every new builder 2-3 hours.
2. **Add verification contract addresses to the docs network tables** alongside the FDC Hub address, so builders don't need to query the registry.
3. **Consider a proof-ready notification** (WebSocket or event) from the DA layer, as an alternative to polling.

### Overall

Flare's FDC is a powerful primitive. The core idea — decentralised attestation of Web2 data with Merkle proof verification — is sound and production-ready. The main friction is in developer discovery: finding the right contracts, ABIs, and parameter formats. Once we had those, the integration was straightforward and the on-chain verification worked exactly as expected.

---

## Team

Built by Zara Pashov and Oliver Pugh at ETH Oxford 2026.

## License

MIT
