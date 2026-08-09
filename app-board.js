"use strict";

const $ = id => document.getElementById(id);
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 5;
const codeCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const sortByCode = (a, b) => codeCollator.compare(a.code, b.code);
const state = {
  image: null, name: "", mard: [], used: [], selected: new Set(), original: null,
  grid: null, fallbackGroups: null, mirroredBase: null, zoom: 1, mirrored: false, x: 0, y: 0,
  dragging: false, renderToken: 0, palettePromise: null, analysisBusy: false,
  adminMode: false, uploadedExampleUrls: []
};
const els = {
  workspace: $("workspace"), drop: $("boardStage"), file: $("fileInput"),
  canvas: $("beadCanvas"), stage: $("boardStage"), empty: $("emptyBoard"), palette: $("paletteList"),
  imageCard: $("imageCard"), paletteSection: $("paletteSection"), current: $("currentColor"),
  search: $("paletteSearch"), boardPanel: document.querySelector(".board-panel"),
  selectionRow: $("selectionRow"), gridPreset: $("gridPreset"), customGrid: $("customGrid"),
  gridCols: $("gridCols"), gridRows: $("gridRows")
};
const ctx = els.canvas.getContext("2d", { willReadFrequently: true });
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

function acceptFile(file) {
  if (!file || !file.type.startsWith("image/")) return toast("请选择 PNG、JPG 或 WEBP 图片");
  const reader = new FileReader();
  reader.onload = () => { const image = new Image(); image.onload = () => loadImage(image, file.name); image.onerror = () => toast("图片读取失败"); image.src = reader.result; };
  reader.readAsDataURL(file);
}

