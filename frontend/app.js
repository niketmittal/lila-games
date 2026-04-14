/**
 * app.js – LILA BLACK Player Journey Visualizer
 * Heatmaps, prev/next match navigation, and inline analytics.
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

const EVT_CHECKBOX_MAP = {
  Kill:          "evtKill",
  Killed:        "evtKilled",
  BotKill:       "evtBotKill",
  BotKilled:     "evtBotKilled",
  KilledByStorm: "evtStorm",
  Loot:          "evtLoot",
};

// Heatmap types: button → one or more event types to combine
const HEAT_SOURCES = {
  off:          [],
  KillZones:    ["Kill", "BotKill"],
  DeathZones:   ["Killed", "BotKilled"],
  Traffic:      ["Position"],
  LootZones:    ["Loot"],
  StormDeaths:  ["KilledByStorm"],
};

const PRESET_CONFIG = {
  Balanced: {
    note: "Balanced Read: paths and all core events with no heatmap bias.",
    showHumans: true,
    showBots: true,
    events: ["Kill", "Killed", "BotKill", "BotKilled", "KilledByStorm", "Loot"],
    heat: "off",
  },
  Combat: {
    note: "Combat Balance: focus on engagement clusters and death overlap.",
    showHumans: true,
    showBots: true,
    events: ["Kill", "Killed", "BotKill", "BotKilled"],
    heat: "KillZones",
  },
  Storm: {
    note: "Storm Pressure: isolate storm outcomes to spot forced pathing issues.",
    showHumans: true,
    showBots: false,
    events: ["KilledByStorm", "Killed", "Loot"],
    heat: "StormDeaths",
  },
  Loot: {
    note: "Loot Flow: show movement and pickups to validate loot route coverage.",
    showHumans: true,
    showBots: true,
    events: ["Loot", "Kill", "BotKill"],
    heat: "LootZones",
  },
  DeadSpace: {
    note: "Dead Space: emphasize traffic heat to reveal ignored map regions.",
    showHumans: true,
    showBots: false,
    events: [],
    heat: "Traffic",
  },
};

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
  heatmapType:    "off",
  heatmapData:    null,
  heatmapCacheKey: null,
  heatmapMessage: "",
  selectedPreset: "Balanced",
  index:          null,
  outlierData:    null,
  playback: {
    minTs: 0,
    maxTs: 0,
    currentTs: 0,
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
const presetBtns = document.querySelectorAll(".preset-btn");
const presetNote = document.getElementById("presetNote");
const insightHighlights = document.getElementById("insightHighlights");
const datasetSummary = document.getElementById("datasetSummary");
const outlierList = document.getElementById("outlierList");

const prevMatchBtn = document.getElementById("prevMatch");
const nextMatchBtn = document.getElementById("nextMatch");
const matchCounter = document.getElementById("matchCounter");

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

function gridDensity(pts, cells = 32) {
  const grid = Array.from({ length: cells }, () => new Array(cells).fill(0));
  for (const [px, py] of pts) {
    const gx = Math.min(cells - 1, Math.floor((px / 1024) * cells));
    const gy = Math.min(cells - 1, Math.floor((py / 1024) * cells));
    grid[gy][gx]++;
  }
  return grid;
}

function setActiveHeatButton(type) {
  heatBtns.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.heat === type);
  });
}

function setActiveMapTab(mapId) {
  mapTabs.forEach(tab => {
    tab.classList.toggle("active", tab.dataset.map === mapId);
  });
}

function setEventFilters(enabledTypes) {
  const enabled = new Set(enabledTypes);
  for (const [evtType, checkboxId] of Object.entries(EVT_CHECKBOX_MAP)) {
    const cb = document.getElementById(checkboxId);
    if (!cb) continue;
    cb.checked = enabled.has(evtType);
  }
}

async function applyPreset(presetName) {
  const cfg = PRESET_CONFIG[presetName];
  if (!cfg) return;

  state.selectedPreset = presetName;
  presetBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.preset === presetName));
  presetNote.textContent = cfg.note;

  showHumans.checked = cfg.showHumans;
  showBots.checked = cfg.showBots;
  setEventFilters(cfg.events);

  state.heatmapType = cfg.heat;
  setActiveHeatButton(cfg.heat);

  if (cfg.heat === "off") {
    state.heatmapData = null;
    state.heatmapCacheKey = null;
    state.heatmapMessage = "";
    heatmapStatus.textContent = "";
    heatCanvas = null;
    render();
    return;
  }

  await loadHeatmap(state.selectedMap, cfg.heat);
  render();
}

function renderDatasetInsights() {
  if (!state.outlierData) {
    datasetSummary.innerHTML = `<div class="dataset-summary-item">Dataset insights unavailable. Re-run processing to generate outlier signals.</div>`;
    outlierList.innerHTML = `<div class="outlier-empty">No outlier dataset loaded.</div>`;
    return;
  }

  const quick = Array.isArray(state.outlierData.quick_takeaways)
    ? state.outlierData.quick_takeaways.slice(0, 4)
    : [];

  datasetSummary.innerHTML = quick.map(item => `<div class="dataset-summary-item">${item}</div>`).join("");

  const top = Array.isArray(state.outlierData.top_outliers)
    ? state.outlierData.top_outliers.slice(0, 6)
    : [];

  if (top.length === 0) {
    outlierList.innerHTML = `<div class="outlier-empty">No outlier matches were flagged.</div>`;
    return;
  }

  outlierList.innerHTML = top.map(o => `
    <button class="outlier-card ${o.severity || "info"}" data-map="${o.map_id}" data-date="${o.date}" data-match="${o.match_id}">
      <div class="outlier-head">
        <span class="outlier-map">${o.map_id}</span>
        <span class="outlier-score">${o.severity || "info"} · score ${Number(o.score || 0).toFixed(2)}</span>
      </div>
      <div class="outlier-note">${o.headline || "Outlier signal detected"}</div>
    </button>
  `).join("");

  outlierList.querySelectorAll(".outlier-card").forEach(btn => {
    btn.addEventListener("click", async () => {
      const mapId = btn.dataset.map;
      const date = btn.dataset.date;
      const matchId = btn.dataset.match;

      state.selectedMap = mapId;
      state.selectedDate = date;
      setActiveMapTab(mapId);
      state.heatmapCacheKey = null;
      heatCanvas = null;

      dateSelect.value = "";
      populateDates();
      dateSelect.value = date;
      populateMatches();

      matchSelect.value = matchId;
      loadMinimapImage();
      await loadMatch(matchId);
    });
  });
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
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

function updateTimelineUI() {
  const pb = state.playback;
  const hasRange = pb.maxTs > pb.minTs;

  if (!state.matchData || !hasRange) {
    timelineStart.textContent = "00:00";
    timelineCurrent.textContent = "00:00";
    timelineEnd.textContent = "00:00";
    timelineSlider.value = "0";
    setTimelineEnabled(false);
    return;
  }

  const span = pb.maxTs - pb.minTs;
  const relCurrent = Math.max(0, pb.currentTs - pb.minTs);
  timelineStart.textContent = "00:00";
  timelineCurrent.textContent = formatDuration(relCurrent);
  timelineEnd.textContent = formatDuration(span);
  timelineSlider.value = String(Math.round((relCurrent / span) * 1000));
  setTimelineEnabled(true);
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
  } else {
    state.playback.minTs = minTs;
    state.playback.maxTs = maxTs;
    state.playback.currentTs = minTs;
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
  pb.currentTs += deltaMs * pb.speed;

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
  if (PRESET_CONFIG[state.selectedPreset]) {
    presetNote.textContent = PRESET_CONFIG[state.selectedPreset].note;
  }
  try {
    const [indexData, outlierData] = await Promise.all([
      fetchJSON("/api/index"),
      fetchJSON("/api/outliers").catch(() => null),
    ]);

    state.index = indexData;
    state.outlierData = outlierData;

    updateHeaderStats();
    renderDatasetInsights();
    populateDates();
    populateMatches();
    loadMinimapImage();
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
    overlay.classList.remove("hidden");
    initializeTimeline(null);
    render(); updateNavButtons();
    renderAnalytics();
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

    if (state.heatmapType !== "off") {
      await loadHeatmap(state.selectedMap, state.heatmapType);
    }
    render();
    renderAnalytics();
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

let heatCanvas = null;

async function loadHeatmap(mapId, heatType) {
  const sources = HEAT_SOURCES[heatType] || [];
  if (sources.length === 0) {
    state.heatmapData = null;
    state.heatmapCacheKey = null;
    state.heatmapMessage = "";
    heatmapStatus.textContent = "";
    heatCanvas = null;
    return;
  }

  const cacheKey = `${mapId}_${heatType}`;
  if (state.heatmapCacheKey === cacheKey) return; // already loaded

  showLoading("Loading heatmap data…");
  try {
    // Fetch all source files in parallel and combine points
    const results = await Promise.allSettled(
      sources.map(evt => fetchJSON(`/api/heatmap/${mapId}/${evt}`))
    );
    let combined = [];
    const missing = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        combined = combined.concat(r.value);
      } else {
        missing.push(sources[i]);
      }
    });

    state.heatmapData    = combined;
    state.heatmapCacheKey = cacheKey;

    if (combined.length === 0) {
      state.heatmapMessage = `No ${heatType} points for ${mapId}.`;
    } else if (missing.length > 0) {
      state.heatmapMessage = `Partial ${heatType}: missing ${missing.join(", ")}.`;
    } else {
      state.heatmapMessage = "";
    }

    heatmapStatus.textContent = state.heatmapMessage;
    heatCanvas = null; // invalidate cached render
  } catch (e) {
    console.warn("Heatmap load error:", e);
    state.heatmapData = null; state.heatmapCacheKey = null;
    state.heatmapMessage = `Heatmap unavailable for ${mapId}.`;
    heatmapStatus.textContent = state.heatmapMessage;
  } finally {
    hideLoading();
  }
}

function buildHeatmapCanvas(points) {
  const SIZE = 1024;
  const MAX_SAMPLE = 15000;

  let pts = points;
  if (pts.length > MAX_SAMPLE) {
    const step = Math.ceil(pts.length / MAX_SAMPLE);
    pts = pts.filter((_, i) => i % step === 0);
  }

  // Adaptive radius: larger when fewer points so sparse data is still visible
  const RADIUS = pts.length < 200 ? 60 : pts.length < 1000 ? 40 : pts.length < 5000 ? 28 : 18;

  const dc = document.createElement("canvas");
  dc.width = dc.height = SIZE;
  const g  = dc.getContext("2d");

  // Additive blending: overlapping blobs stack up to bright hot zones
  g.globalCompositeOperation = "lighter";

  const baseAlpha = Math.min(0.3, 6 / Math.sqrt(Math.max(pts.length, 1)));

  for (const [px, py] of pts) {
    const grad = g.createRadialGradient(px, py, 0, px, py, RADIUS);
    grad.addColorStop(0,   `rgba(255,255,255,${baseAlpha})`);
    grad.addColorStop(0.5, `rgba(255,255,255,${baseAlpha * 0.4})`);
    grad.addColorStop(1,   "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath(); g.arc(px, py, RADIUS, 0, Math.PI * 2); g.fill();
  }

  // Read pixels and apply hot colormap
  g.globalCompositeOperation = "source-over";
  const imgData = g.getImageData(0, 0, SIZE, SIZE);
  const d = imgData.data;

  let maxV = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > maxV) maxV = d[i];
  if (maxV === 0) maxV = 1;

  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] / maxV;
    if (v < 0.02) { d[i+3] = 0; continue; }

    let r, gr, b;
    if (v < 0.25)      { const t = v/0.25;          r=0;             gr=Math.round(lerp(0,200,t));   b=255; }
    else if (v < 0.5)  { const t = (v-0.25)/0.25;   r=0;             gr=255;                          b=Math.round(lerp(200,0,t)); }
    else if (v < 0.75) { const t = (v-0.5)/0.25;    r=Math.round(lerp(0,255,t)); gr=255;             b=0; }
    else               { const t = (v-0.75)/0.25;   r=255;           gr=Math.round(lerp(255,0,t));   b=0; }

    d[i]   = r; d[i+1] = gr; d[i+2] = b;
    d[i+3] = Math.round(Math.pow(v, 0.55) * 220);
  }

  g.putImageData(imgData, 0, 0);
  return dc;
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

  if (!state.matchData) return;

  const showH = showHumans.checked;
  const showB = showBots.checked;
  const hasTimeline = state.playback.maxTs > state.playback.minTs;
  const cursorTs = hasTimeline ? state.playback.currentTs : Number.POSITIVE_INFINITY;
  const enabledEvts = new Set(
    Object.entries(EVT_CHECKBOX_MAP)
      .filter(([, id]) => document.getElementById(id)?.checked)
      .map(([type]) => type)
  );

  // Heatmap overlay
  if (state.heatmapType !== "off" && state.heatmapData && state.heatmapData.length > 0) {
    if (!heatCanvas || heatCanvas._key !== state.heatmapCacheKey) {
      heatCanvas = buildHeatmapCanvas(state.heatmapData);
      heatCanvas._key = state.heatmapCacheKey;
    }
    ctx.globalAlpha = 0.72;
    ctx.drawImage(heatCanvas, 0, 0, 1024, 1024);
    ctx.globalAlpha = 1.0;
  }

  // Player journeys — show path up to the active playback time.
  for (const player of state.matchData.players) {
    if (player.is_bot && !showB) continue;
    if (!player.is_bot && !showH) continue;

    const color = player.color;
    const pos = player.positions.filter(p => p.ts <= cursorTs);

    if (pos.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pos[0].px, pos[0].py);
      for (let i = 1; i < pos.length; i++) ctx.lineTo(pos[i].px, pos[i].py);
      ctx.strokeStyle = color;
      ctx.lineWidth   = player.is_bot ? 1.2 : 1.8;
      ctx.globalAlpha = player.is_bot ? 0.4 : 0.65;
      ctx.setLineDash(player.is_bot ? [4, 5] : []);
      ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1.0;

      // End dot
      const last = pos[pos.length - 1];
      ctx.beginPath();
      ctx.arc(last.px, last.py, player.is_bot ? 3 : 5, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();

      if (!player.is_bot) {
        ctx.beginPath();
        ctx.arc(last.px, last.py, 8, 0, Math.PI * 2);
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.35;
        ctx.stroke(); ctx.globalAlpha = 1.0;
      }
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
// INLINE ANALYTICS
// ═══════════════════════════════════════════════════════════════

async function renderAnalytics() {
  const panel = document.getElementById("analyticsContent");
  if (!state.matchData) {
    insightHighlights.innerHTML = "";
    panel.innerHTML = `<div class="analytics-empty">Select a match to see analytics.</div>`;
    return;
  }

  const d = state.matchData;
  const allEvents   = [];
  const allPositions= [];
  for (const p of d.players) {
    for (const pos of p.positions) allPositions.push([pos.px, pos.py, p.is_bot]);
    for (const evt of p.events)    allEvents.push({ ...evt, is_bot: p.is_bot, color: p.color });
  }

  const kills  = allEvents.filter(e => e.type === "Kill" || e.type === "BotKill");
  const deaths = allEvents.filter(e => e.type === "Killed" || e.type === "BotKilled" || e.type === "KilledByStorm");
  const loots  = allEvents.filter(e => e.type === "Loot");
  const storms = allEvents.filter(e => e.type === "KilledByStorm");
  const humanPos  = allPositions.filter(p => !p[2]);

  // Grid-based analytics
  const CELLS = 32;
  const killGrid    = kills.length    ? gridDensity(kills.map(e  => [e.px, e.py]))  : null;
  const trafficGrid = humanPos.length ? gridDensity(humanPos.map(p => [p[0], p[1]])) : null;

  // Hot fight zone
  let hotFightZone = null;
  if (killGrid) {
    let maxK = 0, bx = 0, by = 0;
    for (let gy = 0; gy < CELLS; gy++)
      for (let gx = 0; gx < CELLS; gx++)
        if (killGrid[gy][gx] > maxK) { maxK = killGrid[gy][gx]; bx = gx; by = gy; }
    if (maxK > 0) hotFightZone = { x: Math.round((bx+0.5)/CELLS*100), y: Math.round((by+0.5)/CELLS*100), count: maxK };
  }

  // Dead zones
  let deadZones = 0;
  if (trafficGrid) {
    for (let gy = 3; gy < CELLS-3; gy++)
      for (let gx = 3; gx < CELLS-3; gx++)
        if (trafficGrid[gy][gx] === 0) deadZones++;
  }

  // OOB
  const oob = allPositions.filter(p => p[0] < 0 || p[0] > 1024 || p[1] < 0 || p[1] > 1024).length;

  const humanPlayers = d.players.filter(p => !p.is_bot);
  const stormPct = deaths.length > 0 ? Math.round(storms.length / deaths.length * 100) : 0;
  const avgLoot  = humanPlayers.length > 0 ? (loots.length / humanPlayers.length).toFixed(1) : "0";
  const deadSpacePct = Math.round((deadZones / ((CELLS - 6) * (CELLS - 6))) * 100);
  const engagementDensity = kills.length > 0 && hotFightZone
    ? Math.round((hotFightZone.count / kills.length) * 100)
    : 0;

  const zoneLabels = [
    "North-West", "North", "North-East",
    "West", "Center", "East",
    "South-West", "South", "South-East",
  ];

  const zoneStats = Array.from({ length: 9 }, (_, idx) => ({
    label: zoneLabels[idx],
    traffic: 0,
    kills: 0,
    deaths: 0,
    loot: 0,
  }));

  const getZoneIndex = (px, py) => {
    const col = Math.min(2, Math.max(0, Math.floor((px / 1024) * 3)));
    const row = Math.min(2, Math.max(0, Math.floor((py / 1024) * 3)));
    return row * 3 + col;
  };

  for (const p of allPositions) {
    const [px, py, isBot] = p;
    if (isBot) continue;
    zoneStats[getZoneIndex(px, py)].traffic += 1;
  }

  for (const evt of allEvents) {
    const zone = zoneStats[getZoneIndex(evt.px, evt.py)];
    if (evt.type === "Kill" || evt.type === "BotKill") zone.kills += 1;
    if (evt.type === "Killed" || evt.type === "BotKilled" || evt.type === "KilledByStorm") zone.deaths += 1;
    if (evt.type === "Loot") zone.loot += 1;
  }

  const topTraffic = [...zoneStats].sort((a, b) => b.traffic - a.traffic)[0];
  const topCombat  = [...zoneStats].sort((a, b) => b.kills - a.kills)[0];
  const topLoot    = [...zoneStats].sort((a, b) => b.loot - a.loot)[0];
  const currentOutlier = state.outlierData?.outliers?.find(o => o.match_id === d.match_id) || null;
  const outlierChipClass = !currentOutlier
    ? "ok"
    : (currentOutlier.severity === "critical" ? "critical" : (currentOutlier.severity === "warning" ? "warn" : "ok"));
  const outlierInsightClass = !currentOutlier
    ? "ok"
    : (currentOutlier.severity === "critical" ? "bug" : (currentOutlier.severity === "warning" ? "warn" : "info"));

  const chips = [];
  chips.push(`<span class="highlight-chip ${deadSpacePct >= 45 ? "critical" : deadSpacePct >= 28 ? "warn" : "ok"}"><strong>Dead Space</strong> ${deadSpacePct}%</span>`);
  chips.push(`<span class="highlight-chip ${stormPct >= 35 ? "critical" : stormPct >= 20 ? "warn" : "ok"}"><strong>Storm Pressure</strong> ${stormPct}% deaths</span>`);
  chips.push(`<span class="highlight-chip ${engagementDensity >= 45 ? "warn" : "ok"}"><strong>Kill Cluster</strong> ${engagementDensity}% in hottest cell</span>`);
  chips.push(`<span class="highlight-chip ok"><strong>Top Combat Zone</strong> ${topCombat.label}</span>`);
  if (currentOutlier) {
    chips.push(`<span class="highlight-chip ${outlierChipClass}"><strong>Outlier</strong> ${currentOutlier.headline}</span>`);
  }
  insightHighlights.innerHTML = chips.join("");

  panel.innerHTML = `
    <div class="analytics-section">
      <div class="analytics-section-title">Quick Match Snapshot</div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-val">${humanPlayers.length}</div><div class="stat-key">Humans</div></div>
        <div class="stat-card"><div class="stat-val">${kills.length}</div><div class="stat-key">Kills</div></div>
        <div class="stat-card"><div class="stat-val">${stormPct}%</div><div class="stat-key">Storm Death Share</div></div>
        <div class="stat-card"><div class="stat-val">${deadSpacePct}%</div><div class="stat-key">Dead Space</div></div>
        <div class="stat-card"><div class="stat-val">${avgLoot}</div><div class="stat-key">Loot / Human</div></div>
        <div class="stat-card"><div class="stat-val">${engagementDensity}%</div><div class="stat-key">Kill Cluster</div></div>
      </div>
    </div>

    <div class="analytics-section">
      <div class="analytics-section-title">One-Minute Takeaway</div>
      ${currentOutlier
        ? `<div class="insight-card ${outlierInsightClass}"><div class="insight-icon">🚩</div><div><strong>${currentOutlier.headline}</strong><div class="insight-sub">${currentOutlier.improve}</div></div></div>`
        : `<div class="insight-card ok"><div class="insight-icon">✅</div><div><strong>No major outlier flag</strong><div class="insight-sub">This match sits close to map medians across key signals.</div></div></div>`}
      ${hotFightZone ? `<div class="insight-card info"><div class="insight-icon">📌</div><div><strong>Combat Focus</strong><div class="insight-sub">${hotFightZone.count} kills around ${hotFightZone.x}%x, ${hotFightZone.y}%y.</div></div></div>` : ""}
      ${oob > 0 ? `<div class="insight-card bug"><div class="insight-icon">🚨</div><div><strong>Data quality check</strong><div class="insight-sub">${oob} points are outside minimap bounds.</div></div></div>` : ""}
    </div>

    <div class="analytics-section">
      <div class="analytics-section-title">Zone Rollups</div>
      <div class="zone-grid">
        <div class="zone-card">
          <div class="zone-head">Combat</div>
          <div class="zone-name">${topCombat.label}</div>
          <div class="zone-meta">${topCombat.kills} kills<br>${topCombat.deaths} deaths</div>
        </div>
        <div class="zone-card">
          <div class="zone-head">Traffic</div>
          <div class="zone-name">${topTraffic.label}</div>
          <div class="zone-meta">${topTraffic.traffic} human samples<br>high path usage</div>
        </div>
        <div class="zone-card">
          <div class="zone-head">Loot</div>
          <div class="zone-name">${topLoot.label}</div>
          <div class="zone-meta">${topLoot.loot} pickups<br>route magnet</div>
        </div>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// TOOLTIP
// ═══════════════════════════════════════════════════════════════

canvas.addEventListener("mousemove", (e) => {
  if (!state.matchData) return;
  const hasTimeline = state.playback.maxTs > state.playback.minTs;
  const cursorTs = hasTimeline ? state.playback.currentTs : Number.POSITIVE_INFINITY;
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (1024 / rect.width);
  const my = (e.clientY - rect.top)  * (1024 / rect.height);
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
    state.heatmapCacheKey = null;
    heatCanvas          = null;
    dateSelect.value    = "";
    matchSelect.value   = "";
    heatmapStatus.textContent = "";
    populateDates();
    populateMatches();
    loadMatch("");
    loadMinimapImage();
    if (state.heatmapType !== "off") loadHeatmap(state.selectedMap, state.heatmapType).then(render);
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
    state.selectedPreset = "";
    presetBtns.forEach(p => p.classList.remove("active"));
    presetNote.textContent = "Custom view: manual layer mix for targeted inspection.";

    heatBtns.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const type = btn.dataset.heat;
    state.heatmapType  = type;
    heatCanvas = null;
    if (type === "off") {
      state.heatmapData = null;
      state.heatmapMessage = "";
      heatmapStatus.textContent = "";
      render();
    }
    else { await loadHeatmap(state.selectedMap, type); render(); }
  });
});

presetBtns.forEach(btn => {
  btn.addEventListener("click", async () => {
    await applyPreset(btn.dataset.preset);
  });
});

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
