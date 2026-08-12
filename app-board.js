"use strict";

const $ = id => document.getElementById(id);
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 5;
const MIN_ANALYSIS_GRID_PERIOD = 4;
const codeCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const sortByCode = (a, b) => codeCollator.compare(a.code, b.code);
const COMMON_GRID_SIZES = [
  [52, 52], [58, 58], [64, 64], [72, 72], [75, 75], [78, 78], [104, 104], [145, 145], [156, 156],
  [96, 54], [104, 73], [104, 78], [160, 90], [54, 96], [73, 104], [78, 104], [90, 160]
];
const EXAMPLE_DB_NAME = "perler-example-gallery";
const EXAMPLE_DB_STORE = "examples";
const EXAMPLE_ORDER_KEY = "perler.example-order.v1";
const EXAMPLE_HIDDEN_KEY = "perler.hidden-builtins.v1";
const ADMIN_KEY_SHA256 = "4e6cd9d2836665480af693cea22109de0fce692b1739f1392dcd3df86b57f36e";
const ADMIN_SESSION_COOKIE = "perler_admin_session";
const ADMIN_SESSION_VERSION = "v1";
const ADMIN_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const ADMIN_SESSION_RENEW_THROTTLE_MS = 60 * 1000;
// Screen colors used by this numbered-sheet renderer differ from the generic
// MARD chart.  The printed labels are authoritative; these anchors were read
// from labelled cells and are enabled only when the sheet signature matches.
const NUMBERED_SHEET_COLOR_PROFILE = {
  signatures: [
    [235, 187, 131], [203, 142, 119], [194, 220, 235],
    [89, 42, 33], [59, 47, 35], [86, 64, 60]
  ],
  anchors: [
    ["H2", 255, 255, 255], ["A21", 255, 227, 149], ["G14", 141, 97, 76], ["M9", 165, 135, 103],
    ["H12", 255, 245, 237], ["G17", 86, 64, 60], ["M7", 180, 164, 151], ["G12", 235, 187, 131],
    ["H1", 226, 226, 226], ["G21", 203, 142, 119], ["E11", 252, 221, 210], ["G3", 244, 195, 165],
    ["H3", 179, 179, 179], ["C23", 194, 220, 235], ["M4", 218, 206, 190], ["A25", 255, 214, 125],
    ["C14", 213, 253, 255], ["D23", 234, 218, 252], ["H4", 134, 134, 134], ["A23", 243, 213, 191],
    ["G4", 225, 179, 131], ["D11", 185, 186, 225], ["C28", 187, 207, 237], ["G8", 89, 42, 33],
    ["M13", 209, 144, 102], ["H16", 59, 47, 35], ["M10", 197, 177, 188], ["D26", 233, 195, 246],
    ["H20", 148, 159, 163], ["E23", 147, 122, 141], ["G10", 200, 129, 53], ["A11", 255, 221, 153]
  ]
};
const state = {
  image: null, name: "", mard: [], used: [], selected: new Set(), original: null,
  grid: null, fallbackGroups: null, mirroredBase: null, zoom: 1, mirrored: false, x: 0, y: 0,
  dragging: false, renderToken: 0, palettePromise: null, analysisBusy: false,
  adminMode: false, adminSessionExpiresAt: 0, adminSessionRenewedAt: 0,
  uploadedExampleUrls: new Map(), exampleDbPromise: null,
  examplePointerDrag: null, alignment: null, sheetColorProfile: null
};
const els = {
  workspace: $("workspace"), drop: $("boardStage"), file: $("fileInput"),
  canvas: $("beadCanvas"), stage: $("boardStage"), empty: $("emptyBoard"), palette: $("paletteList"),
  imageCard: $("imageCard"), paletteSection: $("paletteSection"), current: $("currentColor"),
  search: $("paletteSearch"), boardPanel: document.querySelector(".board-panel"),
  selectionRow: $("selectionRow"), gridPreset: $("gridPreset"), customGrid: $("customGrid"),
  gridCols: $("gridCols"), gridRows: $("gridRows"), alignmentDialog: $("alignmentDialog"),
  alignmentCanvas: $("alignmentCanvas"), alignmentWrap: $("alignmentCanvasWrap"),
  alignmentStage: $("alignmentPreviewStage"), alignmentCols: $("alignmentCols"),
  alignmentRows: $("alignmentRows"), alignmentPreset: $("alignmentPreset")
};
const ctx = els.canvas.getContext("2d", { willReadFrequently: true });
const alignmentCtx = els.alignmentCanvas.getContext("2d");
let toastTimer;

function toast(text, duration = 1900) {
  $("toast").textContent = text; $("toast").classList.add("show"); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), duration);
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function rgbDistance(a, b) {
  const meanR = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + meanR / 256) * dr * dr + 4 * dg * dg + (2 + (255 - meanR) / 256) * db * db;
}
function luminance(r, g, b) { return .299 * r + .587 * g + .114 * b; }
function saturation(r, g, b) { const max = Math.max(r, g, b), min = Math.min(r, g, b); return max ? (max - min) / max : 0; }

function rgbToLab([r, g, b]) {
  let rr = r / 255, gg = g / 255, bb = b / 255;
  rr = rr > .04045 ? ((rr + .055) / 1.055) ** 2.4 : rr / 12.92;
  gg = gg > .04045 ? ((gg + .055) / 1.055) ** 2.4 : gg / 12.92;
  bb = bb > .04045 ? ((bb + .055) / 1.055) ** 2.4 : bb / 12.92;
  let x = (rr * .4124 + gg * .3576 + bb * .1805) / .95047;
  let y = (rr * .2126 + gg * .7152 + bb * .0722);
  let z = (rr * .0193 + gg * .1192 + bb * .9505) / 1.08883;
  const f = v => v > .008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function labDistance(a, b) { const dl = a[0] - b[0], da = a[1] - b[1], db = a[2] - b[2]; return dl * dl + da * da + db * db; }
function nearestMard(rgb) {
  const lab = rgbToLab(rgb); let best = state.mard[0], score = Infinity;
  for (const color of state.mard) { const d = labDistance(lab, color.lab); if (d < score) { score = d; best = color; } }
  return best;
}

async function ensurePalette() {
  if (state.mard.length) return state.mard;
  if (!state.palettePromise) state.palettePromise = fetch("./mard-291.json").then(response => {
    if (!response.ok) throw new Error("MARD 色库加载失败");
    return response.json();
  }).then(data => {
    if (data.color_count !== 291 || !Array.isArray(data.colors) || data.colors.length !== 291) throw new Error("MARD 291 色库数据不完整");
    state.mard = data.colors.map((color, index) => ({ ...color, lab: Array.isArray(color.lab) ? color.lab : rgbToLab(color.rgb), id: index })); return state.mard;
  });
  return state.palettePromise;
}

function acceptFile(file, purpose = "pattern") {
  if (!file || !file.type.startsWith("image/")) return toast("请选择 PNG、JPG 或 WEBP 图片");
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => openAlignment(image, file.name, purpose);
    image.onerror = () => toast("图片读取失败");
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

async function loadImage(image, filename, forcedSize = null, calibratedGrid = null, onProgress = null) {
  Object.assign(state, { image, name: filename, used: [], grid: null, fallbackGroups: null, mirroredBase: null, zoom: 1, mirrored: false, x: 0, y: 0, sheetColorProfile: null });
  state.selected.clear(); els.search.value = "";
  $("mirrorButton").classList.remove("active");
  $("patternName").textContent = filename.replace(/\.[^.]+$/, "");
  $("imageResolution").textContent = `${image.naturalWidth} × ${image.naturalHeight} px · 原图 1:1`;
  $("gridStatus").textContent = "正在识别网格…"; $("gridSize").textContent = "—";
  els.workspace.classList.remove("hidden"); els.empty.classList.add("hidden"); els.selectionRow.classList.remove("hidden");
  els.canvas.classList.remove("hidden"); els.stage.classList.add("has-image"); els.boardPanel.classList.add("has-image"); els.imageCard.classList.remove("hidden"); els.paletteSection.classList.add("hidden"); els.current.classList.remove("hidden");
  toast("正在识别网格与 MARD 色号…", 6000); await new Promise(resolve => requestAnimationFrame(resolve));
  try {
    onProgress?.(.05, "正在加载完整 MARD 291 色库…");
    await ensurePalette(); prepareCanvas();
    onProgress?.(.11, "正在准备高清裁剪图纸…");
    state.grid = calibratedGrid || detectGrid(image, forcedSize);
    if (state.grid) state.used = onProgress
      ? await analyzeGridCellsAsync(state.grid, ratio => onProgress(.12 + ratio * .84, `正在识别第 ${Math.min(state.grid.rows, Math.max(1, Math.ceil(ratio * state.grid.rows)))} / ${state.grid.rows} 行…`))
      : analyzeGridCells(state.grid);
    else state.used = await analyzeFallbackColors(image);
    onProgress?.(.98, "正在生成色号与数量统计…");
    renderPalette(); renderFocus(); updateSummary(); updateGridReadout();
    updateGridControls();
    els.paletteSection.classList.remove("hidden");
    toast(state.grid ? `已识别 ${state.grid.cols}×${state.grid.rows} 网格和 ${state.used.length} 个 MARD 色号` : `未可靠识别网格，已按 MARD 色块模式分析`);
    onProgress?.(1, "识别完成");
    return true;
  } catch (error) {
    console.error(error); toast(error.message || "图纸分析失败", 4000);
    return false;
  }
}

function prepareCanvas() {
  els.canvas.width = state.image.naturalWidth; els.canvas.height = state.image.naturalHeight;
  ctx.drawImage(state.image, 0, 0); state.original = ctx.getImageData(0, 0, els.canvas.width, els.canvas.height); state.mirroredBase = null;
  requestAnimationFrame(() => fitCanvas(true));
}
function fitCanvas(resetZoom = false) {
  // Adapt the stage to the uploaded pattern's aspect ratio, then use the fitted full-pattern
  // view as the 100% zoom baseline. Later zooming changes only the document inside this frame.
  const contentWidth = Math.max(1, els.stage.clientWidth - 36);
  const widthScale = contentWidth / els.canvas.width;
  const isTouchTablet = navigator.maxTouchPoints > 0 && window.innerWidth >= 761 && window.innerWidth <= 1366;
  const tabletStageLimit = Math.max(360, window.innerHeight - 232);
  const heightScale = isTouchTablet ? Math.max(1, tabletStageLimit - 36) / els.canvas.height : widthScale;
  state.fitScale = Math.min(widthScale, heightScale);
  const adaptiveHeight = els.canvas.height * state.fitScale + 36;
  els.stage.style.height = `${adaptiveHeight}px`;
  els.canvas.style.width = `${els.canvas.width * state.fitScale}px`;
  els.canvas.style.height = `${els.canvas.height * state.fitScale}px`;
  if (resetZoom) { state.zoom = 1; state.x = 0; state.y = 0; }
  transformCanvas();
}

function makeAnalysisCanvas(image, maxSide = 1400) {
  const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const context = canvas.getContext("2d", { willReadFrequently: true }); context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { canvas, context, ratio, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };
}

function edgeScores(data, width, height) {
  const vertical = new Float64Array(width), horizontal = new Float64Array(height);
  const verticalCoverage = new Float64Array(width), horizontalCoverage = new Float64Array(height);
  const step = Math.max(1, Math.floor(Math.max(width, height) / 900));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const current = luminance(data[i], data[i + 1], data[i + 2]);
      if (current < 250) { verticalCoverage[x]++; horizontalCoverage[y]++; }
      if (x < step || y < step) continue;
      const left = i - step * 4, above = i - width * step * 4;
      vertical[x] += Math.abs(current - luminance(data[left], data[left + 1], data[left + 2]));
      horizontal[y] += Math.abs(current - luminance(data[above], data[above + 1], data[above + 2]));
    }
  }
  return { vertical, horizontal, verticalCoverage, horizontalCoverage };
}

