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
import uuid
import math
import shutil
from datetime import datetime, timezone
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

def percentile(values, pct):
    if not values:
        return 0.0
    vals = sorted(values)
    if len(vals) == 1:
        return float(vals[0])
    k = (len(vals) - 1) * pct
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return float(vals[int(k)])
    return float(vals[lo] + (vals[hi] - vals[lo]) * (k - lo))

def iqr_bounds(values):
    vals = [float(v) for v in values if v is not None]
    if not vals:
        return {"q1": 0.0, "q3": 0.0, "median": 0.0, "low": -math.inf, "high": math.inf}

    q1 = percentile(vals, 0.25)
    q3 = percentile(vals, 0.75)
    med = percentile(vals, 0.50)
    iqr = q3 - q1

    if iqr == 0:
        mean = sum(vals) / len(vals)
        variance = sum((v - mean) ** 2 for v in vals) / len(vals)
        std = math.sqrt(variance)
        if std == 0:
            low, high = -math.inf, math.inf
        else:
            low, high = mean - 2 * std, mean + 2 * std
    else:
        low, high = q1 - 1.5 * iqr, q3 + 1.5 * iqr

    return {
        "q1": round(q1, 3),
        "q3": round(q3, 3),
        "median": round(med, 3),
        "low": round(low, 3),
        "high": round(high, 3),
    }

def compute_dead_space_pct(points, cells=32):
    if not points:
        return 100.0

    grid = [[0 for _ in range(cells)] for _ in range(cells)]
    for px, py in points:
        gx = max(0, min(cells - 1, int((px / MINIMAP_SIZE) * cells)))
        gy = max(0, min(cells - 1, int((py / MINIMAP_SIZE) * cells)))
        grid[gy][gx] += 1

    y_start = 3 if cells > 6 else 0
    y_end = cells - 3 if cells > 6 else cells
    x_start = 3 if cells > 6 else 0
    x_end = cells - 3 if cells > 6 else cells

    dead = 0
    total = 0
    for gy in range(y_start, y_end):
        for gx in range(x_start, x_end):
            total += 1
            if grid[gy][gx] == 0:
                dead += 1

    if total == 0:
        return 0.0
    return round((dead / total) * 100, 2)

def compute_kill_cluster_pct(kill_points, cells=32):
    if not kill_points:
        return 0.0

    grid = [[0 for _ in range(cells)] for _ in range(cells)]
    for px, py in kill_points:
        gx = max(0, min(cells - 1, int((px / MINIMAP_SIZE) * cells)))
        gy = max(0, min(cells - 1, int((py / MINIMAP_SIZE) * cells)))
        grid[gy][gx] += 1

    max_cell = max(max(row) for row in grid)
    return round((max_cell / len(kill_points)) * 100, 2)

