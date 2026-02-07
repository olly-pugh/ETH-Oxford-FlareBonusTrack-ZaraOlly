#!/usr/bin/env python3
"""
FlexDAO — Step 1: Fetch 7-day carbon intensity from the UK National Grid API.

Data source (real Web2):
  https://api.carbonintensity.org.uk/intensity/{from}/{to}

Outputs:
  backend/data/carbon_week.json   — array of {from, to, intensity} objects
"""

import json
import os
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

DATA_DIR = Path(__file__).resolve().parent / "data"
OUT_FILE = DATA_DIR / "carbon_week.json"
FALLBACK_FILE = DATA_DIR / "carbon_week_fallback.json"
API_BASE = "https://api.carbonintensity.org.uk/intensity"


def round_down_half_hour(dt: datetime) -> datetime:
    """Round a datetime DOWN to the nearest half-hour boundary."""
    minute = 0 if dt.minute < 30 else 30
    return dt.replace(minute=minute, second=0, microsecond=0)


def fetch_carbon_week():
    """Fetch 7 days of half-hourly carbon intensity data."""
    now_utc = datetime.now(timezone.utc)
    end = round_down_half_hour(now_utc)
    start = end - timedelta(days=7)

    iso_fmt = "%Y-%m-%dT%H:%MZ"
    url = f"{API_BASE}/{start.strftime(iso_fmt)}/{end.strftime(iso_fmt)}"

    print(f"Fetching carbon intensity data …")
    print(f"  Window : {start.isoformat()} → {end.isoformat()}")
    print(f"  URL    : {url}")

    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        payload = resp.json()
        data = payload.get("data", [])
        if not data:
            raise ValueError("API returned empty data array")
    except Exception as exc:
        print(f"\n⚠  API call failed: {exc}")
        if FALLBACK_FILE.exists():
            shutil.copy(FALLBACK_FILE, OUT_FILE)
            print(f"   Used fallback → {OUT_FILE}")
            with open(OUT_FILE) as f:
                data = json.load(f)
            _print_summary(data)
            return data
        else:
            print("   No fallback file found. Exiting.")
            sys.exit(1)

    # Normalise to a flat list of dicts
    records = []
    for entry in data:
        records.append({
            "from": entry["from"],
            "to": entry["to"],
            "intensity": entry["intensity"],  # {forecast, actual, index}
        })

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w") as f:
        json.dump(records, f, indent=2)
    print(f"\n✓ Saved {len(records)} data points → {OUT_FILE}")

    # Also save as fallback for future offline use
    shutil.copy(OUT_FILE, FALLBACK_FILE)

    _print_summary(records)
    return records


def _print_summary(records):
    """Pretty-print count and first 2 entries."""
    print(f"\nTotal data points: {len(records)}")
    print("\nFirst 2 entries:")
    for entry in records[:2]:
        print(json.dumps(entry, indent=2))


if __name__ == "__main__":
    fetch_carbon_week()