function quantile(values, ratio) {
  const sorted = Array.from(values).sort((a, b) => a - b), position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position), upper = Math.ceil(position), weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function axisPeak(scores, position) {
  const center = Math.round(position); let peak = 0;
  for (let i = Math.max(0, center - 1); i <= Math.min(scores.length - 1, center + 1); i++) peak = Math.max(peak, scores[i]);
  return peak;
}

function finishAxisCandidate(best, scores, coverage) {
  if (!best || best.positions.length < 8) return null;
  const coverageEvidence = best.positions.map(position => axisPeak(coverage, position));
  const coverageMaximum = Math.max(...coverage), coverageThreshold = coverageMaximum * .72, weakCoverageThreshold = coverageMaximum * .48;
  let strong = coverageEvidence.map((value, index) => value >= coverageThreshold ? index : -1).filter(index => index >= 0);
  if (strong.length < 2) {
    const strongThreshold = quantile(scores, .9) * 1.45;
    strong = best.evidence.map((value, index) => value >= strongThreshold ? index : -1).filter(index => index >= 0);
  }
  if (strong.length < 2) {
    const fallback = quantile(best.evidence, .75);
    strong = best.evidence.map((value, index) => value >= fallback ? index : -1).filter(index => index >= 0);
  }
  if (strong.length < 2) return null;
  let first = strong[0], last = strong.at(-1);
  while (first > 0 && coverageEvidence[first - 1] >= weakCoverageThreshold) first--;
  while (last < best.positions.length - 1 && coverageEvidence[last + 1] >= weakCoverageThreshold) last++;

  let start = best.positions[first], end = best.positions[last];
  if (start < best.period * .35) start = 0;
  if (scores.length - end < best.period * .35) end = scores.length;
  const tailCells = (scores.length - end) / best.period;
  if (start === 0 && tailCells > .65 && tailCells < 1.35) end = scores.length;
  const headCells = start / best.period;
  if (end === scores.length && headCells > .65 && headCells < 1.35) start = 0;

  const continuousSupport = best.positions.filter(position => axisPeak(coverage, position) >= weakCoverageThreshold).length / best.positions.length;
  const support = coverageEvidence.slice(first, last + 1).filter(value => value >= weakCoverageThreshold).length / Math.max(1, last - first + 1);
  return {
    start, end, period: best.period, regularity: clamp(.65 + support * .35, 0, 1),
    continuousSupport, evidenceMedian: quantile(best.evidence, .5), score: best.score, divisor: best.divisor
  };
}

function regularAxis(scores, coverage) {
  const positive = Array.from(scores), mean = positive.reduce((a, b) => a + b, 0) / positive.length;
  for (let i = 0; i < positive.length; i++) positive[i] = Math.max(0, positive[i] - mean);
  const maxPeriod = Math.min(120, Math.floor(scores.length / 6)), correlations = [];
  for (let period = MIN_ANALYSIS_GRID_PERIOD; period <= maxPeriod; period++) {
    let sum = 0; for (let i = 0; i + period < positive.length; i++) sum += positive[i] * positive[i + period];
    correlations.push({ period, score: sum / Math.max(1, positive.length - period) });
  }
  const top = Math.max(...correlations.map(item => item.score));
  const seed = correlations.find(item => item.score >= top * .82)?.period; if (!seed) return null;

  const cap = quantile(scores, .92), periodCandidates = [];
  // Autocorrelation often prefers a strong harmonic (for example every second
  // grid line). Evaluate its sub-periods as well, then let repeated evidence at
  // every expected boundary select the real cell pitch.
  for (let divisor = 1; divisor <= 6; divisor++) {
    const centerPeriod = seed / divisor;
    if (centerPeriod < MIN_ANALYSIS_GRID_PERIOD) break;
    const radius = Math.min(1, centerPeriod * .08);
    let divisorBest = null;
    for (let period = centerPeriod - radius; period <= centerPeriod + radius + .001; period += .04) {
      for (let phase = 0; phase < period; phase += .5) {
        const positions = [], evidence = []; let sum = 0;
        for (let position = phase; position < scores.length; position += period) {
          const value = axisPeak(scores, position); positions.push(position); evidence.push(value); sum += Math.min(value, cap);
        }
        const score = sum / Math.sqrt(Math.max(1, positions.length));
        if (!divisorBest || score > divisorBest.score) divisorBest = { score, period, positions, evidence, divisor };
      }
    }
    if (divisorBest) periodCandidates.push(divisorBest);
  }
  let best = periodCandidates[0];
  const subperiod = periodCandidates[1];
  if (subperiod && subperiod.score > best.score) {
    const coverageMaximum = Math.max(...coverage), coverageFloor = coverageMaximum * .48;
    const continuousSupport = subperiod.positions.filter(position => axisPeak(coverage, position) >= coverageFloor).length / subperiod.positions.length;
    const parentMedian = quantile(best.evidence, .5), subperiodMedian = quantile(subperiod.evidence, .5);
    if (continuousSupport >= .86 && subperiodMedian >= parentMedian * .8) best = subperiod;
  }
  const selected = finishAxisCandidate(best, scores, coverage);
  if (!selected) return null;
  selected.candidates = periodCandidates.map(candidate => finishAxisCandidate(candidate, scores, coverage)).filter(Boolean);
  return selected;
}

function selectSharedGridAxes(xAxis, yAxis) {
  const pairs = [];
  for (const xCandidate of xAxis.candidates || [xAxis]) for (const yCandidate of yAxis.candidates || [yAxis]) {
    const sharedPeriod = (xCandidate.period + yCandidate.period) / 2;
    const mismatch = Math.abs(xCandidate.period - yCandidate.period) / sharedPeriod;
    if (mismatch <= .06 && xCandidate.continuousSupport >= .84 && yCandidate.continuousSupport >= .84) {
      pairs.push({ x: xCandidate, y: yCandidate, sharedPeriod, mismatch });
    }
  }
  if (!pairs.length) return { x: xAxis, y: yAxis };
  // Printed codes can form a convincing half-cell rhythm.  Only consider a
  // finer pitch when both axes retain most of the strongest boundary signal;
  // otherwise keep the actual grid-line period instead of the text rhythm.
  const strongestX = Math.max(...pairs.map(pair => pair.x.evidenceMedian));
  const strongestY = Math.max(...pairs.map(pair => pair.y.evidenceMedian));
  const supported = pairs.filter(pair => pair.x.evidenceMedian >= strongestX * .8 && pair.y.evidenceMedian >= strongestY * .8);
  supported.sort((a, b) => a.sharedPeriod - b.sharedPeriod || a.mismatch - b.mismatch);
  return supported[0];
}

function axisHasFullCanvasBorders(scores, period) {
  const cells = Math.round(scores.length / period);
  if (cells < 7 || cells > 300) return false;
  const fittedPeriod = scores.length / cells;
  if (Math.abs(fittedPeriod - period) / period > .025) return false;
  const edgeThreshold = quantile(scores, .75);
  return axisPeak(scores, 0) >= edgeThreshold && axisPeak(scores, scores.length - 1) >= edgeThreshold;
}

function detectGrid(image, forcedSize = null) {
  const analysis = makeAnalysisCanvas(image), scores = edgeScores(analysis.pixels, analysis.canvas.width, analysis.canvas.height);
  const initialX = regularAxis(scores.vertical, scores.verticalCoverage), initialY = regularAxis(scores.horizontal, scores.horizontalCoverage); if (!initialX || !initialY) return null;
  const sharedAxes = selectSharedGridAxes(initialX, initialY), xAxis = sharedAxes.x, yAxis = sharedAxes.y;
  const sharedPeriod = (xAxis.period + yAxis.period) / 2;
  if (Math.abs(xAxis.period - yAxis.period) / sharedPeriod > .18) return null;
  const xNearFull = xAxis.start < sharedPeriod * 1.35 && analysis.canvas.width - xAxis.end < sharedPeriod * 1.35;
  const yNearFull = yAxis.start < sharedPeriod * 1.35 && analysis.canvas.height - yAxis.end < sharedPeriod * 1.35;
  const fullCanvasGrid = axisHasFullCanvasBorders(scores.vertical, sharedPeriod) && axisHasFullCanvasBorders(scores.horizontal, sharedPeriod);
  if ((xNearFull && yNearFull) || fullCanvasGrid) {
    xAxis.start = 0; xAxis.end = analysis.canvas.width;
    yAxis.start = 0; yAxis.end = analysis.canvas.height;
  }
  const cols = forcedSize?.cols ?? Math.round((xAxis.end - xAxis.start) / sharedPeriod);
  const rows = forcedSize?.rows ?? Math.round((yAxis.end - yAxis.start) / sharedPeriod);
  const maximum = 300;
  if (cols < 7 || rows < 7 || cols > maximum || rows > maximum) return null;
  const scale = 1 / analysis.ratio, confidence = Math.round(Math.min(xAxis.regularity, yAxis.regularity) * 100);
  if (confidence < 70) return null;
  return {
    left: Math.round(xAxis.start * scale), right: Math.round(xAxis.end * scale),
    top: Math.round(yAxis.start * scale), bottom: Math.round(yAxis.end * scale),
    cols, rows, confidence, cells: [], codeCounts: new Map()
  };
}

