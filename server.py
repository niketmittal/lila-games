"""
server.py – LILA BLACK Player Journey Visualization API
Flask backend serving pre-processed match/heatmap JSON and the frontend.
"""

import os
import re
from flask import Flask, jsonify, send_from_directory, abort, request
from flask_cors import CORS

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DATA_DIR   = os.path.join(BASE_DIR, "data")
MATCH_DIR  = os.path.join(DATA_DIR, "matches")
HEAT_DIR   = os.path.join(DATA_DIR, "heatmaps")
FRONT_DIR  = os.path.join(BASE_DIR, "frontend")
MINI_DIR   = os.path.join(BASE_DIR, "minimaps")

app = Flask(__name__, static_folder=FRONT_DIR, static_url_path="/static")
CORS(app)

GRID_CELLS = 32
GRID_SIZE = GRID_CELLS * GRID_CELLS
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# ── Frontend ─────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(FRONT_DIR, "index.html")

@app.route("/frontend/<path:filename>")
def frontend_static(filename):
    return send_from_directory(FRONT_DIR, filename)

# ── Minimaps ──────────────────────────────────────────────────────────────────

@app.route("/minimaps/<path:filename>")
def minimap(filename):
    return send_from_directory(MINI_DIR, filename)

# ── Data API ──────────────────────────────────────────────────────────────────

import json

def load_json(path):
    with open(path, "r") as f:
        return json.load(f)

_index_cache = None
_match_metrics_cache = {}

def get_index():
    global _index_cache
    if _index_cache is None:
        _index_cache = load_json(os.path.join(DATA_DIR, "index.json"))
    return _index_cache

def _cell_from_point(px, py):
    try:
        fx = float(px)
        fy = float(py)
    except (TypeError, ValueError):
        return None

    if fx < 0 or fx > 1024 or fy < 0 or fy > 1024:
        return None

    gx = min(GRID_CELLS - 1, max(0, int((fx / 1024) * GRID_CELLS)))
    gy = min(GRID_CELLS - 1, max(0, int((fy / 1024) * GRID_CELLS)))
    return gx, gy

def _compute_match_metrics(match_id):
    if match_id in _match_metrics_cache:
        return _match_metrics_cache[match_id]

    match_path = os.path.join(MATCH_DIR, f"{match_id}.json")
    if not os.path.exists(match_path):
        return None

    match_data = load_json(match_path)
    players = match_data.get("players", [])
    humans = [p for p in players if not p.get("is_bot", False)]

    visited_cells = set()
    loot_cells = set()
    kill_cells = set()
    loot_events = 0
    kill_events = 0
    movement_samples = 0

    for player in humans:
        for pos in player.get("positions", []):
            cell = _cell_from_point(pos.get("px"), pos.get("py"))
            if cell is None:
                continue
            visited_cells.add(cell)
            movement_samples += 1

        for evt in player.get("events", []):
            cell = _cell_from_point(evt.get("px"), evt.get("py"))
            if cell is None:
                continue

            evt_type = evt.get("type")
            if evt_type == "Loot":
                loot_events += 1
                loot_cells.add(cell)
            elif evt_type in ("Kill", "BotKill"):
                kill_events += 1
                kill_cells.add(cell)

    human_count = len(humans)
    visited_count = len(visited_cells)

    dead_space_pct = 100.0 * (1.0 - (visited_count / GRID_SIZE))
    map_work_pct = 100.0 - dead_space_pct
    loot_space_pct = 100.0 * (len(loot_cells) / GRID_SIZE)
    kill_space_pct = 100.0 * (len(kill_cells) / GRID_SIZE)
    loot_per_human = (loot_events / human_count) if human_count > 0 else 0.0

    metrics = {
        "map_work_pct": map_work_pct,
        "dead_space_pct": dead_space_pct,
        "loot_space_pct": loot_space_pct,
        "kill_space_pct": kill_space_pct,
        "loot_per_human": loot_per_human,
        "kills_per_match": float(kill_events),
        "humans_per_match": float(human_count),
        "movement_samples_per_match": float(movement_samples),
    }

    _match_metrics_cache[match_id] = metrics
    return metrics

def _aggregate_range_metrics(match_ids):
    if not match_ids:
        return {
            "map_work_pct": 0.0,
            "dead_space_pct": 0.0,
            "loot_space_pct": 0.0,
            "kill_space_pct": 0.0,
            "loot_per_human": 0.0,
            "kills_per_match": 0.0,
            "humans_per_match": 0.0,
            "movement_samples_per_match": 0.0,
        }

    acc = {
        "map_work_pct": 0.0,
        "dead_space_pct": 0.0,
        "loot_space_pct": 0.0,
        "kill_space_pct": 0.0,
        "loot_per_human": 0.0,
        "kills_per_match": 0.0,
        "humans_per_match": 0.0,
        "movement_samples_per_match": 0.0,
    }

    used = 0
    for mid in match_ids:
        m = _compute_match_metrics(mid)
        if not m:
            continue
        used += 1
        for key in acc:
            acc[key] += m.get(key, 0.0)

    if used == 0:
        return {k: 0.0 for k in acc}

    return {k: round(v / used, 3) for k, v in acc.items()}

def _collect_range_match_ids(map_id, start_date, end_date):
    map_index = get_index().get(map_id, {})
    date_keys = sorted(map_index.keys())
    matched_dates = [d for d in date_keys if start_date <= d <= end_date]
    match_ids = []
    for d in matched_dates:
        match_ids.extend(map_index.get(d, []))
    return sorted(set(match_ids)), matched_dates

@app.route("/api/index")
def api_index():
    return jsonify(get_index())

@app.route("/api/match/<match_id>")
def api_match(match_id):
    # Sanitize
    if not all(c.isalnum() or c in "-." for c in match_id):
        abort(400)
    path = os.path.join(MATCH_DIR, f"{match_id}.json")
    if not os.path.exists(path):
        abort(404)
    return send_from_directory(MATCH_DIR, f"{match_id}.json",
                               mimetype="application/json")

@app.route("/api/heatmap/<map_id>/<event_type>")
def api_heatmap(map_id, event_type):
    safe_map = map_id.replace("/", "_").replace("..", "")
    safe_evt = event_type.replace("/", "_").replace("..", "")
    fname = f"{safe_map}_{safe_evt}.json"
    path  = os.path.join(HEAT_DIR, fname)
    if not os.path.exists(path):
        abort(404)
    return send_from_directory(HEAT_DIR, fname, mimetype="application/json")

@app.route("/api/range-metrics/<map_id>")
def api_range_metrics(map_id):
    idx = get_index()
    if map_id not in idx:
        abort(404)

    map_dates = sorted(idx.get(map_id, {}).keys())
    if not map_dates:
        return jsonify({
            "map_id": map_id,
            "start": None,
            "end": None,
            "match_count": 0,
            "dates_covered": [],
            "metrics": _aggregate_range_metrics([]),
        })

    start = request.args.get("start", map_dates[0])
    end = request.args.get("end", map_dates[-1])

    if not DATE_RE.match(start) or not DATE_RE.match(end):
        abort(400)

    if start > end:
        abort(400)

    match_ids, matched_dates = _collect_range_match_ids(map_id, start, end)
    metrics = _aggregate_range_metrics(match_ids)

    return jsonify({
        "map_id": map_id,
        "start": start,
        "end": end,
        "match_count": len(match_ids),
        "dates_covered": matched_dates,
        "metrics": metrics,
    })

# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