def summarize_match(match_data):
    players = match_data["players"]
    if isinstance(players, dict):
        players = list(players.values())

    humans = [p for p in players if not p.get("is_bot")]
    bots = [p for p in players if p.get("is_bot")]

    all_events = []
    all_ts = []
    human_positions = []
    kill_points = []

    for p in players:
        for pos in p.get("positions", []):
            all_ts.append(pos.get("ts", 0))
            if not p.get("is_bot"):
                human_positions.append((pos.get("px", 0.0), pos.get("py", 0.0)))
        for evt in p.get("events", []):
            all_ts.append(evt.get("ts", 0))
            all_events.append(evt)
            if evt.get("type") in ("Kill", "BotKill"):
                kill_points.append((evt.get("px", 0.0), evt.get("py", 0.0)))

    if all_ts:
        min_ts = min(all_ts)
        max_ts = max(all_ts)
        duration_sec = max(0.0, (max_ts - min_ts) / 1000.0)
    else:
        min_ts = 0
        max_ts = 0
        duration_sec = 0.0

    kills = sum(1 for e in all_events if e.get("type") in ("Kill", "BotKill"))
    deaths = sum(1 for e in all_events if e.get("type") in ("Killed", "BotKilled", "KilledByStorm"))
    storm_deaths = sum(1 for e in all_events if e.get("type") == "KilledByStorm")
    loots = sum(1 for e in all_events if e.get("type") == "Loot")

    kill_ts = [e.get("ts", 0) for e in all_events if e.get("type") in ("Kill", "BotKill")]
    if kill_ts:
        first_engage_sec = max(0.0, (min(kill_ts) - min_ts) / 1000.0)
    else:
        first_engage_sec = duration_sec

    storm_death_pct = round((storm_deaths / deaths) * 100, 2) if deaths > 0 else 0.0
    loot_per_human = round(loots / max(1, len(humans)), 2)
    dead_space_pct = compute_dead_space_pct(human_positions)
    kill_cluster_pct = compute_kill_cluster_pct(kill_points)

    return {
        "match_id": match_data["match_id"],
        "map_id": match_data["map_id"],
        "date": match_data["date"],
        "human_players": len(humans),
        "bot_players": len(bots),
        "kills": kills,
        "deaths": deaths,
        "storm_deaths": storm_deaths,
        "loots": loots,
        "duration_sec": round(duration_sec, 2),
        "first_engage_sec": round(first_engage_sec, 2),
        "storm_death_pct": storm_death_pct,
        "loot_per_human": loot_per_human,
        "dead_space_pct": dead_space_pct,
        "kill_cluster_pct": kill_cluster_pct,
    }