function nearestCommonGrid(cols, rows) {
  let best = null;
  for (const [candidateCols, candidateRows] of COMMON_GRID_SIZES) {
    const error = Math.max(Math.abs(candidateCols - cols) / candidateCols, Math.abs(candidateRows - rows) / candidateRows);
    if (!best || error < best.error) best = { cols: candidateCols, rows: candidateRows, error };
  }
  return best && best.error <= .035 ? best : { cols, rows, error: 0 };
}

function fallbackGridSuggestion(image) {
  const aspect = image.naturalWidth / image.naturalHeight;
  let best = null;
  for (const [cols, rows] of COMMON_GRID_SIZES) {
    const aspectError = Math.abs(Math.log((cols / rows) / aspect));
    const preferredSize = cols === 104 || rows === 104 ? 0 : .03;
    const score = aspectError + preferredSize;
    if (!best || score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

function setAlignmentConfidence(confidence, manual = false) {
  const badge = $("alignmentConfidence");
  badge.className = "confidence-badge";
  if (manual) {
    badge.textContent = "已调整";
    badge.classList.add("medium");
    return;
  }
  if (confidence == null) {
    badge.textContent = "需确认";
    badge.classList.add("low");
  } else if (confidence >= 88) badge.textContent = `高 ${confidence}%`;
  else if (confidence >= 76) { badge.textContent = `中 ${confidence}%`; badge.classList.add("medium"); }
  else { badge.textContent = `低 ${confidence}%`; badge.classList.add("low"); }
}

function layoutAlignmentCanvas() {
  const alignment = state.alignment;
  if (!alignment || !els.alignmentStage.clientWidth) return;
  const style = getComputedStyle(els.alignmentStage);
  const availableWidth = Math.max(120, els.alignmentStage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
  const availableHeight = Math.max(120, els.alignmentStage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
  const aspect = alignment.image.naturalWidth / alignment.image.naturalHeight;
  els.alignmentWrap.style.width = `${Math.min(availableWidth, availableHeight * aspect)}px`;
}

function resetCellCalibration(alignment) {
  const cellWidth = (alignment.right - alignment.left) / alignment.cols;
  const cellHeight = (alignment.bottom - alignment.top) / alignment.rows;
  const anchorCol = Math.max(0, Math.min(alignment.cols - 1, Math.floor(alignment.cols / 2)));
  const anchorRow = Math.max(0, Math.min(alignment.rows - 1, Math.floor(alignment.rows / 2)));
  alignment.cellLeft = alignment.left + anchorCol * cellWidth;
  alignment.cellTop = alignment.top + anchorRow * cellHeight;
  alignment.cellRight = alignment.cellLeft + cellWidth;
  alignment.cellBottom = alignment.cellTop + cellHeight;
}

function clampCellCalibration(alignment) {
  const totalWidth = alignment.right - alignment.left, totalHeight = alignment.bottom - alignment.top;
  let cellWidth = alignment.cellRight - alignment.cellLeft, cellHeight = alignment.cellBottom - alignment.cellTop;
  if (!Number.isFinite(cellWidth) || cellWidth < 2) cellWidth = totalWidth / alignment.cols;
  if (!Number.isFinite(cellHeight) || cellHeight < 2) cellHeight = totalHeight / alignment.rows;
  cellWidth = clamp(cellWidth, 2, totalWidth);
  cellHeight = clamp(cellHeight, 2, totalHeight);
  alignment.cellLeft = clamp(alignment.cellLeft, alignment.left, alignment.right - cellWidth);
  alignment.cellTop = clamp(alignment.cellTop, alignment.top, alignment.bottom - cellHeight);
  alignment.cellRight = alignment.cellLeft + cellWidth;
  alignment.cellBottom = alignment.cellTop + cellHeight;
}

function inferGridFromCell(alignment) {
  const cellWidth = alignment.cellRight - alignment.cellLeft, cellHeight = alignment.cellBottom - alignment.cellTop;
  if (cellWidth < 2 || cellHeight < 2) return;
  alignment.cols = clamp(Math.round((alignment.right - alignment.left) / cellWidth), 8, 300);
  alignment.rows = clamp(Math.round((alignment.bottom - alignment.top) / cellHeight), 8, 300);
}

function updateAlignmentSummary() {
  const alignment = state.alignment;
  if (!alignment) return;
  const width = Math.max(1, Math.round(alignment.right - alignment.left));
  const height = Math.max(1, Math.round(alignment.bottom - alignment.top));
  $("alignmentCropSize").textContent = `${width} × ${height} px`;
  const cellWidth = alignment.cellRight - alignment.cellLeft, cellHeight = alignment.cellBottom - alignment.cellTop;
  $("alignmentCellSize").textContent = `单格校准 ${cellWidth.toFixed(1)} × ${cellHeight.toFixed(1)} px · 推算 ${alignment.cols} × ${alignment.rows}`;
  els.alignmentCols.value = alignment.cols;
  els.alignmentRows.value = alignment.rows;
  const red = $("redCrosshair"), blue = $("blueCrosshair"), green = $("greenCrosshair"), yellow = $("yellowCrosshair");
  red.style.left = `${alignment.left / alignment.image.naturalWidth * 100}%`;
  red.style.top = `${alignment.top / alignment.image.naturalHeight * 100}%`;
  blue.style.left = `${alignment.right / alignment.image.naturalWidth * 100}%`;
  blue.style.top = `${alignment.bottom / alignment.image.naturalHeight * 100}%`;
  green.style.left = `${alignment.cellLeft / alignment.image.naturalWidth * 100}%`;
  green.style.top = `${alignment.cellTop / alignment.image.naturalHeight * 100}%`;
  yellow.style.left = `${alignment.cellRight / alignment.image.naturalWidth * 100}%`;
  yellow.style.top = `${alignment.cellBottom / alignment.image.naturalHeight * 100}%`;
}

function renderAlignmentPreview() {
  const alignment = state.alignment;
  if (!alignment) return;
  const canvas = els.alignmentCanvas, image = alignment.image;
  const ratio = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  alignmentCtx.clearRect(0, 0, width, height);
  alignmentCtx.imageSmoothingEnabled = true;
  alignmentCtx.drawImage(image, 0, 0, width, height);

  const left = alignment.left * ratio, right = alignment.right * ratio;
  const top = alignment.top * ratio, bottom = alignment.bottom * ratio;
  const cropWidth = right - left, cropHeight = bottom - top;
  alignmentCtx.fillStyle = "rgba(17,17,17,.48)";
  alignmentCtx.fillRect(0, 0, width, height);
  alignmentCtx.drawImage(image, alignment.left, alignment.top, alignment.right - alignment.left, alignment.bottom - alignment.top, left, top, cropWidth, cropHeight);

  alignmentCtx.save();
  alignmentCtx.beginPath(); alignmentCtx.rect(left, top, cropWidth, cropHeight); alignmentCtx.clip();
  for (let col = 0; col <= alignment.cols; col++) {
    const x = left + col * cropWidth / alignment.cols;
    alignmentCtx.beginPath(); alignmentCtx.moveTo(x, top); alignmentCtx.lineTo(x, bottom);
    alignmentCtx.strokeStyle = col % 10 === 0 ? "rgba(17,17,17,.58)" : "rgba(17,17,17,.22)";
    alignmentCtx.lineWidth = col % 10 === 0 ? 1.5 : .75; alignmentCtx.stroke();
  }
  for (let row = 0; row <= alignment.rows; row++) {
    const y = top + row * cropHeight / alignment.rows;
    alignmentCtx.beginPath(); alignmentCtx.moveTo(left, y); alignmentCtx.lineTo(right, y);
    alignmentCtx.strokeStyle = row % 10 === 0 ? "rgba(17,17,17,.58)" : "rgba(17,17,17,.22)";
    alignmentCtx.lineWidth = row % 10 === 0 ? 1.5 : .75; alignmentCtx.stroke();
  }
  alignmentCtx.restore();
  alignmentCtx.lineWidth = 2.5;
  alignmentCtx.strokeStyle = "#ef4444";
  alignmentCtx.beginPath(); alignmentCtx.moveTo(left, bottom); alignmentCtx.lineTo(left, top); alignmentCtx.lineTo(right, top); alignmentCtx.stroke();
  alignmentCtx.strokeStyle = "#2563eb";
  alignmentCtx.beginPath(); alignmentCtx.moveTo(left, bottom); alignmentCtx.lineTo(right, bottom); alignmentCtx.lineTo(right, top); alignmentCtx.stroke();
  const cellLeft = alignment.cellLeft * ratio, cellRight = alignment.cellRight * ratio;
  const cellTop = alignment.cellTop * ratio, cellBottom = alignment.cellBottom * ratio;
  alignmentCtx.save();
  alignmentCtx.setLineDash([4, 3]);
  alignmentCtx.lineWidth = 2;
  alignmentCtx.strokeStyle = "rgba(22,163,74,.95)";
  alignmentCtx.strokeRect(cellLeft, cellTop, cellRight - cellLeft, cellBottom - cellTop);
  alignmentCtx.strokeStyle = "#ca8a04";
  alignmentCtx.beginPath(); alignmentCtx.moveTo(cellLeft, cellBottom); alignmentCtx.lineTo(cellRight, cellBottom); alignmentCtx.lineTo(cellRight, cellTop); alignmentCtx.stroke();
  alignmentCtx.restore();
  layoutAlignmentCanvas();
  updateAlignmentSummary();
}

function syncAlignmentPreset(auto = false) {
  const alignment = state.alignment;
  if (!alignment) return;
  const value = `${alignment.cols}x${alignment.rows}`;
  $("alignmentPreset").querySelector("option[value=auto]").textContent = `自动建议 · ${alignment.cols} × ${alignment.rows}`;
  els.alignmentPreset.value = auto ? "auto" : (els.alignmentPreset.querySelector(`option[value="${value}"]`) ? value : "custom");
}

function applyDetectedAlignment() {
  const alignment = state.alignment;
  if (!alignment) return;
  if (alignment.detected) {
    const snapped = nearestCommonGrid(alignment.detected.cols, alignment.detected.rows);
    Object.assign(alignment, {
      left: clamp(alignment.detected.left, 0, alignment.image.naturalWidth - 8),
      right: clamp(alignment.detected.right, 8, alignment.image.naturalWidth),
      top: clamp(alignment.detected.top, 0, alignment.image.naturalHeight - 8),
      bottom: clamp(alignment.detected.bottom, 8, alignment.image.naturalHeight),
      cols: snapped.cols, rows: snapped.rows, manual: false
    });
    $("alignmentDetection").textContent = `已定位 ${alignment.cols} × ${alignment.rows} 网格`;
    setAlignmentConfidence(alignment.detected.confidence);
  } else {
    const fallback = fallbackGridSuggestion(alignment.image);
    Object.assign(alignment, { left: 0, top: 0, right: alignment.image.naturalWidth, bottom: alignment.image.naturalHeight, ...fallback, manual: false });
    $("alignmentDetection").textContent = `建议 ${alignment.cols} × ${alignment.rows}，请人工确认`;
    setAlignmentConfidence(null);
  }
  resetCellCalibration(alignment);
  syncAlignmentPreset(true);
  renderAlignmentPreview();
}

async function runAutoAlignment() {
  const alignment = state.alignment;
  if (!alignment || alignment.processing) return;
  $("alignmentDetection").textContent = "正在分析规则网格…";
  const badge = $("alignmentConfidence"); badge.className = "confidence-badge scanning"; badge.textContent = "检测中";
  $("resetAlignment").disabled = true;
  await new Promise(resolve => setTimeout(resolve, 24));
  if (state.alignment !== alignment) return;
  try { alignment.detected = detectGrid(alignment.image); }
  catch (error) { console.error(error); alignment.detected = null; }
  $("resetAlignment").disabled = false;
  if (state.alignment === alignment) applyDetectedAlignment();
}

function openAlignment(image, filename, purpose = "pattern") {
  const fallback = fallbackGridSuggestion(image);
  state.alignment = {
    image, filename, left: 0, top: 0, right: image.naturalWidth, bottom: image.naturalHeight,
    cols: fallback.cols, rows: fallback.rows, detected: null, active: "red", pointer: null,
    manual: false, processing: false, purpose
  };
  resetCellCalibration(state.alignment);
  setAlignmentProcessing(false);
  setActiveCrosshair("red");
  document.querySelector(".alignment-step").textContent = purpose === "example" ? "上传示例图纸 · 校准网格" : "添加图纸 · 校准网格";
  $("confirmAlignment").textContent = purpose === "example" ? "确认识别并添加示例" : "确认并开始识别";
  $("alignmentDetection").textContent = "正在定位网格…";
  const badge = $("alignmentConfidence"); badge.className = "confidence-badge scanning"; badge.textContent = "检测中";
  syncAlignmentPreset(true);
  if (!els.alignmentDialog.open) els.alignmentDialog.showModal();
  requestAnimationFrame(() => { layoutAlignmentCanvas(); renderAlignmentPreview(); runAutoAlignment(); });
}

function setActiveCrosshair(kind) {
  const alignment = state.alignment;
  if (alignment) alignment.active = kind;
  for (const name of ["red", "blue", "green", "yellow"]) {
    $(`${name}Crosshair`).classList.toggle("active", kind === name);
    $(`select${name[0].toUpperCase()}${name.slice(1)}Crosshair`).classList.toggle("active", kind === name);
  }
}

function updateAlignmentCorner(kind, x, y, manual = true) {
  const alignment = state.alignment;
  if (!alignment || alignment.processing) return;
  const minimum = 8;
  if (kind === "red") {
    alignment.left = Math.round(clamp(x, 0, alignment.right - minimum));
    alignment.top = Math.round(clamp(y, 0, alignment.bottom - minimum));
  } else {
    alignment.right = Math.round(clamp(x, alignment.left + minimum, alignment.image.naturalWidth));
    alignment.bottom = Math.round(clamp(y, alignment.top + minimum, alignment.image.naturalHeight));
  }
  clampCellCalibration(alignment);
  inferGridFromCell(alignment);
  syncAlignmentPreset(false);
  if (manual) {
    alignment.manual = true;
    $("alignmentDetection").textContent = `已按整体范围推算 ${alignment.cols} × ${alignment.rows} 网格`;
    setAlignmentConfidence(alignment.detected?.confidence, true);
  }
  renderAlignmentPreview();
}

function updateAlignmentCellCorner(kind, x, y) {
  const alignment = state.alignment;
  if (!alignment || alignment.processing) return;
  const minimum = 2;
  if (kind === "green") {
    alignment.cellLeft = Math.round(clamp(x, alignment.left, alignment.cellRight - minimum));
    alignment.cellTop = Math.round(clamp(y, alignment.top, alignment.cellBottom - minimum));
  } else {
    alignment.cellRight = Math.round(clamp(x, alignment.cellLeft + minimum, alignment.right));
    alignment.cellBottom = Math.round(clamp(y, alignment.cellTop + minimum, alignment.bottom));
  }
  inferGridFromCell(alignment);
  syncAlignmentPreset(false);
  alignment.manual = true;
  $("alignmentDetection").textContent = `已按单格大小推算 ${alignment.cols} × ${alignment.rows} 网格`;
  setAlignmentConfidence(alignment.detected?.confidence, true);
  renderAlignmentPreview();
}

function nudgeActiveCrosshair(dx, dy, amount = 1) {
  const alignment = state.alignment;
  if (!alignment) return;
  const kind = alignment.active;
  if (kind === "red" || kind === "blue") {
    updateAlignmentCorner(kind, kind === "red" ? alignment.left + dx * amount : alignment.right + dx * amount, kind === "red" ? alignment.top + dy * amount : alignment.bottom + dy * amount);
  } else {
    updateAlignmentCellCorner(kind, kind === "green" ? alignment.cellLeft + dx * amount : alignment.cellRight + dx * amount, kind === "green" ? alignment.cellTop + dy * amount : alignment.cellBottom + dy * amount);
  }
}

function handleCrosshairPointer(event, kind) {
  const alignment = state.alignment;
  if (!alignment || alignment.processing) return;
  event.preventDefault(); setActiveCrosshair(kind);
  const target = event.currentTarget;
  target.setPointerCapture(event.pointerId);
  const move = moveEvent => {
    const rect = els.alignmentWrap.getBoundingClientRect();
    const x = (moveEvent.clientX - rect.left) / rect.width * alignment.image.naturalWidth;
    const y = (moveEvent.clientY - rect.top) / rect.height * alignment.image.naturalHeight;
    if (kind === "red" || kind === "blue") updateAlignmentCorner(kind, x, y);
    else updateAlignmentCellCorner(kind, x, y);
  };
  const stop = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", stop); target.removeEventListener("pointercancel", stop); };
  target.addEventListener("pointermove", move); target.addEventListener("pointerup", stop); target.addEventListener("pointercancel", stop);
}

function updateAlignmentGridFromInputs() {
  const alignment = state.alignment;
  if (!alignment || alignment.processing) return;
  const cols = Math.round(Number(els.alignmentCols.value)), rows = Math.round(Number(els.alignmentRows.value));
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 8 || rows < 8 || cols > 300 || rows > 300) return;
  alignment.cols = cols; alignment.rows = rows; alignment.manual = true;
  resetCellCalibration(alignment);
  syncAlignmentPreset(false);
  $("alignmentDetection").textContent = `已人工设置 ${cols} × ${rows} 网格`;
  setAlignmentConfidence(alignment.detected?.confidence, true);
  renderAlignmentPreview();
}

function setAlignmentProgress(ratio, label) {
  const percent = Math.round(clamp(ratio, 0, 1) * 100);
  $("alignmentProgressBar").style.width = `${percent}%`;
  $("alignmentProgressValue").textContent = `${percent}%`;
  if (label) $("alignmentProgressText").textContent = label;
}

function setAlignmentProcessing(processing) {
  const alignment = state.alignment;
  if (alignment) alignment.processing = processing;
  $("alignmentContent").classList.toggle("hidden", processing);
  $("alignmentActions").classList.toggle("hidden", processing);
  $("alignmentProcessing").classList.toggle("hidden", !processing);
  $("cancelAlignmentTop").disabled = processing;
  if (!processing) setAlignmentProgress(0, "正在准备高清图纸…");
}

function closeAlignment() {
  if (state.alignment?.processing) return;
  if (els.alignmentDialog.open) els.alignmentDialog.close();
  state.alignment = null;
  els.file.value = "";
  $("exampleFileInput").value = "";
}

async function cropAlignmentImage(alignment) {
  const width = Math.max(1, Math.round(alignment.right - alignment.left));
  const height = Math.max(1, Math.round(alignment.bottom - alignment.top));
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  canvas.getContext("2d").drawImage(alignment.image, alignment.left, alignment.top, width, height, 0, 0, width, height);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("高清裁剪图生成失败")), "image/png"));
  const source = URL.createObjectURL(blob), image = new Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("裁剪图读取失败")); image.src = source; });
  } finally { URL.revokeObjectURL(source); }
  return { image, blob };
}

