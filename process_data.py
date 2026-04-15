#!/usr/bin/env python3
"""
process_data.py
Reads all parquet files from player_data/ and outputs structured JSON
into data/index.json, data/matches/, and data/heatmaps/.
Run once locally before deploying.
"""

import os
import re
import json
import shutil
from collections import defaultdict

import pyarrow.parquet as pq
import pandas as pd

# ── Map config ──────────────────────────────────────────────────────────────
MAP_CONFIG = {
    "AmbroseValley": {"scale": 900, "origin_x": -370, "origin_z": -473},
    "GrandRift":     {"scale": 581, "origin_x": -290, "origin_z": -290},
    "Lockdown":      {"scale": 1000, "origin_x": -500, "origin_z": -500},
}

MINIMAP_SIZE = 1024

def world_to_pixel(x, z, map_id):
    cfg = MAP_CONFIG[map_id]
    u = (x - cfg["origin_x"]) / cfg["scale"]
    v = (z - cfg["origin_z"]) / cfg["scale"]
    px = round(u * MINIMAP_SIZE, 2)
    py = round((1 - v) * MINIMAP_SIZE, 2)
    return px, py

# ── Player-type detection ────────────────────────────────────────────────────
UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE
)

def is_human(user_id):
    return bool(UUID_RE.match(str(user_id)))

# ── Day folder → date string ─────────────────────────────────────────────────
MONTH_MAP = {
    "February": "02"
}

def folder_to_date(folder_name):
    """'February_10' → '2026-02-10'"""
    parts = folder_name.split("_")
    if len(parts) == 2:
        month_str, day_str = parts
        month_num = MONTH_MAP.get(month_str, "01")
        return f"2026-{month_num}-{int(day_str):02d}"
    return folder_name

# ── Assign stable colors ──────────────────────────────────────────────────────
HUMAN_COLORS = [
    "#00e5ff","#ff6b6b","#69ff47","#ffd93d","#c77dff",
    "#ff9f1c","#2ec4b6","#e71d36","#b5e48c","#f72585",
    "#4cc9f0","#fb8500","#8ecae6","#a8dadc","#457b9d",
]
BOT_COLORS = [
    "#555566","#664455","#445566","#556644","#665544",
]

# ── Main processing ──────────────────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DATA_DIR   = os.path.join(BASE_DIR, "data")
MATCH_DIR  = os.path.join(DATA_DIR, "matches")
HEAT_DIR   = os.path.join(DATA_DIR, "heatmaps")
PLAYER_DIR = os.path.join(BASE_DIR, "player_data")

def clean_output():
    if os.path.exists(DATA_DIR):
        shutil.rmtree(DATA_DIR)
    os.makedirs(MATCH_DIR, exist_ok=True)
    os.makedirs(HEAT_DIR, exist_ok=True)
    print("Output directories ready.")


