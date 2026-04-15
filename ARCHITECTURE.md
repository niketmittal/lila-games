# Player Journey Visualization Tool - Architecture

## What I built and why

| Layer | Tech | Why |
|---|---|---|
| Data pipeline | Python, PyArrow, Pandas | Best fit for parquet parsing and fast batch processing. |
| API | Flask | Lightweight API for serving prepared JSON quickly. |
| Frontend | HTML, CSS, JavaScript, Canvas 2D | Simple stack, good performance for dense map drawing. |
| Hosting | Render + Gunicorn | Easy deployment for a Python web app. |

## Data flow (simple)

1. Read parquet files from [player_data](player_data).
2. Transform each row in [process_data.py](process_data.py):
	- decode event bytes
	- convert world coordinates to minimap pixels
	- normalize timestamps
3. Write prepared outputs:
	- [data/index.json](data/index.json)
	- [data/matches](data/matches)
	- [data/heatmaps](data/heatmaps)
4. Serve data with [server.py](server.py):
	- `/api/index`
	- `/api/match/<id>`
	- `/api/heatmap/<map>/<event>`
5. Frontend [frontend/app.js](frontend/app.js) renders minimap, timeline, and heatmaps.

## Coordinate mapping (important part)

Each map has:
- `scale`
- `origin_x`
- `origin_z`

For every world point `(x, z)`:

- `u = (x - origin_x) / scale`
- `v = (z - origin_z) / scale`
- `pixel_x = u * 1024`
- `pixel_y = (1 - v) * 1024`

Why this works:
- translate into map-local coordinates
- normalize into `[0, 1]`
- convert to minimap pixels
- flip Y because image space is top-left origin

Implementation is in [process_data.py](process_data.py).

## Assumptions and ambiguity handling

1. Timestamps are treated as match-time ordering values.
2. Elevation `y` is ignored for 2D minimap rendering.
3. Missing heatmap files for sparse event/map combos are treated as no-data, not hard errors.

## Major tradeoffs

| Topic | Choice | Tradeoff |
|---|---|---|
| Query model | Precompute JSON files | Faster UI and simpler backend, but data refresh needs a re-run. |
| Rendering | Canvas 2D | Better performance for many points, less built-in DOM interactivity. |

## How easy is it to add more data and re-run?

Very easy. Current pipeline is batch-based and deterministic.

1. Add new parquet files into [player_data](player_data) (new day folder or existing day folder).
2. Re-run:
	- `python process_data.py`
3. This rebuilds [data/index.json](data/index.json), [data/matches](data/matches), and [data/heatmaps](data/heatmaps).
4. Restart server (`python server.py`) so the latest files are served.

No schema migration or database step is required.

## Three things learned from the tool

1. Lockdown has the highest dead-space median and the lowest loot yield per human in this sample.
2. Lockdown has the highest storm-affected match rate, with GrandRift next.