async function confirmAlignment() {
  const alignment = state.alignment;
  if (!alignment || alignment.processing) return;
  const width = alignment.right - alignment.left, height = alignment.bottom - alignment.top;
  if (width / alignment.cols < 3 || height / alignment.rows < 3) return toast("单格像素过小，请检查规格或扩大裁剪区域", 3500);
  setAlignmentProcessing(true); setAlignmentProgress(.02, "正在生成高清裁剪图纸…");
  try {
    const { image, blob } = await cropAlignmentImage(alignment);
    const grid = {
      left: 0, top: 0, right: image.naturalWidth, bottom: image.naturalHeight,
      cols: alignment.cols, rows: alignment.rows,
      confidence: alignment.manual ? Math.max(70, alignment.detected?.confidence || 70) : (alignment.detected?.confidence || 70),
      cells: [], codeCounts: new Map()
    };
    const success = await loadImage(image, alignment.filename, null, grid, setAlignmentProgress);
    if (!success) { setAlignmentProcessing(false); return; }
    if (alignment.purpose === "example") {
      setAlignmentProgress(.99, "正在保存到示例图库…");
      await saveCalibratedExample(blob, alignment.filename, `${alignment.cols}x${alignment.rows}`);
    }
    await new Promise(resolve => setTimeout(resolve, 180));
    if (els.alignmentDialog.open) els.alignmentDialog.close();
    state.alignment = null; els.file.value = ""; $("exampleFileInput").value = "";
  } catch (error) {
    console.error(error); toast(error.message || "图纸校准失败", 3500); setAlignmentProcessing(false);
  }
}

