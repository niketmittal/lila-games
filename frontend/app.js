/**
 * app.js – LILA BLACK Player Journey Visualizer
 * Heatmaps, multi-layer overlap markers, prev/next match navigation.
 */

"use strict";

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const MINIMAP_EXT = {
  AmbroseValley: "png",
  GrandRift:     "png",
  Lockdown:      "jpg",
};

const EVENT_STYLE = {
  Kill:          { color: "#ff9f1c", label: "⚔",  radius: 7 },
  Killed:        { color: "#ff4444", label: "✕",  radius: 7 },
  BotKill:       { color: "#ffd93d", label: "★",  radius: 6 },
  BotKilled:     { color: "#c77dff", label: "✕",  radius: 5 },
  KilledByStorm: { color: "#a855f7", label: "⚡", radius: 7 },
  Loot:          { color: "#4ade80", label: "◆",  radius: 5 },
};

// Keep track color aligned with legend marker color for maximum readability.
const TRACK_COLOR = "#00e5ff";

const EVT_CHECKBOX_MAP = {
  Kill:          "evtKill",
  Killed:        "evtKilled",
  BotKill:       "evtBotKill",
  BotKilled:     "evtBotKilled",
  KilledByStorm: "evtStorm",
  Loot:          "evtLoot",
};

// Heatmap types: button -> one or more event types to combine.
const HEAT_SOURCES = {
  KillZones:    ["Kill", "BotKill"],
  DeathZones:   ["Killed", "BotKilled"],
  Traffic:      ["Position"],
  LootZones:    ["Loot"],
  StormDeaths:  ["KilledByStorm"],
};

const HEAT_LABELS = {
  KillZones:   "Kill Zones",
  DeathZones:  "Death Zones",
  Traffic:     "Traffic",
  LootZones:   "Loot Zones",
  StormDeaths: "Storm Deaths",
};

// Per-heatmap color mapping (uses existing theme variables).
// Requested mapping: kills=red, loot=green, storm=purple, traffic=blue.
const HEAT_COLOR_VAR = {
  KillZones:   "--red",
  DeathZones:  "--orange",
  Traffic:     "--accent2",
  LootZones:   "--green",
  StormDeaths: "--purple",
};

const HEAT_BANDS = 5;

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

const state = {
  selectedMap:    "AmbroseValley",
  selectedDate:   "",
  selectedMatch:  null,
  matchData:      null,
  matchList:      [],          // flat ordered list for prev/next
  matchListIndex: -1,
  mapImage:       null,
  selectedHeatTypes: [],
  heatmapLayersByType: {},
  heatmapStatsByType: {},
  heatmapLayerCache: {},
  heatmapCanvasCache: {},
  overlapMarkers: [],
  activeHeatRequestId: 0,
  heatmapMessage: "",
  index:          null,
  playback: {
    minTs: 0,
    maxTs: 0,
    currentTs: 0,
    tsPerSecond: 1,
    isPlaying: false,
    speed: 1,
    rafId: null,
    lastFrameAt: 0,
  },
};

// ═══════════════════════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════════════════════

const canvas      = document.getElementById("mapCanvas");
const ctx         = canvas.getContext("2d", { willReadFrequently: true });
const overlay     = document.getElementById("canvasOverlay");
const tooltip     = document.getElementById("tooltip");
const loadingOv   = document.getElementById("loadingOverlay");
const loadingText = document.getElementById("loadingText");

const mapTabs    = document.querySelectorAll(".map-tab");
const dateSelect = document.getElementById("dateSelect");
const matchSelect= document.getElementById("matchSelect");
const matchMeta  = document.getElementById("matchMeta");
const showHumans = document.getElementById("showHumans");
const showBots   = document.getElementById("showBots");
const heatBtns   = document.querySelectorAll(".heat-btn");
const heatmapStatus = document.getElementById("heatmapStatus");
const clearHeatmapsBtn = document.getElementById("clearHeatmaps");
const heatmapChartWrap = document.getElementById("heatmapChartWrap");
const heatmapChart = document.getElementById("heatmapChart");

const prevMatchBtn = document.getElementById("prevMatch");
const nextMatchBtn = document.getElementById("nextMatch");
const matchCounter = document.getElementById("matchCounter");
const trackingMode = document.getElementById("trackingMode");

const playToggle     = document.getElementById("playToggle");
const timelineReset  = document.getElementById("timelineReset");
const timelineSlider = document.getElementById("timelineSlider");
const speedSelect    = document.getElementById("speedSelect");
const timelineStart  = document.getElementById("timelineStart");
const timelineCurrent= document.getElementById("timelineCurrent");
const timelineEnd    = document.getElementById("timelineEnd");

const statMatches  = document.getElementById("statMatches");
const statPlayers  = document.getElementById("statPlayers");
const statEvents   = document.getElementById("statEvents");

// ═══════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════

function showLoading(msg = "Loading…") { loadingText.textContent = msg; loadingOv.classList.remove("hidden"); }
function hideLoading() { loadingOv.classList.add("hidden"); }

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

function lerp(a, b, t) { return a + (b - a) * t; }

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function getCssVar(name, fallback = "") {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function hexToRgb(hex) {
  const s = String(hex || "").trim().replace("#", "");
  if (s.length === 3) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    return { r, g, b };
  }
  if (s.length === 6) {
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    return { r, g, b };
  }
  return { r: 0, g: 229, b: 255 }; // fallback to accent-like cyan
}

function mixRgb(a, b, t) {
  const tt = clamp(t, 0, 1);
  return {
    r: Math.round(lerp(a.r, b.r, tt)),
    g: Math.round(lerp(a.g, b.g, tt)),
    b: Math.round(lerp(a.b, b.b, tt)),
  };
}

