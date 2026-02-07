# FlexDAO

**Decentralised demand-flexibility verification using real UK energy data and the Flare Data Connector.**

Built at ETH Oxford 2026.

---

## What it does

FlexDAO brings real-world energy data on-chain to verify and reward household demand-flexibility:

1. **Fetch** — Pulls 7 days of half-hourly carbon intensity from the UK National Grid API (real Web2 data)
2. **Simulate** — Models 25 households with comfort-constrained flexibility (EV, heat pump, battery, appliances)
3. **Attest** — A Flare FDC stub converts each data point into a `keccak256(timestamp) → intensity` attestation
4. **Relay** — Attestations are submitted to an on-chain `FDCShim` contract (simulates FDC's Merkle-proof verification)
5. **Verify & Reward** — `FlexDAO.sol` reads the oracle, confirms the slot was high-carbon (>= 200 gCO2/kWh), and issues FLEX tokens proportional to (energy shifted) x (carbon intensity delta)

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
| keccak256 oracle keys | **Real** — same derivation as production |
| Solidity contract logic | **Real** — compiles and runs on EVM (Hardhat) |
| Demand profiles | **Realistic** — UK duck curve with per-household variation |
| Comfort constraints | **Realistic** — based on published DSR literature |
| FDC attestation consensus | **Simulated** — single-provider stub, no Merkle tree |
| Household metering | **Simulated** — numpy model, not real smart meters |
| FLEX token | **Simulated** — uint mapping, not ERC-20 |

## Architecture

```
UK Grid API (Web2)         Flare FDC (simulated)        FlexDAO (Solidity)
┌─────────────────┐       ┌───────────────────┐       ┌──────────────────┐
│ Carbon Intensity │──────>│ Attestation Stub  │──────>│ FDCShim (on-chain│
│ /intensity/{t}   │ fetch │ keccak256(ts)→val │ relay │ key→intensity)   │
└─────────────────┘       └───────────────────┘       └────────┬─────────┘
                                                               │ reads
┌─────────────────┐       ┌───────────────────┐       ┌───────v──────────┐
│ 25 Households   │──────>│ Flex Responses    │──────>│ FlexDAO.sol      │
│ comfort-limited  │ numpy │ who shifted what  │submit │ verify + reward  │
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

**Key talking points:**
- "The carbon data is REAL — fetched live from the UK National Grid API"
- "Each household has real constraints — you can't turn off the lights. Only EVs, heat pumps, and batteries shift."
- "Shifted energy is conserved — it moves to low-carbon windows, not deleted"
- "FlexDAO.sol verifies each event against on-chain FDC data before issuing rewards"
- "Rewards scale with carbon benefit: shifting at 220 gCO2 earns more than at 201 gCO2"
- "Production: swap FDCShim for Flare mainnet, add real smart meter data via n3rgy/Hildebrand"

## File structure

```
backend/
  fetch_carbon.py          — Fetches UK carbon intensity (Web2 data source)
  simulate.py              — Comfort-constrained household flexibility simulation
  fdc_stub.js              — Flare FDC attestation simulation
  fdc_to_contract_stub.js  — Relays attestations to on-chain FDCShim
  data/
    carbon_week.json       — Raw carbon intensity data
    flex_responses.json    — Per-slot flex events (backward-compatible)
    households.json        — Per-household time series (baseline + shifted)
    aggregates.csv         — Community-level half-hourly totals
contracts/
  IFDCOracle.sol           — Oracle interface
  FDCShim.sol              — Simulated FDC on-chain store
  FlexDAO.sol              — Verification and reward contract
scripts/
  deploy.js                — Hardhat deploy script
  demoFlow.js              — End-to-end demo script
frontend/
  src/App.jsx              — React dashboard with 6 visualisation panels
  public/data/             — Simulation data served to frontend
```

## Production roadmap

1. **Replace FDCShim** with Flare mainnet FDC verification contract
2. **Real metering** — integrate with smart meter APIs (n3rgy, Hildebrand, DCC)
3. **ERC-20 FLEX token** — replace uint mapping with transferable token
4. **Multi-period staking** — commit to flexibility over longer windows for bonus rewards
5. **DAO governance** — token holders vote on threshold parameters and reward curves
6. **Grid operator integration** — National Grid ESO flexibility market participation

## Team

Built at ETH Oxford 2026.

## License

MIT