function cellHasPrintedCode(data, imageWidth, imageHeight, x0, x1, y0, y1, backgroundRgb) {
  const backgroundLuminance = luminance(...backgroundRgb);
  const startX = clamp(Math.floor(x0 + (x1 - x0) * .16), 0, imageWidth - 1);
  const endX = clamp(Math.ceil(x0 + (x1 - x0) * .84), 0, imageWidth);
  const startY = clamp(Math.floor(y0 + (y1 - y0) * .2), 0, imageHeight - 1);
  const endY = clamp(Math.ceil(y0 + (y1 - y0) * .8), 0, imageHeight);
  let inkPixels = 0, samples = 0;
  for (let y = startY; y < endY; y++) for (let x = startX; x < endX; x++) {
    const index = (y * imageWidth + x) * 4;
    const pixelLuminance = luminance(data[index], data[index + 1], data[index + 2]);
    samples++;
    if (backgroundLuminance - pixelLuminance > 20) inkPixels++;
  }
  return inkPixels >= Math.max(3, Math.ceil(samples * .006));
}

function readCellColor(grid, col, row) {
  const data = state.original.data, width = els.canvas.width;
  const x0 = grid.left + col * (grid.right - grid.left) / grid.cols, x1 = grid.left + (col + 1) * (grid.right - grid.left) / grid.cols;
  const y0 = grid.top + row * (grid.bottom - grid.top) / grid.rows, y1 = grid.top + (row + 1) * (grid.bottom - grid.top) / grid.rows;
  const bins = new Map(); let darkCount = 0, totalSamples = 0, darkSum = [0, 0, 0];
  for (let sy = .2; sy <= .8; sy += .1) for (let sx = .2; sx <= .8; sx += .1) {
    const x = clamp(Math.round(x0 + (x1 - x0) * sx), 0, width - 1), y = clamp(Math.round(y0 + (y1 - y0) * sy), 0, els.canvas.height - 1), i = (y * width + x) * 4;
    const rgb = [data[i], data[i + 1], data[i + 2]], lum = luminance(...rgb); totalSamples++;
    if (lum < 75 && saturation(...rgb) < .2) { darkCount++; darkSum[0] += rgb[0]; darkSum[1] += rgb[1]; darkSum[2] += rgb[2]; continue; }
    const key = `${rgb[0] >> 4},${rgb[1] >> 4},${rgb[2] >> 4}`, bin = bins.get(key) || { count: 0, sum: [0, 0, 0] };
    bin.count++; bin.sum[0] += rgb[0]; bin.sum[1] += rgb[1]; bin.sum[2] += rgb[2]; bins.set(key, bin);
  }
  if (darkCount / Math.max(1, totalSamples) > .42) return { rgb: darkSum.map(value => value / darkCount), x0, x1, y0, y1 };
  if (!bins.size) return { rgb: [0, 0, 0], x0, x1, y0, y1 };
  const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0], rgb = dominant.sum.map(value => value / dominant.count);
  return { rgb, x0, x1, y0, y1 };
}

function rgbSquaredDistance(a, b) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function detectSheetColorProfile(grid) {
  const hits = new Set();
  for (let row = 0; row < grid.rows; row++) for (let col = 0; col < grid.cols; col++) {
    const { rgb } = readCellColor(grid, col, row);
    for (let index = 0; index < NUMBERED_SHEET_COLOR_PROFILE.signatures.length; index++) {
      if (rgbSquaredDistance(rgb, NUMBERED_SHEET_COLOR_PROFILE.signatures[index]) <= 12 ** 2) hits.add(index);
    }
    if (hits.size >= 4) return NUMBERED_SHEET_COLOR_PROFILE;
  }
  return null;
}

function matchNumberedSheetColor(rgb) {
  let nearestAnchor = null, distance = Infinity;
  for (const [code, red, green, blue] of state.sheetColorProfile?.anchors || []) {
    const score = rgbSquaredDistance(rgb, [red, green, blue]);
    if (score < distance) { distance = score; nearestAnchor = code; }
  }
  if (nearestAnchor && distance <= 12 ** 2) return state.mard.find(color => color.code === nearestAnchor);
  return nearestMard(rgb);
}

function sampleCell(grid, col, row) {
  const data = state.original.data, width = els.canvas.width;
  const { rgb, x0, x1, y0, y1 } = readCellColor(grid, col, row);
  const dominantLuminance = luminance(...rgb), dominantSaturation = saturation(...rgb);
  if (dominantLuminance > 225 && dominantSaturation < .1) {
    if (!cellHasPrintedCode(data, width, els.canvas.height, x0, x1, y0, y1, rgb)) return null;
    // In numbered MARD sheets, neutral paper-white cells with printed text are H2.
    // Prefer the standard white over the numerically identical T-series material.
    if (dominantLuminance >= 252 && dominantSaturation < .025) return state.mard.find(color => color.code === "H2");
  }
  return matchNumberedSheetColor(rgb);
}

function analyzeGridCells(grid) {
  state.sheetColorProfile = detectSheetColorProfile(grid);
  const colors = new Map(); grid.cells = new Array(grid.cols * grid.rows);
  for (let row = 0; row < grid.rows; row++) for (let col = 0; col < grid.cols; col++) {
    const color = sampleCell(grid, col, row), index = row * grid.cols + col; grid.cells[index] = color ? color.code : null;
    if (color) { const item = colors.get(color.code) || { ...color, count: 0 }; item.count++; colors.set(color.code, item); }
  }
  grid.codeCounts = new Map([...colors].map(([code, item]) => [code, item.count]));
  return [...colors.values()].sort(sortByCode);
}

async function analyzeGridCellsAsync(grid, onProgress) {
  state.sheetColorProfile = detectSheetColorProfile(grid);
  const colors = new Map(); grid.cells = new Array(grid.cols * grid.rows);
  const yieldEvery = grid.rows >= 120 ? 2 : 3;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const color = sampleCell(grid, col, row), index = row * grid.cols + col;
      grid.cells[index] = color ? color.code : null;
      if (color) {
        const item = colors.get(color.code) || { ...color, count: 0 };
        item.count++; colors.set(color.code, item);
      }
    }
    onProgress?.((row + 1) / grid.rows);
    if ((row + 1) % yieldEvery === 0 && row + 1 < grid.rows) await new Promise(resolve => setTimeout(resolve, 0));
  }
  grid.codeCounts = new Map([...colors].map(([code, item]) => [code, item.count]));
  return [...colors.values()].sort(sortByCode);
}

async function analyzeFallbackColors(image) {
  const analysis = makeAnalysisCanvas(image, 240), data = analysis.pixels, bins = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 100) continue; const rgb = [data[i], data[i + 1], data[i + 2]], lum = luminance(...rgb);
    if (lum < 75 && saturation(...rgb) < .18) continue;
    const key = `${rgb[0] >> 4},${rgb[1] >> 4},${rgb[2] >> 4}`, bin = bins.get(key) || { count: 0, sum: [0, 0, 0] };
    bin.count++; bin.sum[0] += rgb[0]; bin.sum[1] += rgb[1]; bin.sum[2] += rgb[2]; bins.set(key, bin);
  }
  const mapped = new Map(), candidates = [...bins.values()].sort((a, b) => b.count - a.count).slice(0, 30);
  for (const bin of candidates) { const color = nearestMard(bin.sum.map(value => value / bin.count)), item = mapped.get(color.code) || { ...color, count: 0 }; item.count += bin.count; mapped.set(color.code, item); }
  const used = [...mapped.values()].sort((a, b) => b.count - a.count).slice(0, 20).sort(sortByCode);
  const pixels = state.original.data, groups = new Uint8Array(pixels.length / 4), chunk = 180000;
  for (let start = 0; start < groups.length; start += chunk) {
    const end = Math.min(groups.length, start + chunk);
    for (let p = start; p < end; p++) { const i = p * 4; let best = 0, score = Infinity; for (let j = 0; j < used.length; j++) { const d = rgbDistance([pixels[i], pixels[i + 1], pixels[i + 2]], used[j].rgb); if (d < score) { score = d; best = j; } } groups[p] = best; }
    if (end < groups.length) await new Promise(resolve => setTimeout(resolve, 0));
  }
  state.fallbackGroups = groups; return used;
}

function renderPalette() {
  const query = els.search.value.trim().toUpperCase(); els.palette.innerHTML = "";
  const colors = state.used.filter(color => !query || color.code.includes(query) || color.series.includes(query));
  colors.sort($("paletteSort").value === "count" ? (a, b) => (b.count || 0) - (a.count || 0) || sortByCode(a, b) : sortByCode);
  els.palette.style.setProperty("--palette-columns", Math.max(1, Math.ceil(colors.length / 2)));
  if (!colors.length) { els.palette.innerHTML = '<div class="palette-empty">没有匹配的色号</div>'; return; }
  for (const color of colors) {
    const button = document.createElement("button"); button.className = `palette-item${state.selected.has(color.code) ? " active" : ""}`;
    const quantity = color.count || 0;
    button.style.setProperty("--swatch", color.hex);
    button.setAttribute("aria-label", `${color.code}，${quantity} 颗`);
    button.innerHTML = `<span class="swatch" style="background:${color.hex}" aria-hidden="true"></span><strong>${color.code}</strong><span class="color-count">${quantity}</span>`;
    button.onclick = () => { state.selected.has(color.code) ? state.selected.delete(color.code) : state.selected.add(color.code); renderPalette(); renderFocus(); updateSummary(); };
    els.palette.appendChild(button);
  }
}

function hidePixel(pixels, index) {
  pixels[index] = 255;
  pixels[index + 1] = 255;
  pixels[index + 2] = 255;
}
function neutralizeGridPixel(pixels, index) {
  pixels[index] = 218;
  pixels[index + 1] = 218;
  pixels[index + 2] = 218;
}