def process_all():
    clean_output()

    # index: { map_id: { date: Set(match_id) } }
    index = defaultdict(lambda: defaultdict(set))

    # heatmap accumulator: { map_id: { event_type: [(px,py), ...] } }
    heatmaps = defaultdict(lambda: defaultdict(list))

    # match accumulator: { match_id: { date, map_id, players: {user_id: player_obj} } }
    matches = {}

    # color counters
    human_color_idx = defaultdict(int)
    bot_color_idx   = defaultdict(int)
    player_colors   = {}  # user_id → color

    day_folders = sorted([
        d for d in os.listdir(PLAYER_DIR)
        if os.path.isdir(os.path.join(PLAYER_DIR, d)) and not d.startswith(".")
    ])

    total_files = 0
    skipped = 0

    for day_folder in day_folders:
        date_str = folder_to_date(day_folder)
        day_path = os.path.join(PLAYER_DIR, day_folder)
        files = [f for f in os.listdir(day_path) if not f.startswith(".")]

        print(f"\n📅 {day_folder} ({date_str}) — {len(files)} files")

        for fname in files:
            fpath = os.path.join(day_path, fname)
            total_files += 1

            # Parse filename: remove .nakama-0 suffix, split on first underscore
            stem = fname.replace(".nakama-0", "")
            # user_id is everything up to the first "_" that separates it from match uuid
            # Match UUID always starts at position where a UUID-like string begins
            # Strategy: find the last occurrence of a UUID-shaped group
            # Filename format: {user_id}_{match_id}
            # match_id is always a UUID, user_id is UUID or numeric
            parts = stem.split("_")
            if len(parts) < 2:
                skipped += 1
                continue

            # Reconstruct: match_id is the last 5 UUID segments (joined by -)
            # For numeric user_id: "1440_d7e50fad-fb7a-4ed4-932f-e4ca9ff0c97b"
            # → parts = ["1440", "d7e50fad-fb7a-4ed4-932f-e4ca9ff0c97b"]
            # For UUID user_id: "f4e072fa-b7af-4761-b567-1d95b7ad0108_b71aaad8-aa62-4b3a-8534-927d4de18f22"
            # → parts = ["f4e072fa-b7af-4761-b567-1d95b7ad0108", "b71aaad8-aa62-4b3a-8534-927d4de18f22"]
            match_id = parts[-1]
            user_id  = "_".join(parts[:-1])

            human = is_human(user_id)

            # Assign a stable color per user
            if user_id not in player_colors:
                if human:
                    ci = len([k for k in player_colors if is_human(k)])
                    player_colors[user_id] = HUMAN_COLORS[ci % len(HUMAN_COLORS)]
                else:
                    ci = len([k for k in player_colors if not is_human(k)])
                    player_colors[user_id] = BOT_COLORS[ci % len(BOT_COLORS)]

            # Read parquet
            try:
                table = pq.read_table(fpath)
                df = table.to_pandas()
            except Exception as e:
                print(f"  ⚠ skipping {fname}: {e}")
                skipped += 1
                continue

            if df.empty:
                skipped += 1
                continue

            # Decode event bytes
            df["event"] = df["event"].apply(
                lambda x: x.decode("utf-8") if isinstance(x, (bytes, bytearray)) else str(x)
            )

            # Get map_id from data (use first row)
            map_id = df["map_id"].iloc[0]
            if map_id not in MAP_CONFIG:
                skipped += 1
                continue

            # Convert coords
            df["px"] = 0.0
            df["py"] = 0.0
            for i, row in df.iterrows():
                px, py = world_to_pixel(float(row["x"]), float(row["z"]), map_id)
                df.at[i, "px"] = px
                df.at[i, "py"] = py

            # Preserve event time in milliseconds so cross-player ordering stays valid.
            ts_series = pd.to_datetime(df["ts"], errors="coerce")
            valid_ts = ts_series.notna()
            if not valid_ts.any():
                skipped += 1
                continue
            df = df[valid_ts].copy()
            ts_series = ts_series[valid_ts]
            # Convert timestamps to integer milliseconds regardless source time unit.
            df["ts_ms"] = ts_series.astype("datetime64[ms]").astype("int64")

            # Sort by time
            df = df.sort_values("ts_ms")

            # Positions vs events
            pos_events   = {"Position", "BotPosition"}
            combat_events = {"Kill", "Killed", "BotKill", "BotKilled", "KilledByStorm", "Loot"}

            positions = df[df["event"].isin(pos_events)][["px","py","ts_ms"]].copy()
            events    = df[df["event"].isin(combat_events)][["event","px","py","ts_ms"]].copy()

            pos_list = [
                {"px": round(r.px, 1), "py": round(r.py, 1), "ts": int(r.ts_ms)}
                for r in positions.itertuples()
            ]
            evt_list = [
                {"type": r.event, "px": round(r.px, 1), "py": round(r.py, 1), "ts": int(r.ts_ms)}
                for r in events.itertuples()
            ]

            # Accumulate into match
            if match_id not in matches:
                matches[match_id] = {
                    "match_id": match_id,
                    "map_id":   map_id,
                    "date":     date_str,
                    "players":  {}
                }

            matches[match_id]["players"][user_id] = {
                "user_id":  user_id,
                "is_bot":   not human,
                "color":    player_colors[user_id],
                "positions": pos_list,
                "events":    evt_list,
            }

            # Index
            index[map_id][date_str].add(match_id)

            # Heatmap accumulation (for kill zones, death zones, traffic)
            for r in events.itertuples():
                heatmaps[map_id][r.event].append([round(r.px, 1), round(r.py, 1)])

            # Traffic = all positions
            for r in positions.itertuples():
                heatmaps[map_id]["Position"].append([round(r.px, 1), round(r.py, 1)])

    print(f"\n✅ Processed {total_files - skipped} files, skipped {skipped}")
    print(f"   Matches: {len(matches)}, Maps: {list(index.keys())}")

    # ── Write match files ────────────────────────────────────────────────────
    print("\n💾 Writing match files…")
    for mid, mdata in matches.items():
        mdata["players"] = list(mdata["players"].values())
        out_path = os.path.join(MATCH_DIR, f"{mid}.json")
        with open(out_path, "w") as f:
            json.dump(mdata, f, separators=(",", ":"))

    # ── Write index ──────────────────────────────────────────────────────────
    index_out = {}
    for map_id, dates in index.items():
        index_out[map_id] = {}
        for date_str, match_set in dates.items():
            index_out[map_id][date_str] = sorted(match_set)

    with open(os.path.join(DATA_DIR, "index.json"), "w") as f:
        json.dump(index_out, f, indent=2)
    print("✅ index.json written")

    # ── Write heatmap files ──────────────────────────────────────────────────
    print("💾 Writing heatmap files…")
    for map_id, evt_map in heatmaps.items():
        for evt_type, points in evt_map.items():
            safe_evt = evt_type.replace("/", "_")
            out_path = os.path.join(HEAT_DIR, f"{map_id}_{safe_evt}.json")
            with open(out_path, "w") as f:
                json.dump(points, f, separators=(",", ":"))
    print("✅ Heatmap files written")

    print("\n🎉 Done! Data is ready in ./data/")


if __name__ == "__main__":
    process_all()
