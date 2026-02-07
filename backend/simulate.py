#!/usr/bin/env python3
"""
FlexDAO — Step 2: Comfort-constrained demand-flexibility simulation.

Reads carbon_week.json and produces:
  - flex_responses.json  (backward-compatible with demoFlow.js / FDC pipeline)
  - households.json      (per-household time-series: baseline vs shifted)
  - aggregates.csv       (community-level half-hourly totals)

Model:
  Each of the 25 households has a realistic "duck curve" demand profile split
  into INFLEXIBLE load (lighting, cooking, heating baseload) and FLEXIBLE load
  (EV charging, dishwasher, heat-pump slack, battery).

  Comfort constraints per household:
    - max_shift_fraction : 20-40% of daily energy is flexible
    - max_shift_hours    : up to 2-4 hours of shifting per day
    - protected_window   : evening peak (17:00-20:00) inflexible load stays

  During high-carbon slots (>= 150 gCO2/kWh):
    - Only flexible load can be curtailed
    - Curtailed energy is RE-ADDED to the nearest low-carbon window
      (overnight or midday solar trough) so total daily energy is conserved
    - Rewards = energy_shifted * (high_intensity - low_intensity) / 1000
      i.e. 1 FLEX token = 1 kg CO2 avoided

  This produces a visible "duck curve flattening" effect.
"""

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

DATA_DIR = Path(__file__).resolve().parent / "data"
CARBON_FILE = DATA_DIR / "carbon_week.json"
OUT_FLEX = DATA_DIR / "flex_responses.json"
OUT_HOUSEHOLDS = DATA_DIR / "households.json"
OUT_AGGREGATES = DATA_DIR / "aggregates.csv"

N_HOUSEHOLDS = 25
HIGH_THRESHOLD = 150  # gCO2/kWh
SEED = 42


# ---------------------------------------------------------------------------
# Demand profile shapes (kW multipliers by half-hour-of-day, 0-47)
# ---------------------------------------------------------------------------

def _duck_curve_base():
    """Typical UK winter residential demand profile (48 half-hours).
    Morning ramp, midday dip, evening peak, overnight trough."""
    hours = np.arange(48) / 2.0  # 0.0, 0.5, 1.0 … 23.5
    profile = np.where(
        hours < 6,   0.3,                              # overnight base
    np.where(
        hours < 8,   0.3 + 0.7 * (hours - 6) / 2,     # morning ramp
    np.where(
        hours < 12,  0.85 - 0.15 * (hours - 8) / 4,   # late morning dip
    np.where(
        hours < 16,  0.7,                               # midday plateau
    np.where(
        hours < 18,  0.7 + 0.6 * (hours - 16) / 2,    # evening ramp
    np.where(
        hours < 21,  1.3 - 0.1 * (hours - 18) / 3,    # evening peak → taper
    np.where(
        hours < 23,  1.0 - 0.5 * (hours - 21) / 2,    # wind-down
                      0.35                               # late night
    )))))))
    return profile


def _flexible_fraction_profile():
    """Fraction of demand that is FLEXIBLE by half-hour-of-day.
    Higher during off-peak (EV charging, heat pump pre-heat), lower during
    evening peak (cooking, lighting are inflexible)."""
    hours = np.arange(48) / 2.0
    flex = np.where(
        hours < 6,   0.7,   # overnight: mostly EV/battery — very flexible
    np.where(
        hours < 9,   0.4,   # morning: some flex (heat pump)
    np.where(
        hours < 16,  0.5,   # daytime: moderate (dishwasher, laundry)
    np.where(
        hours < 20,  0.15,  # evening peak: mostly inflexible (cooking, lights)
                      0.6    # late evening: EV, battery
    ))))
    return flex


DUCK_CURVE = _duck_curve_base()
FLEX_PROFILE = _flexible_fraction_profile()


# ---------------------------------------------------------------------------
# Main simulation
# ---------------------------------------------------------------------------