function mirroredBaseImage() {
  if (!state.grid) return null;
  if (state.mirroredBase) return state.mirroredBase;
  const source = state.original.data, width = els.canvas.width, height = els.canvas.height;
  const output = new ImageData(new Uint8ClampedArray(source), width, height), pixels = output.data;
  const { left, right, top, bottom, cols } = state.grid;
  const edges = Array.from({ length: cols + 1 }, (_, index) => Math.round(left + index * (right - left) / cols));
  for (let y = top; y < bottom; y++) {
    for (let destCol = 0; destCol < cols; destCol++) {
      const sourceCol = cols - 1 - destCol;
      const destLeft = edges[destCol], destRight = edges[destCol + 1];
      const sourceLeft = edges[sourceCol], sourceRight = edges[sourceCol + 1];
      const destWidth = destRight - destLeft, sourceWidth = sourceRight - sourceLeft;
      if (destWidth === sourceWidth) {
        const sourceIndex = (y * width + sourceLeft) * 4, destIndex = (y * width + destLeft) * 4;
        pixels.set(source.subarray(sourceIndex, sourceIndex + sourceWidth * 4), destIndex);
      } else {
        for (let x = destLeft; x < destRight; x++) {
          const sourceX = sourceLeft + Math.min(sourceWidth - 1, Math.floor((x - destLeft) * sourceWidth / destWidth));
          const sourceIndex = (y * width + sourceX) * 4, destIndex = (y * width + x) * 4;
          pixels[destIndex] = source[sourceIndex]; pixels[destIndex + 1] = source[sourceIndex + 1];
          pixels[destIndex + 2] = source[sourceIndex + 2]; pixels[destIndex + 3] = source[sourceIndex + 3];
        }
      }
    }
  }
  state.mirroredBase = output;
  return output;
}

function displayBaseImage() {
  return state.mirrored && state.grid ? mirroredBaseImage() : state.original;
}

function safeFileBase() {
  return (state.name || "拼豆图纸").replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "拼豆图纸";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function imageDataBlob(imageData) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas"); canvas.width = imageData.width; canvas.height = imageData.height;
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG 生成失败")), "image/png");
  });
}

async function exportPattern(kind) {
  if (!state.image || !state.original) return toast("请先添加图纸");
  try {
    if (kind === "txt") {
      if (!state.grid) return toast("需要先识别网格才能导出数量");
      const colors = [...state.used].sort(sortByCode), total = colors.reduce((sum, color) => sum + (color.count || 0), 0);
      const lines = [`规格：${state.grid.cols}×${state.grid.rows}`, `颜色数：${colors.length}`, `总豆数：${total}`, "", ...colors.map(color => `${color.code} ${color.count || 0}颗`)];
      downloadBlob(new Blob(["\ufeff", lines.join("\r\n")], { type: "text/plain;charset=utf-8" }), `${safeFileBase()}_拼豆数量.txt`);
      toast("拼豆数量 TXT 已导出");
    } else {
      const imageData = kind === "mirror" ? mirroredBaseImage() : state.original;
      if (!imageData) return toast("需要先识别网格才能导出镜像图");
      downloadBlob(await imageDataBlob(imageData), `${safeFileBase()}_${kind === "mirror" ? "高清镜像图" : "高清原图"}.png`);
      toast(kind === "mirror" ? "高清镜像图已导出" : "高清原图已导出");
    }
    $("exportMenu").removeAttribute("open");
  } catch (error) {
    console.error(error); toast(error.message || "导出失败", 3500);
  }
}

function renderFocus() {
  const token = ++state.renderToken;
  const base = displayBaseImage();
  if (!state.selected.size) { ctx.putImageData(base, 0, 0); return; }
  const output = new ImageData(new Uint8ClampedArray(base.data), els.canvas.width, els.canvas.height), pixels = output.data;
  requestAnimationFrame(() => {
    if (token !== state.renderToken) return;
    if (state.grid) {
      const grid = state.grid, cellW = (grid.right - grid.left) / grid.cols, cellH = (grid.bottom - grid.top) / grid.rows;
      for (let y = grid.top; y < grid.bottom; y++) {
        const row = clamp(Math.floor((y - grid.top) / cellH), 0, grid.rows - 1), localY = (y - grid.top) % cellH;
        for (let x = grid.left; x < grid.right; x++) {
          const col = clamp(Math.floor((x - grid.left) / cellW), 0, grid.cols - 1);
          const sourceCol = state.mirrored ? grid.cols - 1 - col : col, code = grid.cells[row * grid.cols + sourceCol];
          if (!code || state.selected.has(code)) continue;
          const localX = (x - grid.left) % cellW, border = localX < 1.25 || cellW - localX < 1.25 || localY < 1.25 || cellH - localY < 1.25;
          const index = (y * els.canvas.width + x) * 4;
          border ? neutralizeGridPixel(pixels, index) : hidePixel(pixels, index);
        }
      }
    } else {
      for (let p = 0; p < state.fallbackGroups.length; p++) { const expected = state.used[state.fallbackGroups[p]]; if (expected && !state.selected.has(expected.code)) hidePixel(pixels, p * 4); }
    }
    if (token === state.renderToken) ctx.putImageData(output, 0, 0);
  });
}

function updateGridReadout() {
  if (state.grid) { $("gridStatus").textContent = `网格识别 ${state.grid.confidence}%`; $("gridSize").textContent = `${state.grid.cols} × ${state.grid.rows}`; }
  else { state.mirrored = false; $("mirrorButton").classList.remove("active"); $("gridStatus").textContent = "色块识别模式"; $("gridSize").textContent = "未识别网格"; }
  $("mirrorButton").disabled = !state.grid;
  $("exportMirror").disabled = !state.grid;
  $("exportTxt").disabled = !state.grid;
}
function updateGridControls() {
  if (!state.grid) return;
  $("autoGridOption").textContent = `自动 · ${state.grid.cols}×${state.grid.rows}`;
  els.gridPreset.value = "auto";
  els.gridCols.value = state.grid.cols;
  els.gridRows.value = state.grid.rows;
  els.customGrid.classList.add("hidden");
}

async function reanalyzeGrid(forcedSize = null) {
  if (!state.image || state.analysisBusy) return;
  state.analysisBusy = true;
  els.gridPreset.disabled = true;
  $("applyGrid").disabled = true;
  toast(forcedSize ? `正在应用 ${forcedSize.cols}×${forcedSize.rows} 规格…` : "正在重新识别网格…", 6000);
  await new Promise(resolve => requestAnimationFrame(resolve));
  try {
    const grid = detectGrid(state.image, forcedSize);
    if (!grid) throw new Error("未能定位规则网格边界");
    state.selected.clear(); state.grid = grid; state.mirroredBase = null; state.used = analyzeGridCells(grid);
    renderPalette(); renderFocus(); updateSummary(); updateGridReadout();
    $("autoGridOption").textContent = `自动 · ${grid.cols}×${grid.rows}`;
    els.gridCols.value = grid.cols; els.gridRows.value = grid.rows;
    toast(`已应用 ${grid.cols}×${grid.rows} 规格，识别 ${state.used.length} 个 MARD 色号`);
  } catch (error) {
    console.error(error); toast(error.message || "规格应用失败", 3500);
  } finally {
    state.analysisBusy = false; els.gridPreset.disabled = false; $("applyGrid").disabled = false;
  }
}
function updateSummary() {
  const colors = state.used.filter(color => state.selected.has(color.code)), count = colors.length;
  $("focusStatus").textContent = count ? `已高亮 ${count} 个色号` : "显示全部颜色";
  $("currentCode").textContent = count ? colors.map(color => color.code).join("、") : "无";
  $("remainingCount").textContent = count ? "仅显示高亮颜色" : "显示全部颜色";
  $("currentDot").style.background = count === 1 ? colors[0].hex : count > 1 ? `linear-gradient(135deg,${colors.slice(0, 5).map(color => color.hex).join(",")})` : "#111";
}
function clearFocus() { state.selected.clear(); renderPalette(); renderFocus(); updateSummary(); }

function transformCanvas() {
  state.zoom = clamp(state.zoom, MIN_ZOOM, MAX_ZOOM);
  constrainPan();
  els.canvas.style.transform = `translate(${state.x}px,${state.y}px) scale(${state.zoom})`;
  $("zoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;
  $("zoomOut").disabled = state.zoom <= MIN_ZOOM + .001;
}
function constrainPan() {
  if (!state.image) return;
  const baseWidth = Number.parseFloat(els.canvas.style.width) || els.canvas.width;
  const baseHeight = Number.parseFloat(els.canvas.style.height) || els.canvas.height;
  const scaledWidth = baseWidth * state.zoom, scaledHeight = baseHeight * state.zoom;
  const maxX = Math.max(0, Math.abs(els.stage.clientWidth - scaledWidth) / 2 - 1);
  const maxY = Math.max(0, Math.abs(els.stage.clientHeight - scaledHeight) / 2 - 1);
  state.x = clamp(state.x, -maxX, maxX);
  state.y = clamp(state.y, -maxY, maxY);
}
function setZoom(value) { state.zoom = clamp(value, MIN_ZOOM, MAX_ZOOM); transformCanvas(); }

function mountStartGallery() {
  const dialog = $("demoDialog"), target = $("startGallery"), grid = dialog?.querySelector(".demo-grid");
  if (target && grid) target.appendChild(grid);
  dialog?.remove();
}

function showStartGallery(focusShell = null) {
  els.empty.classList.remove("hidden");
  els.canvas.classList.add("hidden");
  els.stage.classList.remove("has-image");
  els.boardPanel.classList.remove("has-image");
  els.imageCard.classList.add("hidden");
  els.paletteSection.classList.add("hidden");
  els.selectionRow.classList.add("hidden");
  els.current.classList.add("hidden");
  if (focusShell) requestAnimationFrame(() => focusShell.scrollIntoView({ behavior: "smooth", block: "nearest" }));
}

function readStoredList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
  } catch (error) {
    console.warn(`无法读取示例图库设置 ${key}`, error);
    return [];
  }
}

function writeStoredList(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (error) { console.warn(`无法保存示例图库设置 ${key}`, error); }
}

function openExampleDatabase() {
  if (state.exampleDbPromise) return state.exampleDbPromise;
  state.exampleDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(EXAMPLE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(EXAMPLE_DB_STORE)) database.createObjectStore(EXAMPLE_DB_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("示例图库数据库无法打开"));
    request.onblocked = () => reject(new Error("示例图库数据库正被其他页面占用"));
  });
  return state.exampleDbPromise;
}

