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

