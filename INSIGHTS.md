# Dataset Insights for Level Design

Scope: 796 matches from Feb 10-14, 2026, using aggregated match telemetry.

## Insight 1 - Lockdown is under-utilized and under-rewarded in this sample

### What caught my eye
Lockdown combines the highest dead-space median with the lowest loot-per-human median.

### Concrete evidence
- Dead-space median: Lockdown 96.89%, AmbroseValley 96.75%, GrandRift 95.41%.
- Loot per human median: Lockdown 12.0, GrandRift 13.0, AmbroseValley 15.0.

### Actionable takeaway
Yes.

Metrics likely affected:
- dead_space_pct (target down)
- loot_per_human (target up)

Action items:
1. Add loot anchors and secondary objectives in low-traffic sectors.
2. Improve route readability to move players into currently ignored space.
3. Validate after change with dead-space heat and zone-rollup movement share.

### Why a level designer should care
This points to inefficient map usage: production space is built but rarely visited, while rewards are concentrated elsewhere.

---

## Insight 2 - Storm pressure is map-dependent and highest on Lockdown in this dataset

### What caught my eye
Storm-affected matches cluster more on Lockdown and GrandRift than on AmbroseValley.

### Concrete evidence
- Storm-affected match rate: Lockdown 9.9%, GrandRift 8.5%, AmbroseValley 3.0%.

### Actionable takeaway
Yes.

Metrics likely affected:
- storm_match_rate_pct (target down where excessive)
- storm_death_pct (target down)
- extraction success proxy via lower storm-only death concentration

Action items:
1. Re-check storm timing and directional sweep against extraction path lengths.
2. Add clearer safe-route cues and recovery corridors where storm traps occur.
3. Track storm-match-rate delta before/after tuning by map.

### Why a level designer should care
Over-punitive storm flow can dominate outcomes and reduce meaningful combat and navigation decisions.

---

## Feature Update - Multi-Heatmap Overlap Explorer (Designer Tool 01)

### What this feature does
The map now supports selecting and overlaying multiple heatmaps at once (Kill Zones, Death Zones, Traffic, Loot Zones, Storm Deaths), instead of forcing one layer at a time.

When multiple layers are active:
- The system detects overlap hotspots (areas where 2+ selected heatmaps are simultaneously high).
- The system also flags isolated hotspots (areas where one selected heatmap is high but others are weak).
- Marker icons are drawn directly on the map at those locations.
- Hovering a marker shows context in-place:
  - overlap type(s)
  - approximate location on the map
  - per-layer intensity counts
  - a short corrective design insight

### Why a level designer should care
This compresses a multi-step analysis workflow into a single visual pass. Instead of manually switching layers and mentally aligning hotspots, designers can immediately see where systems reinforce each other or conflict.

Practical level-design value:
1. Detect risk-reward imbalance faster:
	- High loot + low combat often indicates over-safe reward pockets.
	- High combat + low loot often indicates punishing, low-payoff chokepoints.
2. Validate intended conflict architecture:
	- Confirms whether high-value routes are truly contested.
3. Guide targeted redistribution:
	- Move loot, add routes, or reshape sightlines based on exact overlap cells.
4. Reduce blind tuning:
	- Hover markers provide evidence and rationale at the precise problem location.

### Recommended design loop
1. Select 2 to 4 heatmaps that match the question (for example Loot + Kill + Traffic).
2. Inspect overlap and isolated markers on-map.
3. Apply local map changes (loot anchor, route branching, encounter pressure).
4. Re-run and compare marker density/placement until hotspots align with intended pacing.


