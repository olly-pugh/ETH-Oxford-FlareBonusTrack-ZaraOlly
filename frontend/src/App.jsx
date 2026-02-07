import React, { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
  ComposedChart,
} from "recharts";

// ─── Theme ──────────────────────────────────────────────────────────────────
const C = {
  bg: "#0a0e17", card: "#131a2b", border: "#1e2d4a",
  green: "#00d4aa", greenDim: "#00d4aa33",
  red: "#ff6b6b", redDim: "#ff6b6b22",
  grey: "#7a8ba8", greyLine: "#3a4a6a",
  text: "#e0e6f0", muted: "#7a8ba8",
  orange: "#ffaa44", blue: "#4488ff",
};

// ─── Shared styles ──────────────────────────────────────────────────────────
const s = {
  app: { fontFamily: "'Inter','SF Pro',system-ui,sans-serif", background: C.bg, color: C.text, minHeight: "100vh", padding: "20px 24px", maxWidth: 1080, margin: "0 auto" },
  card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "18px 22px", marginBottom: 16 },
  grid: { display: "grid", gap: 14, marginBottom: 20 },
  grid4: { gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" },
  section: { marginBottom: 36 },
  h2: { fontSize: 17, fontWeight: 600, marginBottom: 6, color: C.text },
  hint: { fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.5 },
  label: { fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: C.muted, marginBottom: 2 },
  bigNum: { fontSize: 26, fontWeight: 700, color: C.green },
  select: { background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 13, outline: "none" },
};

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n, d = 1) => (typeof n === "number" ? n.toFixed(d) : n);
const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : fmt(n, 0));