function heatBaseColorRgb(heatType) {
  const cssVar = HEAT_COLOR_VAR[heatType] || "--accent2";
  const hex = getCssVar(cssVar, "#0ea5e9");
  return hexToRgb(hex);
}

function heatColorForIntensity(baseRgb, t) {
  // Low intensity: very light tint; high intensity: darker but still saturated.
  const low = mixRgb(baseRgb, { r: 255, g: 255, b: 255 }, 0.86);
  const high = mixRgb(baseRgb, { r: 0, g: 0, b: 0 }, 0.20);
  return mixRgb(low, high, t);
}

function heatIntensityCurve(v) {
  // Exaggerate hotspots so concentrated zones stand out.
  const vv = clamp(v, 0, 1);
  return Math.pow(vv, 1.8);
}

function getHeatBandIndex(vNorm, bands = HEAT_BANDS) {
  // Explicit stepped buckets improve perceptual separation on the map.
  const v = clamp(vNorm, 0, 1);
  if (v <= 0) return 0;
  const idx = Math.ceil(v * bands) - 1;
  return clamp(idx, 0, bands - 1);
}

function getHeatBandColor(baseRgb, bandIndex, bands = HEAT_BANDS) {
  const t = (bandIndex + 1) / bands;
  const shaped = heatIntensityCurve(t);
  return heatColorForIntensity(baseRgb, shaped);
}

function getHeatBandForCount(count, breaks) {
  if (!count || !Array.isArray(breaks) || breaks.length === 0) return -1;
  for (let i = 0; i < breaks.length; i++) {
    if (count <= breaks[i]) return i;
  }
  return breaks.length - 1;
}

function buildHeatBreaks(nonZeroCounts, maxCell, maxBands = HEAT_BANDS) {
  if (!nonZeroCounts.length || maxCell <= 0) return [];

  const sorted = [...nonZeroCounts].sort((a, b) => a - b);
  const raw = [];
  for (let i = 1; i <= maxBands; i++) {
    const q = i / maxBands;
    const idx = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
    raw.push(sorted[idx]);
  }

  const breaks = Array.from(new Set(raw.filter(v => v > 0))).sort((a, b) => a - b);
  if (breaks.length === 0) return [maxCell];

  if (breaks[breaks.length - 1] !== maxCell) breaks[breaks.length - 1] = maxCell;
  return breaks;
}

function getHeatLegendLevels(maxCell) {
  if (!maxCell) return [];
  if (maxCell <= HEAT_BANDS) {
    return Array.from({ length: maxCell }, (_, i) => i + 1);
  }
  const raw = [
    1,
    Math.max(1, Math.round(maxCell * 0.25)),
    Math.max(1, Math.round(maxCell * 0.5)),
    Math.max(1, Math.round(maxCell * 0.75)),
    maxCell,
  ];
  return Array.from(new Set(raw)).sort((a, b) => a - b);
}

function gridDensity(pts, cells = 32) {
  const grid = Array.from({ length: cells }, () => new Array(cells).fill(0));
  for (const [px, py] of pts) {
    const gx = Math.min(cells - 1, Math.floor((px / 1024) * cells));
    const gy = Math.min(cells - 1, Math.floor((py / 1024) * cells));
    grid[gy][gx]++;
  }
  return grid;
}

