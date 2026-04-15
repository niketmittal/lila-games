"""
server.py – LILA BLACK Player Journey Visualization API
Flask backend serving pre-processed match/heatmap JSON and the frontend.
"""

import os
from flask import Flask, jsonify, send_from_directory, abort
from flask_cors import CORS

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DATA_DIR   = os.path.join(BASE_DIR, "data")
MATCH_DIR  = os.path.join(DATA_DIR, "matches")
HEAT_DIR   = os.path.join(DATA_DIR, "heatmaps")
FRONT_DIR  = os.path.join(BASE_DIR, "frontend")
MINI_DIR   = os.path.join(BASE_DIR, "minimaps")

app = Flask(__name__, static_folder=FRONT_DIR, static_url_path="/static")
CORS(app)

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

def get_index():
    global _index_cache
    if _index_cache is None:
        _index_cache = load_json(os.path.join(DATA_DIR, "index.json"))
    return _index_cache

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

# ── Run ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