function shortTs(ts) {
  // "2026-02-01T14:30Z" → "Feb 1 14:30"
  const m = ts.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/);
  if (!m) return ts;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[+m[2] - 1]} ${+m[3]} ${m[4]}`;
}

function hourLabel(ts) {
  const m = ts.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : ts;
}

// ─── Stat card ──────────────────────────────────────────────────────────────
function Stat({ label, value, unit, color }) {
  return (
    <div style={s.card}>
      <div style={s.label}>{label}</div>
      <div style={{ ...s.bigNum, color: color || C.green }}>
        {value}{unit && <span style={{ fontSize: 13, color: C.muted, marginLeft: 4 }}>{unit}</span>}
      </div>
    </div>
  );
}

// ─── Custom tooltip ─────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1a2236", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 12 }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || C.text }}>
          {p.name}: <b>{typeof p.value === "number" ? p.value.toFixed(1) : p.value}</b>
          {p.name.includes("kW") || p.name.includes("Demand") ? " kW" : ""}
          {p.name.includes("Intensity") ? " gCO2/kWh" : ""}
        </div>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// APP
// ═════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [hhData, setHhData] = useState(null);
  const [flexData, setFlexData] = useState(null);
  const [selectedHH, setSelectedHH] = useState(0);
  const [dayIdx, setDayIdx] = useState(0);

  // Load data
  useEffect(() => {
    fetch("/data/households.json").then(r => r.json()).then(setHhData).catch(() => {});
    fetch("/data/flex_responses.json").then(r => r.json()).then(setFlexData).catch(() => {});
  }, []);

  // ── Derived data ────────────────────────────────────────────────────────
  const { days, dayRanges, communityDay, hhDay, households, summary,
          hhSorted, highWindows } = useMemo(() => {
    if (!hhData || !flexData) return {};
    const ts = hhData.timestamps;
    // Group by day
    const dayMap = {};
    ts.forEach((t, i) => {
      const d = t.slice(0, 10);
      if (!dayMap[d]) dayMap[d] = [];
      dayMap[d].push(i);
    });
    const days = Object.keys(dayMap).sort();
    const dayRanges = days.map(d => dayMap[d]);

    // Current day data
    const di = Math.min(dayIdx, days.length - 1);
    const range = dayRanges[di] || [];

    // Community-level chart data for selected day
    const communityDay = range.map(i => ({
      time: hourLabel(ts[i]),
      ts: ts[i],
      baseline: hhData.aggregate_baseline_kw[i],
      shifted: hhData.aggregate_shifted_kw[i],
      intensity: hhData.intensities[i],
      isHigh: hhData.intensities[i] >= hhData.high_threshold,
    }));

    // Household-level chart data for selected day
    const hh = hhData.households[selectedHH];
    const hhDay = hh ? range.map(i => ({
      time: hourLabel(ts[i]),
      baseline: hh.baseline_kw[i],
      shifted: hh.shifted_kw[i],
      intensity: hhData.intensities[i],
      isHigh: hhData.intensities[i] >= hhData.high_threshold,
    })) : [];

    // High-carbon windows for reference areas
    const highWindows = [];
    let start = null;
    communityDay.forEach((d, i) => {
      if (d.isHigh && start === null) start = i;
      if (!d.isHigh && start !== null) {
        highWindows.push({ x1: communityDay[start].time, x2: communityDay[i - 1].time });
        start = null;
      }
    });
    if (start !== null) highWindows.push({ x1: communityDay[start].time, x2: communityDay[communityDay.length - 1].time });

    // Households sorted by tokens earned
    const hhSorted = [...hhData.households]
      .map((h, i) => ({ ...h, idx: i }))
      .sort((a, b) => b.tokens_earned - a.tokens_earned);

    return {
      days, dayRanges, communityDay, hhDay,
      households: hhData.households,
      summary: flexData.summary,
      hhSorted, highWindows,
    };
  }, [hhData, flexData, selectedHH, dayIdx]);

  if (!hhData || !flexData || !summary) {
    return (
      <div style={{ ...s.app, textAlign: "center", paddingTop: 80 }}>
        <h1 style={{ color: C.green, fontSize: 28 }}>FlexDAO</h1>
        <p style={{ color: C.muted, marginTop: 12 }}>Loading simulation data...</p>
        <p style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>
          Make sure <code>backend/data/households.json</code> and <code>flex_responses.json</code> are copied to <code>frontend/public/data/</code>
        </p>
      </div>
    );
  }

  const hh = households[selectedHH];

  return (
    <div style={s.app}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header style={{ textAlign: "center", marginBottom: 28 }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, color: C.green, margin: 0 }}>FlexDAO</h1>
        <p style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>
          Comfort-constrained demand flexibility, verified on-chain via Flare FDC
        </p>
      </header>

      {/* ── 1. Summary metrics ──────────────────────────────────────────── */}
      <div style={{ ...s.grid, ...s.grid4 }}>
        <Stat label="Peak Demand Reduction" value={`${summary.peak_demand_reduction_pct}%`} />
        <Stat label="Total Energy Shifted" value={fmt(summary.total_shifted_kwh, 1)} unit="kWh" />
        <Stat label="Carbon Avoided" value={fmtK(summary.total_carbon_avoided_gCO2)} unit="gCO2" />
        <Stat label="FLEX Tokens Issued" value={fmt(summary.total_tokens_issued, 0)} unit="FLEX" color={C.orange} />
      </div>
      <div style={{ ...s.grid, ...s.grid4 }}>
        <Stat label="Households" value={summary.n_households} />
        <Stat label="High-Carbon Slots" value={summary.high_carbon_slots} />
        <Stat label="Avg Participants" value={summary.avg_participants_per_event} unit="/event" />
        <Stat label="Intensity Threshold" value={summary.high_carbon_slots > 0 ? "150" : "—"} unit="gCO2/kWh" color={C.red} />
      </div>

      {/* ── Day selector ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 13, color: C.muted }}>Day:</span>
        {days.map((d, i) => (
          <button key={d} onClick={() => setDayIdx(i)} style={{
            padding: "4px 12px", borderRadius: 6, border: "none", cursor: "pointer",
            background: i === dayIdx ? C.green : C.card, color: i === dayIdx ? C.bg : C.muted,
            fontSize: 12, fontWeight: i === dayIdx ? 600 : 400,
          }}>
            {d.slice(5)}
          </button>
        ))}
      </div>

      {/* ── 2. Community duck curve: baseline vs shifted ────────────────── */}
      <div style={s.section}>
        <h2 style={s.h2}>Community Demand — Baseline vs Shifted</h2>
        <p style={s.hint}>
          Grey = original demand. Green = after comfort-constrained shifting.
          Red shading = high-carbon windows (&ge; 150 gCO2/kWh).
          Only flexible load (EV, heat pump, battery) is shifted — comfort limits prevent excessive reduction.
        </p>
        <div style={s.card}>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={communityDay} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              {highWindows.map((w, i) => (
                <ReferenceArea key={i} x1={w.x1} x2={w.x2} fill={C.redDim} />
              ))}
              <XAxis dataKey="time" tick={{ fill: C.muted, fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} label={{ value: "kW", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 11 }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="baseline" name="Baseline Demand" stroke={C.greyLine} fill={C.greyLine + "33"} strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="shifted" name="Shifted Demand" stroke={C.green} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── 3. Carbon intensity overlay ─────────────────────────────────── */}
      <div style={s.section}>
        <h2 style={s.h2}>Carbon Intensity vs Demand</h2>
        <p style={s.hint}>
          Rewards scale with useful carbon-aware behaviour — shifting during the highest-intensity windows earns the most FLEX tokens.
        </p>
        <div style={s.card}>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={communityDay} margin={{ top: 10, right: 40, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              {highWindows.map((w, i) => (
                <ReferenceArea key={i} x1={w.x1} x2={w.x2} fill={C.redDim} />
              ))}
              <XAxis dataKey="time" tick={{ fill: C.muted, fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis yAxisId="kw" tick={{ fill: C.muted, fontSize: 10 }} label={{ value: "kW", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 11 }} />
              <YAxis yAxisId="ci" orientation="right" tick={{ fill: C.muted, fontSize: 10 }} label={{ value: "gCO2/kWh", angle: 90, position: "insideRight", fill: C.muted, fontSize: 11 }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area yAxisId="kw" type="monotone" dataKey="baseline" name="Baseline (kW)" stroke={C.greyLine} fill={C.greyLine + "22"} strokeWidth={1} dot={false} />
              <Line yAxisId="kw" type="monotone" dataKey="shifted" name="Shifted (kW)" stroke={C.green} strokeWidth={2} dot={false} />
              <Line yAxisId="ci" type="monotone" dataKey="intensity" name="Carbon Intensity" stroke={C.red} strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
              <ReferenceLine yAxisId="ci" y={150} stroke={C.red} strokeDasharray="8 4" label={{ value: "Threshold", fill: C.red, fontSize: 10 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── 4. Household detail ─────────────────────────────────────────── */}
      <div style={s.section}>
        <h2 style={s.h2}>Household Detail</h2>
        <p style={s.hint}>
          Select a household to see its individual load curve. Each home has different flexible assets and comfort limits.
        </p>
        <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
          <select style={s.select} value={selectedHH} onChange={e => setSelectedHH(+e.target.value)}>
            {households.map((h, i) => (
              <option key={h.id} value={i}>{h.id} — {h.flex_assets}</option>
            ))}
          </select>
          {hh && (
            <span style={{ fontSize: 12, color: C.muted }}>
              Max shift: {(hh.max_shift_fraction * 100).toFixed(0)}% |
              Max hours/day: {hh.max_shift_hours} |
              Peak: {hh.peak_demand_kw} kW |
              Shifted: {hh.total_shifted_kwh} kWh |
              Tokens: {hh.tokens_earned} FLEX
            </span>
          )}
        </div>
        <div style={s.card}>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={hhDay} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              {highWindows.map((w, i) => (
                <ReferenceArea key={i} x1={w.x1} x2={w.x2} fill={C.redDim} />
              ))}
              <XAxis dataKey="time" tick={{ fill: C.muted, fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: C.muted, fontSize: 10 }} label={{ value: "kW", angle: -90, position: "insideLeft", fill: C.muted, fontSize: 11 }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="baseline" name="Baseline" stroke={C.greyLine} fill={C.greyLine + "33"} strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="shifted" name="After Shifting" stroke={C.green} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── 5. Flexibility contribution (kWh shifted per household) ──── */}
      <div style={s.section}>
        <h2 style={s.h2}>Energy Shifted per Household</h2>
        <p style={s.hint}>
          Sorted by contribution. Larger homes with more flexible assets (EVs, batteries) can shift more — but comfort limits cap each household.
        </p>
        <div style={s.card}>
          <ResponsiveContainer width="100%" height={Math.max(280, hhSorted.length * 22)}>
            <BarChart data={hhSorted} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
              <XAxis type="number" tick={{ fill: C.muted, fontSize: 10 }} label={{ value: "kWh shifted", position: "insideBottom", fill: C.muted, fontSize: 11, offset: -2 }} />
              <YAxis dataKey="id" type="category" tick={{ fill: C.muted, fontSize: 10 }} width={55} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: "#1a2236", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.id} — {d.flex_assets}</div>
                    <div>Shifted: <b>{d.total_shifted_kwh} kWh</b></div>
                    <div>Demand shifted: <b>{d.pct_demand_shifted}%</b></div>
                    <div>Carbon avoided: <b>{fmtK(d.carbon_avoided_gCO2)} gCO2</b></div>
                    <div style={{ color: C.orange }}>Tokens: <b>{d.tokens_earned} FLEX</b></div>
                  </div>
                );
              }} />
              <Bar dataKey="total_shifted_kwh" name="kWh Shifted" fill={C.green} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── 6. Token earnings per household ──────────────────────────── */}
      <div style={s.section}>
        <h2 style={s.h2}>FLEX Token Earnings</h2>
        <p style={s.hint}>
          1 FLEX = 1 kg CO2 avoided. Rewards = (energy shifted) x (carbon intensity delta) / 1000.
          Shifting 1 kWh away from a 220 gCO2 slot to a 120 gCO2 slot earns 0.1 FLEX (100g CO2 saved).
        </p>
        <div style={s.card}>
          <ResponsiveContainer width="100%" height={Math.max(280, hhSorted.length * 22)}>
            <BarChart data={hhSorted} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
              <XAxis type="number" tick={{ fill: C.muted, fontSize: 10 }} label={{ value: "FLEX tokens", position: "insideBottom", fill: C.muted, fontSize: 11, offset: -2 }} />
              <YAxis dataKey="id" type="category" tick={{ fill: C.muted, fontSize: 10 }} width={55} />
              <Tooltip content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: "#1a2236", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 12 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.id}</div>
                    <div style={{ color: C.orange }}>Tokens: <b>{d.tokens_earned} FLEX</b></div>
                    <div>kWh shifted: <b>{d.total_shifted_kwh}</b></div>
                    <div>Avg intensity avoided: <b>{d.total_shifted_kwh > 0 ? fmt(d.carbon_avoided_gCO2 / d.total_shifted_kwh, 0) : 0} gCO2/kWh</b></div>
                  </div>
                );
              }} />
              <Bar dataKey="tokens_earned" name="FLEX Tokens" fill={C.orange} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Architecture diagram ─────────────────────────────────────── */}
      <div style={s.section}>
        <h2 style={s.h2}>Architecture</h2>
        <div style={{ ...s.card, fontFamily: "'SF Mono',monospace", fontSize: 11, lineHeight: 1.6 }}>
          <pre style={{ margin: 0, color: C.muted, overflow: "auto" }}>
{`  UK Grid API (Web2)         Flare FDC (simulated)        FlexDAO (Solidity)
  ┌─────────────────┐       ┌───────────────────┐       ┌──────────────────┐
  │ Carbon Intensity │──────▶│ Attestation Stub  │──────▶│ FDCShim (on-chain│
  │ /intensity/{t}   │ fetch │ keccak256(ts)→val │ relay │ key→intensity)   │
  └─────────────────┘       └───────────────────┘       └────────┬─────────┘
                                                                 │ reads
  ┌─────────────────┐       ┌───────────────────┐       ┌───────▼──────────┐
  │ 25 Households   │──────▶│ Flex Responses    │──────▶│ FlexDAO.sol      │
  │ comfort-limited  │ numpy │ who shifted what  │submit │ verify + reward  │
  └─────────────────┘       └───────────────────┘       └──────────────────┘

  REAL:  Carbon intensity data, keccak256 keys, Solidity verification logic
  SIM:   FDC consensus, household metering, token transfers`}
          </pre>
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer style={{ textAlign: "center", color: C.muted, fontSize: 12, padding: "12px 0 24px" }}>
        FlexDAO — ETH Oxford 2026 | Comfort-constrained demand flexibility on Flare
      </footer>
    </div>
  );
}