function percentile(values, q) {
  if (!values || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const qq = clamp(q, 0, 1);
  const idx = (sorted.length - 1) * qq;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const t = idx - lo;
  return lerp(sorted[lo], sorted[hi], t);
}

function zoneNameForCell(gx, gy, cells) {
  const cols = ["West", "Center", "East"];
  const rows = ["North", "Mid", "South"];
  const col = Math.min(2, Math.max(0, Math.floor((gx / cells) * 3)));
  const row = Math.min(2, Math.max(0, Math.floor((gy / cells) * 3)));
  return `${rows[row]}-${cols[col]}`;
}

function describeCell(gx, gy, cells) {
  const x = Math.round(((gx + 0.5) / cells) * 100);
  const y = Math.round(((gy + 0.5) / cells) * 100);
  return `${zoneNameForCell(gx, gy, cells)} (${x}%, ${y}%)`;
}

function updateHeatSelectionUI() {
  const selected = new Set(state.selectedHeatTypes);
  heatBtns.forEach(btn => {
    const type = btn.dataset.heat;
    btn.classList.toggle("active", selected.has(type));
  });
}

function formatHeatType(type) {
  return HEAT_LABELS[type] || type;
}

function markerColorForTypes(types) {
  if (!types || types.length === 0) return "#e2e8f0";
  if (types.length === 1) {
    const rgb = heatBaseColorRgb(types[0]);
    return `rgb(${rgb.r},${rgb.g},${rgb.b})`;
  }
  return "#f8fafc";
}

function pickSpreadMarkers(sortedCandidates, limit = 10, minCellDistance = 3) {
  const chosen = [];
  for (const candidate of sortedCandidates) {
    if (chosen.length >= limit) break;
    const tooClose = chosen.some(sel => {
      const dx = sel.gx - candidate.gx;
      const dy = sel.gy - candidate.gy;
      return (dx * dx + dy * dy) < (minCellDistance * minCellDistance);
    });
    if (!tooClose) chosen.push(candidate);
  }
  return chosen;
}

function computeOverlapMarkersForSelection(types, statsByType) {
  if (!types || types.length === 0) return [];

  const firstStats = statsByType[types[0]];
  if (!firstStats || !Array.isArray(firstStats.grid) || firstStats.grid.length === 0) return [];

  const cells = firstStats.cells;
  const thresholds = {};
  for (const type of types) {
    const stats = statsByType[type];
    if (!stats || !Array.isArray(stats.grid) || stats.grid.length !== cells) continue;
    const nonZero = [];
    for (let gy = 0; gy < cells; gy++) {
      for (let gx = 0; gx < cells; gx++) {
        const c = stats.grid[gy][gx];
        if (c > 0) nonZero.push(c);
      }
    }
    thresholds[type] = Math.max(1, Math.ceil(percentile(nonZero, 0.75)));
  }

  const overlapCandidates = [];
  const isolatedCandidates = [];

  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) {
      const presentTypes = [];
      const highTypes = [];
      const details = [];

      for (const type of types) {
        const stats = statsByType[type];
        if (!stats || !stats.grid?.[gy]) continue;
        const count = stats.grid[gy][gx];
        if (count > 0) presentTypes.push(type);
        const highCutoff = thresholds[type] || 1;
        if (count >= highCutoff) highTypes.push(type);
        details.push({ type, count, highCutoff });
      }

      if (presentTypes.length === 0) continue;

      if (highTypes.length >= 2) {
        const score = highTypes.reduce((acc, type) => {
          const d = details.find(v => v.type === type);
          return acc + ((d?.count || 0) / Math.max(1, d?.highCutoff || 1));
        }, 0);

        overlapCandidates.push({
          gx,
          gy,
          kind: "overlap",
          score,
          types: highTypes,
          details,
          title: `Overlap hotspot: ${highTypes.map(formatHeatType).join(" + ")}`,
          insight: "High-intensity overlap suggests concentrated contest potential.",
        });
        continue;
      }

      if (highTypes.length === 1 && types.length > 1) {
        const dominant = highTypes[0];
        const dominantDetail = details.find(v => v.type === dominant);
        const others = details.filter(v => v.type !== dominant);
        const othersNorm = others.reduce((acc, item) => acc + (item.count / Math.max(1, item.highCutoff)), 0) / Math.max(1, others.length);
        const dominantNorm = (dominantDetail?.count || 0) / Math.max(1, dominantDetail?.highCutoff || 1);
        const isolationScore = dominantNorm - othersNorm;
        if (isolationScore < 0.45) continue;

        const hasLoot = dominant === "LootZones";
        const hasKill = dominant === "KillZones" || dominant === "DeathZones";
        let insight = "One heatmap dominates while others are weak; distribution balance may be off.";
        if (hasLoot) insight = "Loot concentration is high but pressure is low; route conflict or objective pressure here.";
        if (hasKill) insight = "Combat pressure is high with weak supporting reward; add loot or alternate path options.";

        isolatedCandidates.push({
          gx,
          gy,
          kind: "isolated",
          score: isolationScore,
          types: [dominant],
          details,
          title: `Isolated hotspot: ${formatHeatType(dominant)}`,
          insight,
        });
      }
    }
  }

  overlapCandidates.sort((a, b) => b.score - a.score);
  isolatedCandidates.sort((a, b) => b.score - a.score);

  const selectedOverlap = pickSpreadMarkers(overlapCandidates, 8, 3);
  const selectedIsolated = pickSpreadMarkers(isolatedCandidates, 6, 3);

  const markers = selectedOverlap.concat(selectedIsolated).map(item => ({
    ...item,
    x: ((item.gx + 0.5) / cells) * 1024,
    y: ((item.gy + 0.5) / cells) * 1024,
    radius: item.kind === "overlap" ? 10 : 8,
    color: markerColorForTypes(item.types),
    location: describeCell(item.gx, item.gy, cells),
  }));

  return markers;
}

function setActiveMapTab(mapId) {
  mapTabs.forEach(tab => {
    tab.classList.toggle("active", tab.dataset.map === mapId);
  });
}