def build_outlier_dataset(matches):
    metric_rules = {
        "storm_death_pct": {
            "label": "Storm pressure",
            "direction": "high",
            "improve": "Review safe-route timing and extraction path readability so storm damage is less punitive.",
            "risk": "Storm Trap",
        },
        "dead_space_pct": {
            "label": "Dead space",
            "direction": "high",
            "improve": "Add objectives, loot anchors, or traversal incentives in low-traffic regions.",
            "risk": "Unused Space",
        },
        "kill_cluster_pct": {
            "label": "Combat clustering",
            "direction": "high",
            "improve": "Break choke points with alternate routes and soft cover to reduce over-stacked combat zones.",
            "risk": "Choke Dominance",
        },
        "loot_per_human": {
            "label": "Loot yield",
            "direction": "low",
            "improve": "Rebalance loot path density so players are rewarded away from dominant lanes.",
            "risk": "Low Reward",
        },
        "first_engage_sec": {
            "label": "First engagement delay",
            "direction": "high",
            "improve": "Pull early objectives inward or add encounter hooks to trigger engagement sooner.",
            "risk": "Slow Engagement",
        },
    }

    rows = [summarize_match(m) for m in matches.values()]
    rows_by_map = defaultdict(list)
    for r in rows:
        rows_by_map[r["map_id"]].append(r)

    bounds = defaultdict(dict)
    for map_id, map_rows in rows_by_map.items():
        for metric in metric_rules.keys():
            bounds[map_id][metric] = iqr_bounds([r[metric] for r in map_rows])

    outliers = []
    risk_counts = defaultdict(lambda: defaultdict(int))

    for r in rows:
        map_bounds = bounds[r["map_id"]]
        signals = []
        score = 0.0

        for metric, meta in metric_rules.items():
            val = float(r[metric])
            b = map_bounds[metric]

            if metric == "storm_death_pct" and r["deaths"] < 3:
                continue

            is_outlier = (val > b["high"]) if meta["direction"] == "high" else (val < b["low"])
            if not is_outlier:
                continue

            median = b["median"]
            spread = max(abs(b["high"] - b["low"]), 1.0)
            deviation = abs(val - median) / spread
            score += deviation

            trend = "higher" if val >= median else "lower"
            signals.append({
                "metric": metric,
                "label": meta["label"],
                "value": round(val, 2),
                "median": round(median, 2),
                "trend": trend,
                "deviation": round(deviation, 3),
                "risk": meta["risk"],
                "improve": meta["improve"],
            })
            risk_counts[r["map_id"]][meta["risk"]] += 1

        if not signals:
            continue

        signals.sort(key=lambda s: s["deviation"], reverse=True)
        top = signals[0]
        severity = "critical" if score >= 1.0 else "warning" if score >= 0.55 else "info"

        outliers.append({
            "match_id": r["match_id"],
            "map_id": r["map_id"],
            "date": r["date"],
            "severity": severity,
            "score": round(score, 3),
            "headline": f"{top['label']} is unusually {top['trend']} for {r['map_id']}",
            "takeaway": f"{top['risk']} signal detected ({top['value']} vs median {top['median']}).",
            "improve": top["improve"],
            "signals": signals,
        })

    outliers.sort(key=lambda x: x["score"], reverse=True)

    map_summaries = {}
    for map_id, map_rows in rows_by_map.items():
        map_outliers = [o for o in outliers if o["map_id"] == map_id]
        med = {
            metric: bounds[map_id][metric]["median"]
            for metric in metric_rules.keys()
        }
        top_risks = sorted(
            risk_counts[map_id].items(),
            key=lambda kv: kv[1],
            reverse=True,
        )[:3]

        map_summaries[map_id] = {
            "matches": len(map_rows),
            "outlier_matches": len(map_outliers),
            "outlier_rate_pct": round((len(map_outliers) / max(1, len(map_rows))) * 100, 1),
            "storm_match_rate_pct": round((sum(1 for mr in map_rows if mr["storm_deaths"] > 0) / max(1, len(map_rows))) * 100, 1),
            "median_metrics": med,
            "top_risks": [{"risk": k, "count": v} for k, v in top_risks],
        }

    highest_dead_space = max(map_summaries.items(), key=lambda kv: kv[1]["median_metrics"]["dead_space_pct"])[0] if map_summaries else "N/A"
    highest_storm = max(map_summaries.items(), key=lambda kv: kv[1]["storm_match_rate_pct"])[0] if map_summaries else "N/A"
    lowest_loot = min(map_summaries.items(), key=lambda kv: kv[1]["median_metrics"]["loot_per_human"])[0] if map_summaries else "N/A"
    highest_outlier = max(map_summaries.items(), key=lambda kv: kv[1]["outlier_rate_pct"])[0] if map_summaries else "N/A"

    quick_takeaways = []
    if map_summaries:
        quick_takeaways.append(
            f"{highest_dead_space} has the highest dead-space median ({map_summaries[highest_dead_space]['median_metrics']['dead_space_pct']}%)."
        )
        quick_takeaways.append(
            f"{highest_storm} has the highest storm-affected match rate ({map_summaries[highest_storm]['storm_match_rate_pct']}%)."
        )
        quick_takeaways.append(
            f"{lowest_loot} has the lowest loot yield ({map_summaries[lowest_loot]['median_metrics']['loot_per_human']} loot per human)."
        )
        quick_takeaways.append(
            f"{highest_outlier} has the highest outlier concentration ({map_summaries[highest_outlier]['outlier_rate_pct']}% of matches flagged)."
        )
    quick_takeaways.append(f"Flagged {len(outliers)} outlier matches out of {len(rows)} total matches ({round((len(outliers)/max(1,len(rows)))*100, 1)}%).")

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_matches": len(rows),
        "outlier_matches": len(outliers),
        "quick_takeaways": quick_takeaways,
        "map_summaries": map_summaries,
        "top_outliers": outliers[:30],
        "outliers": outliers,
    }

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

    print("🧠 Building outlier insight dataset…")
    outlier_dataset = build_outlier_dataset(matches)

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

    outlier_path = os.path.join(DATA_DIR, "outliers.json")
    with open(outlier_path, "w") as f:
        json.dump(outlier_dataset, f, indent=2)
    print("✅ outliers.json written")

    print("\n🎉 Done! Data is ready in ./data/")


if __name__ == "__main__":
    process_all()
