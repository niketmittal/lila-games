# Dataset Insights for Level Design

Scope: 796 matches from Feb 10-14, 2026, using aggregated match telemetry.

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

---

## Feature Update - Date Range Metrics Comparator (Designer Tool 02)

### What this feature does
Tool 02 lets designers compare two date ranges on the same map:
- Before Change range (baseline)
- After Change range (post-update)

It aggregates map-level metrics for each range and shows the delta so designers can quickly verify whether a map edit actually improved outcomes.

### How a level designer uses it
UI location:
- Tool 02 is shown below the play/timeline controls in the main panel.

Steps:
1. Select a map.
2. In Tool 02, choose Before Change start/end dates.
3. Choose After Change start/end dates.
4. Click Compare Ranges.
5. Review per-metric before/after values and delta badges.

### How to interpret the metrics
Primary effectiveness metrics:
1. Map Utilization (%): higher is better.
	- Indicates how much of the map is being actively used.
2. Dead Space (%): lower is better.
	- Indicates how much of the map remains unvisited.
3. Loot Space (%): higher is usually better (up to balance limits).
	- Indicates how widely loot interaction is distributed across the map.

Supporting metrics:
1. Loot per Human: higher generally indicates stronger reward density per run.
2. Kills per Match: context metric for engagement intensity (not always strictly "higher is better").

### Example validation questions this answers
After a layout or loot pass, designers can verify:
1. Did dead space reduce after the change?
2. Did map utilization increase in ignored sectors?
3. Did loot space improve without over-concentrating combat?
4. Did engagement move toward intended pacing?

### Why this matters in production
Tool 02 converts subjective map-feel judgments into measurable before/after evidence. That helps teams:
1. confirm whether a change worked,
2. avoid repeating ineffective iterations,
3. prioritize the next tuning pass based on real movement and reward outcomes.

---

## Insight 3 - Future Work: Combined Tool 01 + Tool 02 Lens

### Concept
Future work is to combine Tool 01 (spatial overlap hotspots) and Tool 02 (before/after date-range deltas) into a single validation workflow.

### What this combined insight would answer
1. Which exact overlap hotspots changed after a design update?
2. Did targeted hotspot fixes reduce dead space in the intended sectors?
3. Did loot distribution improve without creating low-risk, high-reward pockets?
4. Did map utilization and engagement move in the expected direction together?

### Why this is valuable
Tool 01 tells designers where the structural problem is on the map, and Tool 02 tells designers whether the latest change improved global outcomes over time.

Combining them would create a stronger cause-and-effect loop:
1. Identify problematic overlap zones.
2. Apply localized map changes.
3. Measure range-based metric movement.
4. Confirm whether the local fix produced the intended global impact.

### Expected designer impact
This would reduce trial-and-error iteration by connecting hotspot-level diagnosis to date-range performance evidence in one continuous decision path.