async function readUploadedExamples() {
  const database = await openExampleDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(EXAMPLE_DB_STORE, "readonly").objectStore(EXAMPLE_DB_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("无法读取已上传示例"));
  });
}

async function storeUploadedExample(record) {
  const database = await openExampleDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(EXAMPLE_DB_STORE, "readwrite");
    transaction.objectStore(EXAMPLE_DB_STORE).put(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("示例图纸保存失败"));
    transaction.onabort = () => reject(transaction.error || new Error("示例图纸保存已取消"));
  });
}

async function removeUploadedExample(id) {
  const database = await openExampleDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(EXAMPLE_DB_STORE, "readwrite");
    transaction.objectStore(EXAMPLE_DB_STORE).delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("示例图纸删除失败"));
    transaction.onabort = () => reject(transaction.error || new Error("示例图纸删除已取消"));
  });
}

function exampleGrid() { return document.querySelector("#startGallery .demo-grid"); }
function builtinExampleId(card) { return `builtin:${String(card.dataset.demoSrc || "").split("/").pop()}`; }

function saveExampleOrder() {
  const grid = exampleGrid();
  if (!grid) return;
  writeStoredList(EXAMPLE_ORDER_KEY, [...grid.querySelectorAll(":scope > .demo-card-shell")].map(shell => shell.dataset.exampleId));
}

function refreshExampleNumbers() {
  const grid = exampleGrid();
  if (!grid) return;
  [...grid.querySelectorAll(":scope > .demo-card-shell")].forEach((shell, index) => {
    const title = shell.querySelector(".demo-card strong");
    if (title) title.textContent = `示例 ${String(index + 1).padStart(2, "0")}`;
  });
}

function applyStoredExampleOrder() {
  const grid = exampleGrid();
  if (!grid) return;
  const shells = [...grid.querySelectorAll(":scope > .demo-card-shell")];
  const byId = new Map(shells.map(shell => [shell.dataset.exampleId, shell]));
  const ordered = readStoredList(EXAMPLE_ORDER_KEY).map(id => byId.get(id)).filter(Boolean);
  const included = new Set(ordered);
  [...ordered, ...shells.filter(shell => !included.has(shell))].forEach(shell => grid.appendChild(shell));
  refreshExampleNumbers();
}

function finishExamplePointerDrag(event) {
  const drag = state.examplePointerDrag;
  if (!drag || (event && event.pointerId !== drag.pointerId)) return;
  window.removeEventListener("pointermove", moveExamplePointerDrag);
  window.removeEventListener("pointerup", finishExamplePointerDrag);
  window.removeEventListener("pointercancel", finishExamplePointerDrag);
  drag.shell.classList.remove("is-dragging");
  drag.handle.classList.remove("active");
  drag.handle.setAttribute("aria-grabbed", "false");
  if (drag.handle.hasPointerCapture?.(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  state.examplePointerDrag = null;
  refreshExampleNumbers();
  saveExampleOrder();
}

function moveExamplePointerDrag(event) {
  const drag = state.examplePointerDrag, grid = exampleGrid();
  if (!drag || !grid || event.pointerId !== drag.pointerId) return;
  event.preventDefault();
  const gallery = $("startGallery"), galleryRect = gallery.getBoundingClientRect();
  if (event.clientY < galleryRect.top + 56) gallery.scrollTop -= 18;
  else if (event.clientY > galleryRect.bottom - 56) gallery.scrollTop += 18;
  const target = [...grid.querySelectorAll(":scope > .demo-card-shell")].find(shell => {
    if (shell === drag.shell) return false;
    const rect = shell.getBoundingClientRect();
    return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
  });
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const sameRow = Math.abs(event.clientY - (rect.top + rect.height / 2)) < rect.height * .38;
  const insertBefore = sameRow ? event.clientX < rect.left + rect.width / 2 : event.clientY < rect.top + rect.height / 2;
  grid.insertBefore(drag.shell, insertBefore ? target : target.nextSibling);
}

function beginExamplePointerDrag(event, shell, handle) {
  if (!state.adminMode || event.button > 0) return;
  event.preventDefault();
  event.stopPropagation();
  finishExamplePointerDrag();
  state.examplePointerDrag = { shell, handle, pointerId: event.pointerId };
  shell.classList.add("is-dragging");
  handle.classList.add("active");
  handle.setAttribute("aria-grabbed", "true");
  handle.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", moveExamplePointerDrag, { passive: false });
  window.addEventListener("pointerup", finishExamplePointerDrag);
  window.addEventListener("pointercancel", finishExamplePointerDrag);
}

async function deleteExample(shell) {
  if (!state.adminMode || !shell) return;
  const card = shell.querySelector(".demo-card"), id = shell.dataset.exampleId;
  const label = card?.dataset.demoName || "这张示例图纸";
  if (!window.confirm(`确定从示例图库删除“${label}”吗？`)) return;
  try {
    if (shell.dataset.uploaded === "true") {
      await removeUploadedExample(id);
      const source = state.uploadedExampleUrls.get(id);
      if (source) URL.revokeObjectURL(source);
      state.uploadedExampleUrls.delete(id);
    } else {
      const hidden = new Set(readStoredList(EXAMPLE_HIDDEN_KEY));
      hidden.add(id);
      writeStoredList(EXAMPLE_HIDDEN_KEY, [...hidden]);
    }
    shell.remove();
    refreshExampleNumbers();
    saveExampleOrder();
    toast("示例图纸已删除");
  } catch (error) {
    console.error(error);
    toast("删除失败，请稍后重试", 3500);
  }
}

function enhanceExampleCard(card, id, uploaded = false) {
  if (!card) return null;
  card.dataset.exampleId = id;
  card.onclick = () => loadDemoPattern(card.dataset.demoSrc, card.dataset.demoName, card.dataset.demoGrid);
  let shell = card.closest(".demo-card-shell");
  if (!shell) {
    shell = document.createElement("div");
    shell.className = "demo-card-shell";
    card.before(shell);
    shell.appendChild(card);
  }
  shell.dataset.exampleId = id;
  shell.dataset.uploaded = String(uploaded);
  if (!shell.querySelector(".demo-card-admin")) {
    const controls = document.createElement("div");
    controls.className = "demo-card-admin";
    const handle = document.createElement("button");
    handle.className = "demo-drag-handle";
    handle.type = "button";
    handle.setAttribute("aria-label", "拖动排序");
    handle.setAttribute("aria-grabbed", "false");
    handle.title = "按住拖动排序";
    handle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h8M8 12h8M8 18h8"></path></svg>';
    const remove = document.createElement("button");
    remove.className = "demo-delete-button";
    remove.type = "button";
    remove.setAttribute("aria-label", "删除示例图纸");
    remove.title = "删除示例图纸";
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"></path></svg>';
    handle.onpointerdown = event => beginExamplePointerDrag(event, shell, handle);
    remove.onclick = event => { event.preventDefault(); event.stopPropagation(); deleteExample(shell); };
    controls.append(handle, remove);
    shell.appendChild(controls);
  }
  return shell;
}

function createUploadedExampleCard(record) {
  const previousSource = state.uploadedExampleUrls.get(record.id);
  if (previousSource) URL.revokeObjectURL(previousSource);
  const source = URL.createObjectURL(record.blob);
  state.uploadedExampleUrls.set(record.id, source);
  const card = document.createElement("button");
  card.className = "demo-card";
  card.type = "button";
  card.dataset.demoSrc = source;
  card.dataset.demoName = record.name;
  card.dataset.demoGrid = record.gridSpec || "";
  const image = document.createElement("img");
  image.src = source;
  image.alt = `${record.name} 示例图纸`;
  const caption = document.createElement("span"), title = document.createElement("strong"), size = document.createElement("small");
  title.textContent = "示例";
  size.textContent = record.gridSpec ? record.gridSpec.replace("x", " × ") : "自动识别";
  caption.append(title, size);
  card.append(image, caption);
  return enhanceExampleCard(card, record.id, true);
}

async function initializeExampleGallery() {
  const grid = exampleGrid();
  if (!grid) throw new Error("示例图库不可用");
  const hidden = new Set(readStoredList(EXAMPLE_HIDDEN_KEY));
  [...grid.querySelectorAll(":scope > .demo-card")].forEach(card => {
    const id = builtinExampleId(card);
    if (hidden.has(id)) card.remove();
    else enhanceExampleCard(card, id, false);
  });
  const uploaded = await readUploadedExamples();
  uploaded.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  uploaded.forEach(record => {
    const shell = createUploadedExampleCard(record);
    if (shell) grid.appendChild(shell);
  });
  applyStoredExampleOrder();
  setAdminMode(state.adminMode, false);
}

function setAdminMode(enabled, announce = true) {
  state.adminMode = enabled;
  const button = $("adminModeButton"), upload = $("uploadExamplePattern");
  button.classList.toggle("active", enabled);
  button.setAttribute("aria-pressed", String(enabled));
  button.setAttribute("aria-label", enabled ? "关闭管理员模式" : "开启管理员模式");
  $("emptyBoard").classList.toggle("admin-active", enabled);
  $("startGallery").classList.toggle("is-admin", enabled);
  upload.classList.toggle("hidden", !enabled);
  document.querySelectorAll(".demo-card-admin").forEach(controls => controls.setAttribute("aria-hidden", String(!enabled)));
  if (announce) toast(enabled ? "管理员模式已开启，可拖动排序或删除" : "管理员模式已关闭");
}

function adminSessionCookieSuffix(maxAge, expiresAt) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  return `; Path=/; Max-Age=${maxAge}; Expires=${new Date(expiresAt).toUTCString()}; SameSite=Strict${secure}`;
}

function readAdminSessionExpiry() {
  const prefix = `${ADMIN_SESSION_COOKIE}=`;
  const raw = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(prefix));
  if (!raw) return 0;
  const match = decodeURIComponent(raw.slice(prefix.length)).match(/^v1\.(\d+)$/);
  if (!match) return 0;
  const expiresAt = Number(match[1]), now = Date.now();
  const maximum = now + ADMIN_SESSION_MAX_AGE_SECONDS * 1000 + 5 * 60 * 1000;
  return Number.isFinite(expiresAt) && expiresAt > now && expiresAt <= maximum ? expiresAt : 0;
}

function clearAdminSession() {
  document.cookie = `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict${location.protocol === "https:" ? "; Secure" : ""}`;
  state.adminSessionExpiresAt = 0;
  state.adminSessionRenewedAt = 0;
}

