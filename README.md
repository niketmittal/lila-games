# LILA BLACK Player Journey Visualizer

Deployed URL: http://lila-games-mu.vercel.app/

Interactive level-design analysis tool for visualizing player movement, combat, loot, and storm patterns on game minimaps.

It includes:
- timeline playback for match journeys
- event overlays (kills, deaths, loot, storm, bot events)
- heatmap overlays
- multi-heatmap overlap markers with hover insights for map balancing decisions

## Tech Stack

### Backend
- Python 3.11+
- Flask
- Flask-CORS
- Gunicorn (production)

### Data Processing
- Pandas
- PyArrow

### Frontend
- Vanilla JavaScript
- HTML/CSS
- Canvas 2D rendering

## Project Structure

```text
.
├── server.py                 # Flask API + static file serving
├── process_data.py           # Parquet -> JSON data pipeline
├── requirements.txt
├── Procfile                  # Gunicorn startup for PaaS
├── render.yaml               # Render deployment config
├── data/
│   ├── index.json
│   ├── matches/
│   └── heatmaps/
├── player_data/              # Raw source data (day folders)
├── minimaps/                 # Minimap images per map
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── ARCHITECTURE.md
└── INSIGHTS.md
```

## Prerequisites

- Python 3.11 or newer
- `pip`
- Recommended: virtual environment (`venv`)

## Local Setup

### 1. Create and activate a virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Prepare data (if you need to regenerate from raw parquet)

This step rebuilds `data/index.json`, `data/matches/`, and `data/heatmaps/`.

```bash
python process_data.py
```

If your `data/` folder is already present and up to date, you can skip this step.

### 4. Run the app locally

```bash
python server.py
```

Open:
- `http://127.0.0.1:5000/`

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `5000` | Port for Flask dev server and production runtime binding. |
| `PYTHON_VERSION` | No (local), Yes (Render config) | `3.11.0` in `render.yaml` | Python runtime version for Render deployment. |

Notes:
- The app does not require database credentials or API keys.
- CORS is enabled in `server.py`.

## API Endpoints

Base URL: `http://127.0.0.1:5000`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Main frontend page |
| `GET` | `/frontend/<path:filename>` | Frontend static assets |
| `GET` | `/minimaps/<path:filename>` | Minimap image assets |
| `GET` | `/api/index` | Map/date to match-id index |
| `GET` | `/api/match/<match_id>` | Match details (players, positions, events) |
| `GET` | `/api/heatmap/<map_id>/<event_type>` | Heatmap point list for a map + event type |

Examples:

```bash
curl http://127.0.0.1:5000/api/index
curl http://127.0.0.1:5000/api/match/00b34c64-8746-44aa-b527-72ac0d971251
curl http://127.0.0.1:5000/api/heatmap/AmbroseValley/Kill
```

## Production Run

Gunicorn startup command:

```bash
gunicorn server:app
```

`Procfile` already contains:

```text
web: gunicorn server:app
```

## Deploying on Render

This repo includes `render.yaml` with:
- build: `pip install -r requirements.txt`
- start: `gunicorn server:app`
- runtime: Python
- `PYTHON_VERSION=3.11.0`

Typical flow:
1. Push repository to GitHub.
2. Create a new Render Web Service from the repo.
3. Use the existing `render.yaml` blueprint.

## Data Pipeline Notes

`process_data.py`:
- reads raw parquet files from `player_data/`
- converts world coordinates to minimap pixel coordinates
- classifies humans vs bots
- emits:
  - `data/index.json`
  - `data/matches/<match_id>.json`
  - `data/heatmaps/<map_id>_<event_type>.json`

The frontend relies on these generated JSON outputs.

## Troubleshooting

### Server exits with code 137

Exit code `137` usually means the process was killed (resource pressure or external kill).

Try:
1. Ensure no conflicting process is occupying the same port.
2. Restart in a clean shell with the venv activated.
3. Run with fewer background processes if memory is constrained.

### Heatmaps or matches not loading

1. Confirm `data/index.json` exists.
2. Confirm corresponding files exist under `data/matches/` and `data/heatmaps/`.
3. Rebuild with `python process_data.py` if needed.

### Frontend loads but map data is empty

1. Verify minimap files exist under `minimaps/`.
2. Verify map IDs in data align with `MAP_CONFIG` in `process_data.py`.

## Additional Docs

- `ARCHITECTURE.md` - system and data flow notes
- `INSIGHTS.md` - level design findings and feature rationale