def simulate():
    if not CARBON_FILE.exists():
        print(f"ERROR: {CARBON_FILE} not found. Run fetch_carbon.py first.")
        sys.exit(1)

    with open(CARBON_FILE) as f:
        carbon = json.load(f)

    rng = np.random.default_rng(SEED)
    n_slots = len(carbon)

    # --- Parse timestamps and extract half-hour-of-day index ---------------
    timestamps = []
    slot_hod = []  # half-hour-of-day index (0-47)
    intensities = []
    for slot in carbon:
        ts = slot["from"]
        timestamps.append(ts)
        # Parse "2026-01-31T14:30Z" style
        dt = datetime.strptime(ts.replace("Z", "+00:00"), "%Y-%m-%dT%H:%M%z")
        hod_idx = dt.hour * 2 + (1 if dt.minute >= 30 else 0)
        slot_hod.append(hod_idx)
        actual = slot["intensity"].get("actual") or slot["intensity"].get("forecast", 0)
        intensities.append(actual)

    slot_hod = np.array(slot_hod)
    intensities = np.array(intensities, dtype=float)

    # --- Identify day boundaries for daily energy conservation -------------
    day_ids = []
    for slot in carbon:
        ts = slot["from"]
        day_ids.append(ts[:10])  # "2026-01-31"
    unique_days = sorted(set(day_ids))
    day_of_slot = np.array([unique_days.index(d) for d in day_ids])

    # --- Generate household profiles ---------------------------------------
    households = []
    for i in range(N_HOUSEHOLDS):
        peak_demand = round(float(rng.normal(1.8, 0.4)), 2)  # kW at peak
        peak_demand = max(0.8, peak_demand)  # floor
        households.append({
            "id": f"HH-{i+1:03d}",
            "peak_demand_kw": peak_demand,
            "max_shift_fraction": round(float(rng.uniform(0.20, 0.40)), 2),
            "max_shift_hours": round(float(rng.uniform(2.0, 4.0)), 1),
            "p_respond": round(float(rng.uniform(0.5, 0.95)), 2),
            # Appliance mix description (for display)
            "flex_assets": rng.choice(
                [
                    "EV + heat pump",
                    "EV + dishwasher + battery",
                    "Heat pump + laundry",
                    "EV + battery",
                    "Heat pump + dishwasher",
                ],
            ),
        })

    # --- Build per-household baseline and shifted time-series --------------
    # Arrays: [household, slot]
    baseline_all = np.zeros((N_HOUSEHOLDS, n_slots))
    shifted_all = np.zeros((N_HOUSEHOLDS, n_slots))
    shift_amount_all = np.zeros((N_HOUSEHOLDS, n_slots))  # positive = removed

    for hi, hh in enumerate(households):
        pk = hh["peak_demand_kw"]
        # Baseline = duck curve * peak, with small per-household noise
        noise = 1.0 + rng.normal(0, 0.05, size=n_slots)
        baseline = DUCK_CURVE[slot_hod] * pk * noise
        baseline = np.clip(baseline, 0.05, None)
        baseline_all[hi] = baseline

        # Flexible portion per slot
        flex_available = baseline * FLEX_PROFILE[slot_hod]

        # Track per-day shifting budget
        responded_today = {}  # day_idx → hours shifted so far
        max_daily_shift_energy = hh["max_shift_fraction"] * np.sum(baseline) / len(unique_days)

        shifted = baseline.copy()
        shifted_energy_today = {}  # day_idx → kWh removed

        # --- Pass 1: Curtail flexible load during high-carbon slots --------
        for t in range(n_slots):
            day = day_of_slot[t]
            intensity = intensities[t]

            if intensity < HIGH_THRESHOLD:
                continue

            # Does this household respond today?
            if day not in responded_today:
                responded_today[day] = rng.random() < hh["p_respond"]
            if not responded_today[day]:
                continue

            if day not in shifted_energy_today:
                shifted_energy_today[day] = 0.0

            # Check daily budget (hours and energy)
            hours_so_far = shifted_energy_today[day] / max(pk, 0.1)
            if hours_so_far >= hh["max_shift_hours"]:
                continue
            if shifted_energy_today[day] >= max_daily_shift_energy:
                continue

            # Curtail flexible load at this slot
            curtail = flex_available[t]
            # Cap to remaining daily budget
            remaining_energy = max_daily_shift_energy - shifted_energy_today[day]
            curtail = min(curtail, remaining_energy / 0.5)  # kW for 0.5h slot

            shifted[t] -= curtail
            shifted[t] = max(shifted[t], 0.05)
            actual_curtail = baseline[t] - shifted[t]
            shift_amount_all[hi, t] = actual_curtail
            shifted_energy_today[day] = shifted_energy_today.get(day, 0) + actual_curtail * 0.5

        # --- Pass 2: Re-add curtailed energy to low-carbon windows ---------
        for day in range(len(unique_days)):
            day_mask = day_of_slot == day
            day_slots = np.where(day_mask)[0]
            curtailed_kwh = np.sum(shift_amount_all[hi, day_slots]) * 0.5

            if curtailed_kwh <= 0:
                continue

            # Find low-carbon slots in this day (below median intensity)
            day_intensities = intensities[day_slots]
            median_int = np.median(day_intensities)
            low_carbon_mask = day_intensities < median_int

            # Prefer overnight (00:00-06:00) and midday (10:00-14:00)
            preferred = np.zeros(len(day_slots), dtype=bool)
            for j, t in enumerate(day_slots):
                h = slot_hod[t] / 2.0
                if (h < 6) or (10 <= h < 14):
                    preferred[j] = True

            target_slots = day_slots[preferred & low_carbon_mask]
            if len(target_slots) == 0:
                target_slots = day_slots[low_carbon_mask]
            if len(target_slots) == 0:
                target_slots = day_slots[:6]  # fallback: early morning

            # Spread curtailed energy evenly across target slots
            add_per_slot = curtailed_kwh / (len(target_slots) * 0.5)  # kW
            for t in target_slots:
                shifted[t] += add_per_slot

        shifted_all[hi] = shifted

    # --- Community aggregates -----------------------------------------------
    agg_baseline = np.sum(baseline_all, axis=0)
    agg_shifted = np.sum(shifted_all, axis=0)
    agg_shift_amount = np.sum(shift_amount_all, axis=0)

    # --- Compute rewards per household --------------------------------------
    # reward = sum over high-carbon slots: (kW_shifted * 0.5h) * intensity_delta
    # intensity_delta = slot_intensity - daily_low_intensity (benefit of shifting)
    hh_rewards = np.zeros(N_HOUSEHOLDS)
    hh_total_shifted_kwh = np.zeros(N_HOUSEHOLDS)
    hh_carbon_avoided = np.zeros(N_HOUSEHOLDS)

    for day in range(len(unique_days)):
        day_mask = day_of_slot == day
        day_slots = np.where(day_mask)[0]
        day_low = np.min(intensities[day_slots]) if len(day_slots) > 0 else 0

        for t in day_slots:
            if intensities[t] < HIGH_THRESHOLD:
                continue
            delta = intensities[t] - day_low
            for hi in range(N_HOUSEHOLDS):
                shifted_kw = shift_amount_all[hi, t]
                if shifted_kw > 0:
                    shifted_kwh = shifted_kw * 0.5
                    hh_total_shifted_kwh[hi] += shifted_kwh
                    hh_carbon_avoided[hi] += shifted_kwh * delta  # gCO2
                    hh_rewards[hi] += shifted_kwh * delta / 1000  # 1 FLEX = 1 kg CO2 avoided

    # --- Build backward-compatible flex_responses.json ----------------------
    flex_events = []
    total_shifted_kwh_global = 0.0

    for t in range(n_slots):
        actual = int(intensities[t])
        is_high = actual >= HIGH_THRESHOLD

        slot_record = {
            "from": carbon[t]["from"],
            "to": carbon[t]["to"],
            "intensity_actual": actual,
            "flex_requested": is_high,
            "participants": [],
            "aggregate_shifted_kw": 0.0,
        }

        if is_high:
            for hi in range(N_HOUSEHOLDS):
                sk = shift_amount_all[hi, t]
                if sk > 0.001:
                    slot_record["participants"].append({
                        "id": households[hi]["id"],
                        "shifted_kw": round(float(sk), 3),
                    })
                    slot_record["aggregate_shifted_kw"] += sk
            slot_record["aggregate_shifted_kw"] = round(
                slot_record["aggregate_shifted_kw"], 3
            )
            total_shifted_kwh_global += slot_record["aggregate_shifted_kw"] * 0.5

        flex_events.append(slot_record)

    # --- Peak demand reduction -----------------------------------------------
    peak_baseline = float(np.max(agg_baseline))
    peak_shifted = float(np.max(agg_shifted))
    peak_reduction_pct = round((1 - peak_shifted / peak_baseline) * 100, 1) if peak_baseline > 0 else 0

    total_carbon_avoided = float(np.sum(hh_carbon_avoided))  # gCO2
    total_tokens = float(np.sum(hh_rewards))

    high_slots = [e for e in flex_events if e["flex_requested"]]
    avg_participants = (
        np.mean([len(e["participants"]) for e in high_slots]) if high_slots else 0
    )

    summary = {
        "n_households": N_HOUSEHOLDS,
        "total_slots": n_slots,
        "high_carbon_slots": len(high_slots),
        "total_shifted_kwh": round(total_shifted_kwh_global, 2),
        "avg_participants_per_event": round(float(avg_participants), 1),
        "peak_demand_reduction_pct": peak_reduction_pct,
        "total_carbon_avoided_gCO2": round(total_carbon_avoided, 0),
        "total_tokens_issued": round(total_tokens, 1),
        "peak_baseline_kw": round(peak_baseline, 1),
        "peak_shifted_kw": round(peak_shifted, 1),
    }

    # --- Write flex_responses.json (backward-compatible) --------------------
    flex_output = {
        "summary": summary,
        "households": [
            {
                "id": hh["id"],
                "peak_demand_kw": hh["peak_demand_kw"],
                "max_shift_fraction": hh["max_shift_fraction"],
                "max_shift_hours": hh["max_shift_hours"],
                "p_respond": hh["p_respond"],
                "flex_assets": str(hh["flex_assets"]),
                "total_shifted_kwh": round(float(hh_total_shifted_kwh[i]), 2),
                "carbon_avoided_gCO2": round(float(hh_carbon_avoided[i]), 0),
                "tokens_earned": round(float(hh_rewards[i]), 1),
            }
            for i, hh in enumerate(households)
        ],
        "events": flex_events,
    }

    with open(OUT_FLEX, "w") as f:
        json.dump(flex_output, f, indent=2)

    # --- Write households.json (per-HH time series for frontend) -----------
    hh_timeseries = {
        "timestamps": timestamps,
        "intensities": [int(x) for x in intensities],
        "high_threshold": HIGH_THRESHOLD,
        "households": [],
    }
    for hi, hh in enumerate(households):
        hh_timeseries["households"].append({
            "id": hh["id"],
            "peak_demand_kw": hh["peak_demand_kw"],
            "flex_assets": str(hh["flex_assets"]),
            "max_shift_fraction": hh["max_shift_fraction"],
            "max_shift_hours": hh["max_shift_hours"],
            "total_shifted_kwh": round(float(hh_total_shifted_kwh[hi]), 2),
            "carbon_avoided_gCO2": round(float(hh_carbon_avoided[hi]), 0),
            "tokens_earned": round(float(hh_rewards[hi]), 1),
            "pct_demand_shifted": round(
                float(hh_total_shifted_kwh[hi] / (np.sum(baseline_all[hi]) * 0.5) * 100)
                if np.sum(baseline_all[hi]) > 0 else 0, 1
            ),
            "baseline_kw": [round(float(x), 3) for x in baseline_all[hi]],
            "shifted_kw": [round(float(x), 3) for x in shifted_all[hi]],
        })
    hh_timeseries["aggregate_baseline_kw"] = [round(float(x), 2) for x in agg_baseline]
    hh_timeseries["aggregate_shifted_kw"] = [round(float(x), 2) for x in agg_shifted]

    with open(OUT_HOUSEHOLDS, "w") as f:
        json.dump(hh_timeseries, f)  # compact — this file is large

    # --- Write aggregates.csv -----------------------------------------------
    with open(OUT_AGGREGATES, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "timestamp", "intensity_gCO2", "baseline_kw", "shifted_kw",
            "curtailed_kw", "is_high_carbon",
        ])
        for t in range(n_slots):
            writer.writerow([
                timestamps[t],
                int(intensities[t]),
                round(float(agg_baseline[t]), 2),
                round(float(agg_shifted[t]), 2),
                round(float(agg_shift_amount[t]), 2),
                1 if intensities[t] >= HIGH_THRESHOLD else 0,
            ])

    # --- Console output -----------------------------------------------------
    print("FlexDAO Simulation — Comfort-Constrained Model")
    print("=" * 55)
    print(f"  Households             : {summary['n_households']}")
    print(f"  Total slots            : {summary['total_slots']}")
    print(f"  High-carbon slots      : {summary['high_carbon_slots']}")
    print(f"  Total shifted (kWh)    : {summary['total_shifted_kwh']}")
    print(f"  Avg participants/event : {summary['avg_participants_per_event']}")
    print(f"  Peak demand baseline   : {summary['peak_baseline_kw']} kW")
    print(f"  Peak demand shifted    : {summary['peak_shifted_kw']} kW")
    print(f"  Peak reduction         : {summary['peak_demand_reduction_pct']}%")
    print(f"  Carbon avoided         : {summary['total_carbon_avoided_gCO2']:.0f} gCO2")
    print(f"  FLEX tokens issued     : {summary['total_tokens_issued']}")
    print()
    print(f"✓ {OUT_FLEX}")
    print(f"✓ {OUT_HOUSEHOLDS}")
    print(f"✓ {OUT_AGGREGATES}")

    # Sample household
    top_hh = sorted(range(N_HOUSEHOLDS), key=lambda i: hh_rewards[i], reverse=True)
    i = top_hh[0]
    print(f"\nTop earner: {households[i]['id']}")
    print(f"  Assets          : {households[i]['flex_assets']}")
    print(f"  Max shift frac  : {households[i]['max_shift_fraction']*100:.0f}%")
    print(f"  Shifted (kWh)   : {hh_total_shifted_kwh[i]:.2f}")
    print(f"  Carbon avoided  : {hh_carbon_avoided[i]:.0f} gCO2")
    print(f"  Tokens earned   : {hh_rewards[i]:.1f} FLEX")

    if high_slots:
        sample = high_slots[0]
        print(f"\nSample high-carbon event:")
        print(f"  Slot     : {sample['from']} → {sample['to']}")
        print(f"  Intensity: {sample['intensity_actual']} gCO2/kWh")
        print(f"  Shifted  : {sample['aggregate_shifted_kw']} kW")
        print(f"  Responded: {len(sample['participants'])} / {N_HOUSEHOLDS}")

    return flex_output


if __name__ == "__main__":
    simulate()