function renewAdminSession(force = false) {
  if (!state.adminMode) return false;
  const now = Date.now();
  if (state.adminSessionExpiresAt && now >= state.adminSessionExpiresAt) {
    clearAdminSession();
    setAdminMode(false, false);
    toast("管理员登录已过期，请重新输入密钥", 3500);
    return false;
  }
  if (!force && now - state.adminSessionRenewedAt < ADMIN_SESSION_RENEW_THROTTLE_MS) return true;
  const expiresAt = now + ADMIN_SESSION_MAX_AGE_SECONDS * 1000;
  const value = encodeURIComponent(`${ADMIN_SESSION_VERSION}.${expiresAt}`);
  document.cookie = `${ADMIN_SESSION_COOKIE}=${value}${adminSessionCookieSuffix(ADMIN_SESSION_MAX_AGE_SECONDS, expiresAt)}`;
  state.adminSessionExpiresAt = expiresAt;
  state.adminSessionRenewedAt = now;
  return true;
}

function restoreAdminSession() {
  const expiresAt = readAdminSessionExpiry();
  if (!expiresAt) {
    clearAdminSession();
    return false;
  }
  state.adminSessionExpiresAt = expiresAt;
  setAdminMode(true, false);
  return renewAdminSession(true);
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function openAdminKeyDialog() {
  const dialog = $("adminKeyDialog"), input = $("adminKeyInput"), error = $("adminKeyError");
  input.value = "";
  error.classList.add("hidden");
  dialog.showModal();
  requestAnimationFrame(() => input.focus());
}

async function verifyAdminKey(event) {
  event.preventDefault();
  const dialog = $("adminKeyDialog"), input = $("adminKeyInput"), error = $("adminKeyError"), submit = $("adminKeySubmit");
  submit.disabled = true;
  try {
    if (!crypto.subtle || await sha256Hex(input.value) !== ADMIN_KEY_SHA256) {
      input.value = "";
      input.setAttribute("aria-invalid", "true");
      error.classList.remove("hidden");
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    dialog.close();
    setAdminMode(true);
    state.adminSessionExpiresAt = Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000;
    renewAdminSession(true);
  } catch (errorValue) {
    console.error(errorValue);
    toast("当前浏览器无法验证管理员密钥", 3500);
  } finally {
    submit.disabled = false;
  }
}

async function saveCalibratedExample(blob, filename, gridSpec) {
  const grid = exampleGrid(), uploadButton = $("uploadExamplePattern");
  if (!grid) return toast("示例图库不可用");
  uploadButton.disabled = true;
  uploadButton.textContent = "正在保存…";
  try {
    const id = `uploaded:${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    const normalizedName = filename.replace(/\.[^.]+$/, "") + ".png";
    const record = { id, name: normalizedName, type: "image/png", blob, gridSpec, createdAt: Date.now() };
    await storeUploadedExample(record);
    navigator.storage?.persist?.().catch(() => {});
    const shell = createUploadedExampleCard(record);
    grid.appendChild(shell);
    refreshExampleNumbers();
    saveExampleOrder();
    showStartGallery(shell);
    toast(`示例图纸已按 ${gridSpec.replace("x", "×")} 保存`, 3200);
  } catch (error) {
    console.error(error);
    toast("示例图纸保存失败，请检查浏览器存储空间", 4200);
  } finally {
    uploadButton.disabled = false;
    uploadButton.textContent = "上传示例图纸";
  }
}

function addUploadedExample(file) {
  if (!state.adminMode) return toast("请先开启管理员模式");
  renewAdminSession();
  acceptFile(file, "example");
}

function loadDemoPattern(source, filename, gridSpec) {
  const dialog = $("demoDialog");
  if (dialog && typeof dialog.close === "function") dialog.close();
  else dialog?.removeAttribute("open");
  const image = new Image();
  image.decoding = "async";
  const [cols, rows] = String(gridSpec || "").split("x").map(Number);
  const forcedSize = cols && rows ? { cols, rows } : null;
  image.onload = () => loadImage(image, filename, forcedSize);
  image.onerror = () => toast("示例图纸加载失败", 3500);
  image.src = source;
}

mountStartGallery();
restoreAdminSession();
initializeExampleGallery().catch(error => { console.error(error); toast("已加载内置示例，但本地示例图库不可用", 4200); });
$("addPattern").onclick = () => els.file.click();
$("adminModeButton").onclick = () => {
  if (!state.adminMode) return openAdminKeyDialog();
  clearAdminSession();
  setAdminMode(false);
};
$("adminKeyForm").onsubmit = verifyAdminKey;
$("cancelAdminKey").onclick = () => $("adminKeyDialog").close();
$("adminKeyDialog").onclose = () => {
  $("adminKeyInput").value = "";
  $("adminKeyInput").removeAttribute("aria-invalid");
  $("adminKeyError").classList.add("hidden");
};
$("uploadExamplePattern").onclick = () => $("exampleFileInput").click();
$("exampleFileInput").onchange = event => addUploadedExample(event.target.files[0]);
$("newPattern").onclick = () => els.file.click(); els.file.onchange = event => acceptFile(event.target.files[0]);
window.addEventListener("beforeunload", () => state.uploadedExampleUrls.forEach(source => URL.revokeObjectURL(source)));
document.addEventListener("pointerdown", () => renewAdminSession(), { passive: true });
document.addEventListener("keydown", () => renewAdminSession());
document.addEventListener("visibilitychange", () => { if (!document.hidden) renewAdminSession(); });

for (const kind of ["red", "blue", "green", "yellow"]) $(`${kind}Crosshair`).onpointerdown = event => handleCrosshairPointer(event, kind);
for (const [id, kind] of [["redCrosshair", "red"], ["blueCrosshair", "blue"], ["greenCrosshair", "green"], ["yellowCrosshair", "yellow"]]) {
  $(id).onkeydown = event => {
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault(); setActiveCrosshair(kind); nudgeActiveCrosshair(direction[0], direction[1], event.shiftKey ? 10 : 1);
  };
}
$("selectRedCrosshair").onclick = () => setActiveCrosshair("red");
$("selectBlueCrosshair").onclick = () => setActiveCrosshair("blue");
$("selectGreenCrosshair").onclick = () => setActiveCrosshair("green");
$("selectYellowCrosshair").onclick = () => setActiveCrosshair("yellow");
document.querySelectorAll(".nudge-pad button").forEach(button => button.onclick = () => nudgeActiveCrosshair(Number(button.dataset.nudgeX || 0), Number(button.dataset.nudgeY || 0)));
els.alignmentCols.oninput = updateAlignmentGridFromInputs;
els.alignmentRows.oninput = updateAlignmentGridFromInputs;
els.alignmentPreset.onchange = event => {
  const alignment = state.alignment, value = event.target.value;
  if (!alignment) return;
  if (value === "auto") { alignment.detected ? applyDetectedAlignment() : runAutoAlignment(); return; }
  if (value === "custom") { els.alignmentCols.focus(); return; }
  const [cols, rows] = value.split("x").map(Number);
  alignment.cols = cols; alignment.rows = rows; alignment.manual = true;
  resetCellCalibration(alignment);
  $("alignmentDetection").textContent = `已人工设置 ${cols} × ${rows} 网格`;
  setAlignmentConfidence(alignment.detected?.confidence, true); renderAlignmentPreview();
};
$("resetAlignment").onclick = runAutoAlignment;
$("cancelAlignment").onclick = closeAlignment;
$("cancelAlignmentTop").onclick = closeAlignment;
$("confirmAlignment").onclick = confirmAlignment;
els.alignmentDialog.addEventListener("cancel", event => { if (state.alignment?.processing) event.preventDefault(); else closeAlignment(); });

$("showAll").onclick = clearFocus; els.search.oninput = renderPalette; $("paletteSort").onchange = renderPalette;
$("exportOriginal").onclick = () => exportPattern("original");
$("exportMirror").onclick = () => exportPattern("mirror");
$("exportTxt").onclick = () => exportPattern("txt");
els.gridPreset.onchange = event => {
  const value = event.target.value;
  els.customGrid.classList.toggle("hidden", value !== "custom");
  if (value === "auto") reanalyzeGrid();
  else if (value !== "custom") {
    const [cols, rows] = value.split("x").map(Number); reanalyzeGrid({ cols, rows });
  }
};
$("applyGrid").onclick = () => {
  const cols = clamp(Math.round(Number(els.gridCols.value)), 8, 300), rows = clamp(Math.round(Number(els.gridRows.value)), 8, 300);
  els.gridCols.value = cols; els.gridRows.value = rows; reanalyzeGrid({ cols, rows });
};
els.gridCols.onkeydown = els.gridRows.onkeydown = event => { if (event.key === "Enter") $("applyGrid").click(); };
els.drop.ondragover = event => { event.preventDefault(); els.drop.classList.add("dragging"); }; els.drop.ondragleave = () => els.drop.classList.remove("dragging");
els.drop.ondrop = event => { event.preventDefault(); els.drop.classList.remove("dragging"); acceptFile(event.dataTransfer.files[0]); };
$("mirrorButton").onclick = () => {
  if (!state.grid) return toast("需要先识别网格，才能正确重排色号");
  state.mirrored = !state.mirrored; $("mirrorButton").classList.toggle("active", state.mirrored);
  renderFocus(); transformCanvas();
};
$("zoomIn").onclick = () => setZoom(state.zoom + .25); $("zoomOut").onclick = () => setZoom(state.zoom - .25);
els.canvas.onpointerdown = event => { state.dragging = true; state.start = { x: event.clientX - state.x, y: event.clientY - state.y }; els.canvas.setPointerCapture(event.pointerId); };
els.canvas.onpointermove = event => { if (state.dragging) { state.x = event.clientX - state.start.x; state.y = event.clientY - state.start.y; transformCanvas(); } };
els.canvas.onpointerup = els.canvas.onpointercancel = () => state.dragging = false;
els.stage.addEventListener("wheel", event => { if (!state.image) return; event.preventDefault(); setZoom(state.zoom + (event.deltaY < 0 ? .1 : -.1)); }, { passive: false });
window.onresize = () => { if (state.image) fitCanvas(false); if (state.alignment) { layoutAlignmentCanvas(); renderAlignmentPreview(); } };
ensurePalette().catch(error => { console.error(error); toast("MARD 291 色库加载失败", 3500); });