async function loadImage(image, filename, forcedSize = null) {
  Object.assign(state, { image, name: filename, used: [], grid: null, fallbackGroups: null, mirroredBase: null, zoom: 1, mirrored: false, x: 0, y: 0 });
  state.selected.clear(); els.search.value = "";
  $("mirrorButton").classList.remove("active");
  $("patternName").textContent = filename.replace(/\.[^.]+$/, "");
  $("imageResolution").textContent = `${image.naturalWidth} × ${image.naturalHeight} px · 原图 1:1`;
  $("gridStatus").textContent = "正在识别网格…"; $("gridSize").textContent = "—";
  els.workspace.classList.remove("hidden"); els.empty.classList.add("hidden"); els.selectionRow.classList.remove("hidden");
  els.canvas.classList.remove("hidden"); els.stage.classList.add("has-image"); els.boardPanel.classList.add("has-image"); els.imageCard.classList.remove("hidden"); els.paletteSection.classList.add("hidden"); els.current.classList.remove("hidden");
  toast("正在识别网格与 MARD 色号…", 6000); await new Promise(resolve => requestAnimationFrame(resolve));
  try {
    await ensurePalette(); prepareCanvas();
    state.grid = detectGrid(image, forcedSize);
    if (state.grid) state.used = analyzeGridCells(state.grid);
    else state.used = await analyzeFallbackColors(image);
    renderPalette(); renderFocus(); updateSummary(); updateGridReadout();
    updateGridControls();
    els.paletteSection.classList.remove("hidden");
    toast(state.grid ? `已识别 ${state.grid.cols}×${state.grid.rows} 网格和 ${state.used.length} 个 MARD 色号` : `未可靠识别网格，已按 MARD 色块模式分析`);
  } catch (error) {
    console.error(error); toast(error.message || "图纸分析失败", 4000);
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

function regularAxis(scores, coverage) {
  const positive = Array.from(scores), mean = positive.reduce((a, b) => a + b, 0) / positive.length;
  for (let i = 0; i < positive.length; i++) positive[i] = Math.max(0, positive[i] - mean);
  const maxPeriod = Math.min(120, Math.floor(scores.length / 6)), correlations = [];
  for (let period = 8; period <= maxPeriod; period++) {
    let sum = 0; for (let i = 0; i + period < positive.length; i++) sum += positive[i] * positive[i + period];
    correlations.push({ period, score: sum / Math.max(1, positive.length - period) });
  }
  const top = Math.max(...correlations.map(item => item.score));
  const seed = correlations.find(item => item.score >= top * .82)?.period; if (!seed) return null;

  const cap = quantile(scores, .92), periodCandidates = [];
  // Autocorrelation often prefers a strong harmonic (for example every second
  // grid line). Evaluate its sub-periods as well, then let repeated evidence at
  // every expected boundary select the real cell pitch.
  for (let divisor = 1; divisor <= 2; divisor++) {
    const centerPeriod = seed / divisor;
    if (centerPeriod < 7) break;
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
  if (!best || best.positions.length < 8) return null;

  const coverageEvidence = best.positions.map(position => axisPeak(coverage, position));
  const coverageThreshold = Math.max(...coverage) * .72, weakCoverageThreshold = Math.max(...coverage) * .48;
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

  const support = coverageEvidence.slice(first, last + 1).filter(value => value >= weakCoverageThreshold).length / Math.max(1, last - first + 1);
  return { start, end, period: best.period, regularity: clamp(.65 + support * .35, 0, 1) };
}

function detectGrid(image, forcedSize = null) {
  const analysis = makeAnalysisCanvas(image), scores = edgeScores(analysis.pixels, analysis.canvas.width, analysis.canvas.height);
  const xAxis = regularAxis(scores.vertical, scores.verticalCoverage), yAxis = regularAxis(scores.horizontal, scores.horizontalCoverage); if (!xAxis || !yAxis) return null;
  const sharedPeriod = (xAxis.period + yAxis.period) / 2;
  if (Math.abs(xAxis.period - yAxis.period) / sharedPeriod > .18) return null;
  const xNearFull = xAxis.start < sharedPeriod * 1.35 && analysis.canvas.width - xAxis.end < sharedPeriod * 1.35;
  const yNearFull = yAxis.start < sharedPeriod * 1.35 && analysis.canvas.height - yAxis.end < sharedPeriod * 1.35;
  if (xNearFull && yNearFull) {
    xAxis.start = 0; xAxis.end = analysis.canvas.width;
    yAxis.start = 0; yAxis.end = analysis.canvas.height;
  }
  const cols = forcedSize?.cols ?? Math.round((xAxis.end - xAxis.start) / sharedPeriod);
  const rows = forcedSize?.rows ?? Math.round((yAxis.end - yAxis.start) / sharedPeriod);
  const maximum = forcedSize ? 300 : 200;
  if (cols < 7 || rows < 7 || cols > maximum || rows > maximum) return null;
  const scale = 1 / analysis.ratio, confidence = Math.round(Math.min(xAxis.regularity, yAxis.regularity) * 100);
  if (confidence < 70) return null;
  return {
    left: Math.round(xAxis.start * scale), right: Math.round(xAxis.end * scale),
    top: Math.round(yAxis.start * scale), bottom: Math.round(yAxis.end * scale),
    cols, rows, confidence, cells: [], codeCounts: new Map()
  };
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

function sampleCell(grid, col, row) {
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
  if (darkCount / Math.max(1, totalSamples) > .42) return nearestMard(darkSum.map(value => value / darkCount));
  if (!bins.size) return state.mard.find(color => color.code === "H7");
  const dominant = [...bins.values()].sort((a, b) => b.count - a.count)[0], rgb = dominant.sum.map(value => value / dominant.count);
  if (luminance(...rgb) > 225 && saturation(...rgb) < .1 &&
      !cellHasPrintedCode(data, width, els.canvas.height, x0, x1, y0, y1, rgb)) return null;
  return nearestMard(rgb);
}

function analyzeGridCells(grid) {
  const colors = new Map(); grid.cells = new Array(grid.cols * grid.rows);
  for (let row = 0; row < grid.rows; row++) for (let col = 0; col < grid.cols; col++) {
    const color = sampleCell(grid, col, row), index = row * grid.cols + col; grid.cells[index] = color ? color.code : null;
    if (color) { const item = colors.get(color.code) || { ...color, count: 0 }; item.count++; colors.set(color.code, item); }
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

function setAdminMode(enabled) {
  state.adminMode = enabled;
  const button = $("adminModeButton"), upload = $("uploadExamplePattern");
  button.classList.toggle("active", enabled);
  button.setAttribute("aria-pressed", String(enabled));
  button.setAttribute("aria-label", enabled ? "关闭管理员模式" : "开启管理员模式");
  $("emptyBoard").classList.toggle("admin-active", enabled);
  upload.classList.toggle("hidden", !enabled);
  toast(enabled ? "管理员模式已开启" : "管理员模式已关闭");
}

function addUploadedExample(file) {
  if (!file || !file.type.startsWith("image/")) return toast("请选择 PNG、JPG 或 WEBP 图片");
  const grid = document.querySelector("#startGallery .demo-grid");
  if (!grid) return toast("示例图库不可用");
  const source = URL.createObjectURL(file);
  state.uploadedExampleUrls.push(source);
  const card = document.createElement("button");
  card.className = "demo-card";
  card.type = "button";
  card.dataset.demoSrc = source;
  card.dataset.demoName = file.name;
  const image = document.createElement("img");
  image.src = source;
  image.alt = `${file.name} 示例图纸`;
  const caption = document.createElement("span"), title = document.createElement("strong"), size = document.createElement("small");
  title.textContent = `示例 ${String(grid.children.length + 1).padStart(2, "0")}`;
  size.textContent = "自动识别";
  caption.append(title, size);
  card.append(image, caption);
  card.onclick = () => loadDemoPattern(source, file.name, "");
  grid.appendChild(card);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  toast("示例图纸已加入当前图库");
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
$("addPattern").onclick = () => els.file.click();
$("adminModeButton").onclick = () => setAdminMode(!state.adminMode);
$("uploadExamplePattern").onclick = () => $("exampleFileInput").click();
$("exampleFileInput").onchange = event => { addUploadedExample(event.target.files[0]); event.target.value = ""; };
document.querySelectorAll(".demo-card").forEach(card => card.onclick = () => loadDemoPattern(card.dataset.demoSrc, card.dataset.demoName, card.dataset.demoGrid));
$("newPattern").onclick = () => els.file.click(); els.file.onchange = event => acceptFile(event.target.files[0]);
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
window.onresize = () => state.image && fitCanvas(false);
ensurePalette().catch(error => { console.error(error); toast("MARD 291 色库加载失败", 3500); });