function formatDuration(seconds) {
  const totalSec = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  if (hh > 0) {
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function detectTsPerSecond(minTs, maxTs) {
  const reference = Math.max(Math.abs(minTs), Math.abs(maxTs));
  return reference >= 100000000000 ? 1000 : 1;
}

function getInterpolatedTrail(points, cursorTs) {
  if (!points || points.length === 0) return null;
  if (cursorTs < points[0].ts) return null;

  const last = points[points.length - 1];
  if (cursorTs >= last.ts) {
    return { trail: points, head: last };
  }

  let idx = 1;
  while (idx < points.length && points[idx].ts <= cursorTs) idx += 1;

  const prev = points[idx - 1];
  const next = points[idx];
  const span = next.ts - prev.ts;
  const t = span > 0 ? (cursorTs - prev.ts) / span : 0;
  const head = {
    px: lerp(prev.px, next.px, t),
    py: lerp(prev.py, next.py, t),
    ts: cursorTs,
  };

  const trail = points.slice(0, idx);
  trail.push(head);
  return { trail, head };
}

function stopPlayback() {
  const pb = state.playback;
  pb.isPlaying = false;
  pb.lastFrameAt = 0;
  if (pb.rafId) {
    cancelAnimationFrame(pb.rafId);
    pb.rafId = null;
  }
  playToggle.classList.remove("playing");
  playToggle.textContent = "▶";
}

function setTimelineEnabled(enabled) {
  playToggle.disabled = !enabled;
  timelineReset.disabled = !enabled;
  timelineSlider.disabled = !enabled;
  speedSelect.disabled = !enabled;
}

function updateTrackingModeBadge() {
  if (!trackingMode) return;
  const pb = state.playback;
  const hasRange = Boolean(state.matchData) && pb.maxTs > pb.minTs;

  if (!hasRange) {
    trackingMode.textContent = "TRACK";
    trackingMode.className = "tracking-mode";
    return;
  }

  const epsilon = (pb.tsPerSecond || 1) * 0.001;
  const atStart = Math.abs(pb.currentTs - pb.minTs) <= epsilon;
  const atEnd = Math.abs(pb.currentTs - pb.maxTs) <= epsilon;

  if (pb.isPlaying) {
    trackingMode.textContent = "TRACKING";
    trackingMode.className = "tracking-mode live";
    return;
  }

  if (atStart) {
    trackingMode.textContent = "FULL TRACK PREVIEW";
    trackingMode.className = "tracking-mode full";
    return;
  }

  if (atEnd) {
    trackingMode.textContent = "FULL TRACK END";
    trackingMode.className = "tracking-mode full";
    return;
  }

  trackingMode.textContent = "TRACK PAUSED";
  trackingMode.className = "tracking-mode pause";
}

function updateTimelineUI() {
  const pb = state.playback;
  const hasRange = pb.maxTs > pb.minTs;

  if (!state.matchData || !hasRange) {
    timelineStart.textContent = "00:00";
    timelineCurrent.textContent = "00:00";
    timelineEnd.textContent = "00:00";
    timelineSlider.value = "0";
    setTimelineEnabled(false);
    updateTrackingModeBadge();
    return;
  }

  const span = pb.maxTs - pb.minTs;
  const relCurrent = Math.max(0, pb.currentTs - pb.minTs);
  const spanSec = span / pb.tsPerSecond;
  const relCurrentSec = relCurrent / pb.tsPerSecond;
  timelineStart.textContent = "00:00";
  timelineCurrent.textContent = formatDuration(relCurrentSec);
  timelineEnd.textContent = formatDuration(spanSec);
  timelineSlider.value = String(Math.round((relCurrent / span) * 1000));
  setTimelineEnabled(true);
  updateTrackingModeBadge();
}

function initializeTimeline(matchData) {
  stopPlayback();

  if (!matchData) {
    state.playback.minTs = 0;
    state.playback.maxTs = 0;
    state.playback.currentTs = 0;
    updateTimelineUI();
    return;
  }

  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;

  for (const p of matchData.players) {
    for (const pos of p.positions) {
      if (pos.ts < minTs) minTs = pos.ts;
      if (pos.ts > maxTs) maxTs = pos.ts;
    }
    for (const evt of p.events) {
      if (evt.ts < minTs) minTs = evt.ts;
      if (evt.ts > maxTs) maxTs = evt.ts;
    }
  }

  if (!Number.isFinite(minTs) || !Number.isFinite(maxTs)) {
    state.playback.minTs = 0;
    state.playback.maxTs = 0;
    state.playback.currentTs = 0;
    state.playback.tsPerSecond = 1;
  } else {
    state.playback.minTs = minTs;
    state.playback.maxTs = maxTs;
    state.playback.currentTs = minTs;
    state.playback.tsPerSecond = detectTsPerSecond(minTs, maxTs);
  }

  state.playback.speed = Number(speedSelect.value || 1);
  updateTimelineUI();
}

function playbackStep(frameTime) {
  const pb = state.playback;
  if (!pb.isPlaying) return;

  if (!pb.lastFrameAt) pb.lastFrameAt = frameTime;
  const deltaMs = frameTime - pb.lastFrameAt;
  pb.lastFrameAt = frameTime;
  const deltaTs = (deltaMs / 1000) * pb.speed * pb.tsPerSecond;
  pb.currentTs += deltaTs;

  if (pb.currentTs >= pb.maxTs) {
    pb.currentTs = pb.maxTs;
    stopPlayback();
  }

  updateTimelineUI();
  render();

  if (pb.isPlaying) pb.rafId = requestAnimationFrame(playbackStep);
}

function togglePlayback() {
  if (!state.matchData || state.playback.maxTs <= state.playback.minTs) return;

  const pb = state.playback;
  if (pb.isPlaying) {
    stopPlayback();
    return;
  }

  if (pb.currentTs >= pb.maxTs) pb.currentTs = pb.minTs;
  pb.isPlaying = true;
  pb.lastFrameAt = 0;
  playToggle.classList.add("playing");
  playToggle.textContent = "❚❚";
  pb.rafId = requestAnimationFrame(playbackStep);
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

async function init() {
  showLoading("Loading data index…");
  initializeTimeline(null);
  try {
    const indexData = await fetchJSON("/api/index");
    state.index = indexData;

    updateHeaderStats();
    populateDates();
    populateMatches();
    loadMinimapImage();
    updateHeatSelectionUI();
    heatmapStatus.textContent = "Select one or more heatmaps to overlay.";
  } catch (e) {
    console.error("Failed to load index:", e);
  } finally {
    hideLoading();
  }
}

function updateHeaderStats() {
  const idx = state.index;
  if (!idx) return;
  let total = 0;
  for (const map of Object.values(idx)) for (const ids of Object.values(map)) total += ids.length;
  statMatches.textContent = `${total} matches`;
}

// ═══════════════════════════════════════════════════════════════
// SELECTORS
// ═══════════════════════════════════════════════════════════════

function populateDates() {
  const mapData = state.index?.[state.selectedMap] || {};
  const dates   = Object.keys(mapData).sort();
  dateSelect.innerHTML = '<option value="">All dates</option>';
  for (const d of dates) {
    const opt = document.createElement("option");
    opt.value = d; opt.textContent = d;
    dateSelect.appendChild(opt);
  }
  dateSelect.value = state.selectedDate;
}

function populateMatches() {
  const mapData = state.index?.[state.selectedMap] || {};
  let ids = [];
  if (state.selectedDate && mapData[state.selectedDate]) {
    ids = mapData[state.selectedDate];
  } else {
    for (const list of Object.values(mapData)) ids = ids.concat(list);
    ids = [...new Set(ids)].sort();
  }

  state.matchList = ids;
  matchSelect.innerHTML = '<option value="">— select a match —</option>';
  ids.forEach((id, i) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `Match ${i + 1} — ${id.slice(0, 8)}…`;
    matchSelect.appendChild(opt);
  });
  matchMeta.textContent = `${ids.length} match${ids.length !== 1 ? "es" : ""} available`;
  updateNavButtons();
}

function updateNavButtons() {
  const i = state.matchListIndex;
  const n = state.matchList.length;
  prevMatchBtn.disabled = i <= 0;
  nextMatchBtn.disabled = i < 0 || i >= n - 1;
  if (i >= 0 && n > 0) {
    matchCounter.textContent = `${i + 1} / ${n}`;
  } else {
    matchCounter.textContent = `— / ${n}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// MINIMAP
// ═══════════════════════════════════════════════════════════════

function loadMinimapImage() {
  const ext = MINIMAP_EXT[state.selectedMap] || "png";
  const img = new Image();
  img.onload  = () => { state.mapImage = img; render(); };
  img.onerror = () => { state.mapImage = null; render(); };
  img.src = `/minimaps/${state.selectedMap}_Minimap.${ext}`;
  state.mapImage = null;
}

// ═══════════════════════════════════════════════════════════════
// MATCH LOADING
// ═══════════════════════════════════════════════════════════════

async function loadMatch(matchId) {
  if (!matchId) {
    stopPlayback();
    state.matchData = null; state.selectedMatch = null;
    state.matchListIndex = -1;
    if (state.selectedHeatTypes.length > 0) overlay.classList.add("hidden");
    else overlay.classList.remove("hidden");
    initializeTimeline(null);
    render(); updateNavButtons();
    return;
  }

  showLoading("Loading match data…");
  try {
    const data = await fetchJSON(`/api/match/${matchId}`);
    state.matchData     = data;
    state.selectedMatch = matchId;
    state.matchListIndex = state.matchList.indexOf(matchId);

    initializeTimeline(data);

    updateMatchStats();
    overlay.classList.add("hidden");
    updateNavButtons();

    render();
  } catch (e) {
    console.error("Failed to load match:", e);
  } finally {
    hideLoading();
  }
}

function updateMatchStats() {
  const d = state.matchData;
  if (!d) { statPlayers.textContent = "—"; statEvents.textContent = "—"; return; }
  const humans = d.players.filter(p => !p.is_bot).length;
  const bots   = d.players.filter(p =>  p.is_bot).length;
  const evts   = d.players.reduce((acc, p) => acc + p.events.length, 0);
  statPlayers.textContent = `${humans}H + ${bots}B`;
  statEvents.textContent  = `${evts} events`;
}

// ═══════════════════════════════════════════════════════════════
// HEATMAP — combines multiple event type files per button
// ═══════════════════════════════════════════════════════════════

async function loadHeatLayer(mapId, heatType) {
  const cacheKey = `${mapId}_${heatType}`;
  if (state.heatmapLayerCache[cacheKey]) {
    return state.heatmapLayerCache[cacheKey];
  }

  const sources = HEAT_SOURCES[heatType] || [];
  let combined = [];
  let message = "";

  if (sources.length === 0) {
    const emptyPayload = {
      type: heatType,
      points: [],
      stats: computeHeatmapStats([]),
      message: "",
    };
    state.heatmapLayerCache[cacheKey] = emptyPayload;
    return emptyPayload;
  }

  const results = await Promise.allSettled(
    sources.map(evt => fetchJSON(`/api/heatmap/${mapId}/${evt}`))
  );

  const missing = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && Array.isArray(r.value)) {
      combined = combined.concat(r.value);
    } else {
      missing.push(sources[i]);
    }
  });

  if (combined.length === 0) {
    message = `${formatHeatType(heatType)} has no points.`;
  } else if (missing.length > 0) {
    message = `${formatHeatType(heatType)} partial: missing ${missing.join(", ")}.`;
  }

  const payload = {
    type: heatType,
    points: combined,
    stats: computeHeatmapStats(combined),
    message,
  };
  state.heatmapLayerCache[cacheKey] = payload;
  return payload;
}

async function refreshSelectedHeatmaps() {
  const types = [...state.selectedHeatTypes];
  if (types.length === 0) {
    state.heatmapLayersByType = {};
    state.heatmapStatsByType = {};
    state.overlapMarkers = [];
    state.heatmapMessage = "";
    heatmapStatus.textContent = "Select one or more heatmaps to overlay.";
    renderHeatmapChart();
    return;
  }

  const requestId = ++state.activeHeatRequestId;
  showLoading("Loading selected heatmaps…");
  try {
    const results = await Promise.all(types.map(type => loadHeatLayer(state.selectedMap, type)));
    if (requestId !== state.activeHeatRequestId) return;

    const layers = {};
    const statsByType = {};
    const messages = [];
    results.forEach((layer) => {
      layers[layer.type] = layer.points;
      statsByType[layer.type] = layer.stats;
      if (layer.message) messages.push(layer.message);
    });

    state.heatmapLayersByType = layers;
    state.heatmapStatsByType = statsByType;
    state.overlapMarkers = computeOverlapMarkersForSelection(types, statsByType);
    state.heatmapMessage = messages.join(" ");

    const selectedText = `${types.length} layer${types.length !== 1 ? "s" : ""}: ${types.map(formatHeatType).join(", ")}`;
    heatmapStatus.textContent = state.heatmapMessage ? `${selectedText}. ${state.heatmapMessage}` : selectedText;
    renderHeatmapChart();
  } catch (e) {
    console.warn("Heatmap load error:", e);
    if (requestId !== state.activeHeatRequestId) return;
    state.heatmapLayersByType = {};
    state.heatmapStatsByType = {};
    state.overlapMarkers = [];
    state.heatmapMessage = `Heatmap unavailable for ${state.selectedMap}.`;
    heatmapStatus.textContent = state.heatmapMessage;
    renderHeatmapChart();
  } finally {
    hideLoading();
  }
}

function clearSelectedHeatmaps() {
  state.selectedHeatTypes = [];
  state.heatmapLayersByType = {};
  state.heatmapStatsByType = {};
  state.overlapMarkers = [];
  state.heatmapMessage = "";
  updateHeatSelectionUI();
  heatmapStatus.textContent = "Select one or more heatmaps to overlay.";
  renderHeatmapChart();
}

function buildHeatmapCanvas(points, heatType, stats) {
  const SIZE = 1024;

  const dc = document.createElement("canvas");
  dc.width = dc.height = SIZE;
  const g  = dc.getContext("2d");

  if (!stats || !Array.isArray(stats.grid) || !stats.grid.length || !stats.breaks?.length) {
    return dc;
  }

  const baseRgb = heatBaseColorRgb(heatType);
  const bands = stats.breaks.length;
  const cellSize = SIZE / stats.cells;

  for (let gy = 0; gy < stats.cells; gy++) {
    const row = stats.grid[gy];
    for (let gx = 0; gx < stats.cells; gx++) {
      const count = row[gx];
      const band = getHeatBandForCount(count, stats.breaks);
      if (band < 0) continue;

      const rgb = getHeatBandColor(baseRgb, band, bands);
      const opacity = clamp(0.2 + 0.75 * ((band + 1) / bands), 0, 0.98);
      g.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity.toFixed(3)})`;
      g.fillRect(gx * cellSize, gy * cellSize, Math.ceil(cellSize), Math.ceil(cellSize));
    }
  }

  // Slight blur keeps area transitions readable while preserving band separation.
  const smooth = document.createElement("canvas");
  smooth.width = smooth.height = SIZE;
  const sg = smooth.getContext("2d");
  sg.filter = "blur(6px)";
  sg.drawImage(dc, 0, 0);

  g.clearRect(0, 0, SIZE, SIZE);
  g.drawImage(smooth, 0, 0);

  return dc;
}

function computeHeatmapStats(points, cells = 64) {
  if (!points || points.length === 0) {
    return { cells, totalPoints: 0, maxCell: 0, levels: [], breaks: [], grid: [] };
  }

  const grid = Array.from({ length: cells }, () => new Array(cells).fill(0));
  for (const p of points) {
    const px = p[0];
    const py = p[1];
    const gx = Math.min(cells - 1, Math.max(0, Math.floor((px / 1024) * cells)));
    const gy = Math.min(cells - 1, Math.max(0, Math.floor((py / 1024) * cells)));
    grid[gy][gx] += 1;
  }

  let maxCell = 0;
  const nonZero = [];
  for (let gy = 0; gy < cells; gy++) {
    for (let gx = 0; gx < cells; gx++) {
      const c = grid[gy][gx];
      if (c > maxCell) maxCell = c;
      if (c > 0) nonZero.push(c);
    }
  }

  const breaks = buildHeatBreaks(nonZero, maxCell);
  const levels = breaks.length ? breaks : getHeatLegendLevels(maxCell);

  return {
    cells,
    totalPoints: points.length,
    maxCell,
    levels,
    breaks,
    grid,
  };
}

function renderHeatmapChart() {
  if (!heatmapChartWrap || !heatmapChart) return;

  if (state.selectedHeatTypes.length !== 1) {
    heatmapChartWrap.classList.add("hidden");
    heatmapChart.innerHTML = "";
    return;
  }

  const type = state.selectedHeatTypes[0];
  const stats = state.heatmapStatsByType[type];
  if (!stats || !stats.maxCell) {
    heatmapChartWrap.classList.add("hidden");
    heatmapChart.innerHTML = "";
    return;
  }

  const unit = type === "KillZones" ? "kills"
    : type === "DeathZones" ? "deaths"
    : type === "LootZones" ? "loot"
    : type === "StormDeaths" ? "storm deaths"
    : type === "Traffic" ? "samples"
    : "points";

  const baseRgb = heatBaseColorRgb(type);
  const max = stats.maxCell;
  const levels = Array.isArray(stats.levels) ? stats.levels : [];
  const totalLevels = Math.max(1, levels.length);

  const ranges = levels.map((upper, i) => {
    const min = i === 0 ? 1 : levels[i - 1] + 1;
    return { min, max: upper };
  });

  const swatches = ranges.map((r, idx) => {
    const rgb = getHeatBandColor(baseRgb, idx, totalLevels);
    const color = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    const label = r.min === r.max ? `${r.max}` : `${r.min}-${r.max}`;
    return `
      <div class="heatmap-swatch" title="${label} ${unit} per cell">
        <div class="heatmap-swatch-color" style="background:${color}"></div>
        <div class="heatmap-swatch-label">${label}</div>
      </div>
    `;
  }).join("");

  heatmapChartWrap.classList.remove("hidden");
  heatmapChart.innerHTML = `
    <div class="heatmap-chart-meta">
      Max hotspot: <strong>${max}</strong> ${unit} <span class="heatmap-chart-sub">(per ${stats.cells}×${stats.cells} cell)</span>
    </div>
    <div class="heatmap-legend">${swatches}</div>
  `;
}

function drawOverlapMarkers(markers) {
  if (!markers || markers.length === 0) return;

  for (const marker of markers) {
    const r = marker.radius || 9;
    const isOverlap = marker.kind === "overlap";

    ctx.save();
    ctx.beginPath();
    ctx.arc(marker.x, marker.y, r, 0, Math.PI * 2);
    ctx.fillStyle = isOverlap ? "rgba(255,255,255,0.2)" : "rgba(9,11,16,0.62)";
    ctx.fill();

    ctx.strokeStyle = marker.color;
    ctx.lineWidth = isOverlap ? 2.6 : 2.0;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(marker.x, marker.y, Math.max(2.4, r * 0.35), 0, Math.PI * 2);
    ctx.fillStyle = marker.color;
    ctx.fill();

    if (isOverlap) {
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, r + 3.5, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.3;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
}

function findHoveredMarker(mx, my) {
  for (const marker of state.overlapMarkers) {
    const r = (marker.radius || 9) + 7;
    const dx = mx - marker.x;
    const dy = my - marker.y;
    if ((dx * dx) + (dy * dy) <= (r * r)) {
      return marker;
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════

function render() {
  ctx.clearRect(0, 0, 1024, 1024);

  if (state.mapImage) {
    ctx.drawImage(state.mapImage, 0, 0, 1024, 1024);
  } else {
    ctx.fillStyle = "#0d1017"; ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = "#1e2535"; ctx.font = "16px Inter"; ctx.textAlign = "center";
    ctx.fillText("Loading minimap…", 512, 512);
  }

  // Multi-heatmap overlay (visible even without selecting a match)
  const types = state.selectedHeatTypes;
  if (types.length > 0) {
    const alphaPerLayer = types.length === 1 ? 0.93 : types.length === 2 ? 0.72 : 0.58;
    for (const type of types) {
      const points = state.heatmapLayersByType[type];
      const stats = state.heatmapStatsByType[type];
      if (!points || points.length === 0 || !stats) continue;

      const cacheKey = `${state.selectedMap}_${type}`;
      let layerCanvas = state.heatmapCanvasCache[cacheKey];
      if (!layerCanvas) {
        layerCanvas = buildHeatmapCanvas(points, type, stats);
        state.heatmapCanvasCache[cacheKey] = layerCanvas;
      }

      ctx.globalAlpha = alphaPerLayer;
      ctx.drawImage(layerCanvas, 0, 0, 1024, 1024);
    }
    ctx.globalAlpha = 1.0;
    drawOverlapMarkers(state.overlapMarkers);
  }

  if (!state.matchData) return;

  const showH = showHumans.checked;
  const showB = showBots.checked;
  const hasTimeline = state.playback.maxTs > state.playback.minTs;
  const cursorTs = hasTimeline ? state.playback.currentTs : Number.POSITIVE_INFINITY;
  const epsilon = (state.playback.tsPerSecond || 1) * 0.001;
  const atStart = hasTimeline && Math.abs(state.playback.currentTs - state.playback.minTs) <= epsilon;
  const atEnd = hasTimeline && Math.abs(state.playback.currentTs - state.playback.maxTs) <= epsilon;
  const showFullTrack = hasTimeline && ((!state.playback.isPlaying && atStart) || atEnd);
  const enabledEvts = new Set(
    Object.entries(EVT_CHECKBOX_MAP)
      .filter(([, id]) => document.getElementById(id)?.checked)
      .map(([type]) => type)
  );

  // Player journeys — bold single-color track for clear readability.
  for (const player of state.matchData.players) {
    if (player.is_bot && !showB) continue;
    if (!player.is_bot && !showH) continue;

    let movement;
    if (showFullTrack) {
      if (!player.positions || player.positions.length === 0) continue;
      const fullTrackHead = atEnd
        ? player.positions[player.positions.length - 1]
        : player.positions[0];
      movement = {
        trail: player.positions,
        head: fullTrackHead,
      };
    } else {
      movement = getInterpolatedTrail(player.positions, cursorTs);
    }
    if (!movement) continue;

    const pos = movement.trail;
    const head = movement.head;
    if (pos.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pos[0].px, pos[0].py);
      for (let i = 1; i < pos.length; i++) ctx.lineTo(pos[i].px, pos[i].py);
      ctx.strokeStyle = TRACK_COLOR;
      ctx.lineWidth = player.is_bot ? 3.0 : 3.8;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash(player.is_bot ? [10, 7] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      // End dot
      ctx.beginPath();
      ctx.arc(head.px, head.py, player.is_bot ? 3.8 : 5.4, 0, Math.PI * 2);
      ctx.fillStyle = TRACK_COLOR;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(head.px, head.py, player.is_bot ? 6.6 : 9.5, 0, Math.PI * 2);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Events
    for (const evt of player.events) {
      if (evt.ts > cursorTs) continue;
      if (!enabledEvts.has(evt.type)) continue;
      const style = EVENT_STYLE[evt.type];
      if (!style) continue;
      ctx.beginPath();
      ctx.arc(evt.px, evt.py, style.radius, 0, Math.PI * 2);
      ctx.fillStyle = style.color + "cc"; ctx.fill();
      ctx.strokeStyle = style.color; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = `${style.radius + 3}px sans-serif`;
      ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.globalAlpha = 0.92;
      ctx.fillText(style.label, evt.px, evt.py);
      ctx.globalAlpha = 1.0;
    }
  }

  ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
}

// ═══════════════════════════════════════════════════════════════
// ON-CANVAS OVERLAP INSIGHT TOOLTIPS
// ═══════════════════════════════════════════════════════════════

function markerTooltipHtml(marker) {
  const typeLine = marker.types?.length
    ? marker.types.map(formatHeatType).join(" + ")
    : "Heatmap hotspot";

  const detailLine = (marker.details || [])
    .filter(d => d.count > 0)
    .map(d => `${formatHeatType(d.type)}: ${d.count}`)
    .join(" | ");

  return `
    <strong style="color:${marker.color}">${marker.title}</strong><br>
    <span style="color:#cbd5e1">${typeLine}</span><br>
    <span style="color:#94a3b8">${marker.location}</span><br>
    <span style="color:#e2e8f0">${marker.insight}</span>
    ${detailLine ? `<br><span style="color:#94a3b8">${detailLine}</span>` : ""}
  `;
}

// ═══════════════════════════════════════════════════════════════
// TOOLTIP
// ═══════════════════════════════════════════════════════════════

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (1024 / rect.width);
  const my = (e.clientY - rect.top)  * (1024 / rect.height);

  const hoveredMarker = findHoveredMarker(mx, my);
  if (hoveredMarker) {
    tooltip.innerHTML = markerTooltipHtml(hoveredMarker);
    tooltip.classList.add("visible");
    tooltip.style.left = `${e.clientX - rect.left + 14}px`;
    tooltip.style.top  = `${e.clientY - rect.top  - 10}px`;
    return;
  }

  if (!state.matchData) {
    tooltip.classList.remove("visible");
    return;
  }

  const hasTimeline = state.playback.maxTs > state.playback.minTs;
  const cursorTs = hasTimeline ? state.playback.currentTs : Number.POSITIVE_INFINITY;
  const HOVER_R = 18;
  let found = null;

  for (const player of state.matchData.players) {
    for (const evt of player.events) {
      if (evt.ts > cursorTs) continue;
      const dx = mx - evt.px, dy = my - evt.py;
      if (dx*dx + dy*dy < HOVER_R*HOVER_R) { found = { player, evt }; break; }
    }
    if (found) break;
  }

  if (found) {
    const { player, evt } = found;
    tooltip.innerHTML = `
      <strong style="color:${player.color}">${player.is_bot ? "🤖 Bot" : "👤 Human"}</strong><br>
      <span style="color:${EVENT_STYLE[evt.type]?.color}">${EVENT_STYLE[evt.type]?.label} ${evt.type}</span>
    `;
    tooltip.classList.add("visible");
    tooltip.style.left = `${e.clientX - rect.left + 14}px`;
    tooltip.style.top  = `${e.clientY - rect.top  - 10}px`;
  } else {
    tooltip.classList.remove("visible");
  }
});

canvas.addEventListener("mouseleave", () => tooltip.classList.remove("visible"));

// ═══════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════

// Map tabs
mapTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    mapTabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    state.selectedMap   = tab.dataset.map;
    state.selectedDate  = "";
    state.heatmapLayersByType = {};
    state.heatmapStatsByType = {};
    state.overlapMarkers = [];
    state.heatmapCanvasCache = {};
    dateSelect.value    = "";
    matchSelect.value   = "";
    populateDates();
    populateMatches();
    loadMatch("");
    loadMinimapImage();
    if (state.selectedHeatTypes.length > 0) {
      refreshSelectedHeatmaps().then(render);
    } else {
      heatmapStatus.textContent = "Select one or more heatmaps to overlay.";
      render();
    }
  });
});

dateSelect.addEventListener("change", () => {
  state.selectedDate = dateSelect.value;
  populateMatches();
  matchSelect.value = "";
  loadMatch("");
});

matchSelect.addEventListener("change", () => loadMatch(matchSelect.value));

showHumans.addEventListener("change", render);
showBots.addEventListener("change", render);
document.querySelectorAll("#eventFilters input").forEach(cb => cb.addEventListener("change", render));

heatBtns.forEach(btn => {
  btn.addEventListener("click", async () => {
    const type = btn.dataset.heat;
    if (!type || !(type in HEAT_SOURCES)) return;

    const idx = state.selectedHeatTypes.indexOf(type);
    if (idx >= 0) {
      state.selectedHeatTypes.splice(idx, 1);
    } else {
      state.selectedHeatTypes.push(type);
    }

    updateHeatSelectionUI();
    await refreshSelectedHeatmaps();
    if (state.selectedHeatTypes.length > 0) overlay.classList.add("hidden");
    else if (!state.matchData) overlay.classList.remove("hidden");
    render();
  });
});

if (clearHeatmapsBtn) {
  clearHeatmapsBtn.addEventListener("click", () => {
    clearSelectedHeatmaps();
    if (!state.matchData) overlay.classList.remove("hidden");
    render();
  });
}

playToggle.addEventListener("click", togglePlayback);

timelineReset.addEventListener("click", () => {
  if (!state.matchData) return;
  stopPlayback();
  state.playback.currentTs = state.playback.minTs;
  updateTimelineUI();
  render();
});

timelineSlider.addEventListener("input", () => {
  if (!state.matchData) return;
  const pb = state.playback;
  const span = pb.maxTs - pb.minTs;
  if (span <= 0) return;

  stopPlayback();
  const ratio = Number(timelineSlider.value) / 1000;
  pb.currentTs = pb.minTs + ratio * span;
  updateTimelineUI();
  render();
});

speedSelect.addEventListener("change", () => {
  state.playback.speed = Number(speedSelect.value || 1);
});

// Prev / Next match
prevMatchBtn.addEventListener("click", () => {
  if (state.matchListIndex > 0) {
    const id = state.matchList[state.matchListIndex - 1];
    matchSelect.value = id;
    loadMatch(id);
  }
});

nextMatchBtn.addEventListener("click", () => {
  if (state.matchListIndex >= 0 && state.matchListIndex < state.matchList.length - 1) {
    const id = state.matchList[state.matchListIndex + 1];
    matchSelect.value = id;
    loadMatch(id);
  }
});

const canvasContainer = document.querySelector(".canvas-container");
if (canvasContainer) {
  new ResizeObserver(() => render()).observe(canvasContainer);
}

// ═══════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════

init();
