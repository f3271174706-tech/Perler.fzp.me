"use strict";

// Compact working palette for the first local prototype. Codes follow the MARD family naming.
const PALETTE = [
  { code: "A1", name: "纯白", hex: "#F5F4EA" }, { code: "A2", name: "奶油白", hex: "#E9E0C8" },
  { code: "A3", name: "浅灰", hex: "#C9C7C0" }, { code: "A4", name: "中灰", hex: "#878A89" },
  { code: "A5", name: "黑色", hex: "#252729" }, { code: "B1", name: "柠檬黄", hex: "#F6DF55" },
  { code: "B2", name: "明黄", hex: "#F6C23F" }, { code: "B3", name: "橙色", hex: "#F18A3A" },
  { code: "B4", name: "珊瑚橙", hex: "#EF6648" }, { code: "C1", name: "浅粉", hex: "#F4B7BD" },
  { code: "C2", name: "桃粉", hex: "#EF8795" }, { code: "C3", name: "正红", hex: "#D9443F" },
  { code: "C4", name: "酒红", hex: "#923E4A" }, { code: "D1", name: "薰衣草", hex: "#B7A6D5" },
  { code: "D2", name: "紫色", hex: "#79569B" }, { code: "E1", name: "浅蓝", hex: "#A8D5E5" },
  { code: "E2", name: "天蓝", hex: "#58A9D2" }, { code: "E3", name: "宝蓝", hex: "#3866A6" },
  { code: "E4", name: "藏蓝", hex: "#263E63" }, { code: "F1", name: "薄荷绿", hex: "#A8D9BE" },
  { code: "F2", name: "草绿", hex: "#65B271" }, { code: "F3", name: "墨绿", hex: "#32664C" },
  { code: "G1", name: "肤色", hex: "#EDC39C" }, { code: "G2", name: "棕色", hex: "#9A684C" }
].map(color => ({ ...color, rgb: hexToRgb(color.hex) }));

const $ = id => document.getElementById(id);
const state = {
  image: null, imageName: "", cols: 32, rows: 32, cells: [], completed: new Set(),
  selected: null, zoom: 1, mirrored: false, tool: "mark", offsetX: 0, offsetY: 0, dragging: false
};

const els = {
  welcome: $("welcomePanel"), workspace: $("workspace"), dropZone: $("dropZone"), file: $("fileInput"),
  canvas: $("beadCanvas"), stage: $("boardStage"), empty: $("emptyBoard"), palette: $("paletteList"),
  setup: $("setupCard"), progress: $("progressCard"), paletteSection: $("paletteSection"), current: $("currentColor")
};
const ctx = els.canvas.getContext("2d");
let toastTimer;

function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
function colorDistance(a, b) {
  // Weighted RGB gives a visibly better quick match than plain Euclidean distance.
  const meanR = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + meanR / 256) * dr * dr + 4 * dg * dg + (2 + (255 - meanR) / 256) * db * db;
}
function nearestColor(rgb) { return PALETTE.reduce((best, color) => colorDistance(rgb, color.rgb) < colorDistance(rgb, best.rgb) ? color : best, PALETTE[0]); }
function showToast(text) {
  $("toast").textContent = text; $("toast").classList.add("show"); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 1800);
}

function acceptFile(file) {
  if (!file || !file.type.startsWith("image/")) return showToast("请选择 PNG、JPG 或 WEBP 图片");
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      state.image = image; state.imageName = file.name; $("patternName").textContent = file.name.replace(/\.[^.]+$/, "");
      els.welcome.classList.add("hidden"); els.workspace.classList.remove("hidden"); els.setup.classList.remove("hidden");
      els.empty.classList.remove("hidden"); els.canvas.classList.add("hidden");
      suggestGrid(image); showToast("图片已载入，请确认网格尺寸");
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function suggestGrid(image) {
  const base = 32;
  if (image.width >= image.height) { state.cols = base; state.rows = Math.max(4, Math.round(base * image.height / image.width)); }
  else { state.rows = base; state.cols = Math.max(4, Math.round(base * image.width / image.height)); }
  $("gridWidth").value = state.cols; $("gridHeight").value = state.rows;
}

function buildFromImage() {
  state.cols = Math.max(4, Math.min(100, Number($("gridWidth").value) || 32));
  state.rows = Math.max(4, Math.min(100, Number($("gridHeight").value) || 32));
  const sample = document.createElement("canvas"); sample.width = state.cols; sample.height = state.rows;
  const sctx = sample.getContext("2d", { willReadFrequently: true });
  sctx.imageSmoothingEnabled = true; sctx.drawImage(state.image, 0, 0, state.cols, state.rows);
  const data = sctx.getImageData(0, 0, state.cols, state.rows).data;
  state.cells = Array.from({ length: state.cols * state.rows }, (_, i) => {
    const alpha = data[i * 4 + 3];
    if (alpha < 40) return null;
    return nearestColor([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  });
  state.completed = new Set(); state.selected = null; state.zoom = 1; state.offsetX = state.offsetY = 0;
  restoreProgress(); configureCanvas(); renderPalette(); draw(); updateStats();
  els.setup.classList.add("hidden"); els.progress.classList.remove("hidden"); els.paletteSection.classList.remove("hidden"); els.current.classList.remove("hidden");
  els.empty.classList.add("hidden"); els.canvas.classList.remove("hidden"); showToast("图纸已生成，点击豆子标记完成");
}

function loadDemo() {
  const canvas = document.createElement("canvas"); canvas.width = 30; canvas.height = 30;
  const c = canvas.getContext("2d"); c.fillStyle = "#F5F4EA"; c.fillRect(0, 0, 30, 30);
  const pixels = [
    ["#263E63", 6, 7, 18, 16], ["#58A9D2", 7, 8, 16, 14], ["#A8D5E5", 9, 9, 12, 10],
    ["#F6DF55", 4, 10, 4, 5], ["#F6DF55", 22, 10, 4, 5], ["#F5F4EA", 10, 12, 3, 3],
    ["#F5F4EA", 17, 12, 3, 3], ["#252729", 11, 13, 2, 2], ["#252729", 17, 13, 2, 2],
    ["#EF6648", 13, 17, 4, 3], ["#A8D9BE", 8, 23, 14, 3]
  ];
  pixels.forEach(([color, x, y, w, h]) => { c.fillStyle = color; c.fillRect(x, y, w, h); });
  const image = new Image(); image.onload = () => { state.image = image; state.imageName = "示例小蓝鲸"; $("patternName").textContent = state.imageName; els.welcome.classList.add("hidden"); els.workspace.classList.remove("hidden"); $("gridWidth").value = 30; $("gridHeight").value = 30; buildFromImage(); };
  image.src = canvas.toDataURL();
}

function configureCanvas() {
  const cell = Math.max(14, Math.min(30, Math.floor(760 / Math.max(state.cols, state.rows))));
  const dpr = Math.min(window.devicePixelRatio || 1, 2); state.cellSize = cell; state.dpr = dpr;
  els.canvas.width = state.cols * cell * dpr; els.canvas.height = state.rows * cell * dpr;
  els.canvas.style.width = `${state.cols * cell}px`; els.canvas.style.height = `${state.rows * cell}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); updateTransform();
}

function draw() {
  const size = state.cellSize; ctx.clearRect(0, 0, state.cols * size, state.rows * size);
  ctx.fillStyle = "#fbfaf6"; ctx.fillRect(0, 0, state.cols * size, state.rows * size);
  state.cells.forEach((color, index) => {
    const x = (index % state.cols) * size, y = Math.floor(index / state.cols) * size;
    const dimmed = state.selected && color && color.code !== state.selected;
    ctx.fillStyle = color ? color.hex : "#fbfaf6"; ctx.globalAlpha = dimmed ? .16 : 1;
    ctx.fillRect(x, y, size, size); ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(55,50,42,.15)"; ctx.lineWidth = .6; ctx.strokeRect(x + .3, y + .3, size - .6, size - .6);
    if (color && size >= 19 && !dimmed) {
      ctx.fillStyle = luminance(color.rgb) > 155 ? "rgba(20,20,20,.64)" : "rgba(255,255,255,.78)";
      ctx.font = `600 ${Math.max(7, size * .32)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(color.code, x + size / 2, y + size / 2);
    }
    if (state.completed.has(index)) {
      ctx.fillStyle = "rgba(255,255,255,.74)"; ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size * .28, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#20221f"; ctx.lineWidth = Math.max(1.4, size * .075); ctx.beginPath();
      ctx.moveTo(x + size * .35, y + size * .5); ctx.lineTo(x + size * .47, y + size * .63); ctx.lineTo(x + size * .69, y + size * .37); ctx.stroke();
    }
  });
}
function luminance([r,g,b]) { return .299 * r + .587 * g + .114 * b; }

function counts() {
  const result = new Map();
  state.cells.forEach((color, i) => { if (color) { const item = result.get(color.code) || { color, total: 0, done: 0 }; item.total++; if (state.completed.has(i)) item.done++; result.set(color.code, item); } });
  return [...result.values()].sort((a, b) => b.total - a.total);
}
function renderPalette() {
  els.palette.innerHTML = "";
  counts().forEach(item => {
    const button = document.createElement("button"); button.className = `palette-item${state.selected === item.color.code ? " active" : ""}`;
    button.innerHTML = `<span class="swatch" style="background:${item.color.hex}"></span><span><strong>${item.color.code}</strong><small>${item.color.name}</small></span><span>${item.done}/${item.total}</span>`;
    button.addEventListener("click", () => selectColor(item.color.code)); els.palette.appendChild(button);
  });
}
function selectColor(code) { state.selected = state.selected === code ? null : code; renderPalette(); draw(); updateStats(); }

function updateStats() {
  const filled = state.cells.reduce((n, c) => n + (c ? 1 : 0), 0); const done = state.completed.size;
  const percent = filled ? Math.round(done / filled * 100) : 0;
  $("progressPercent").textContent = `${percent}%`; $("progressBar").style.width = `${percent}%`; $("doneCount").textContent = done; $("totalCount").textContent = filled;
  const item = counts().find(x => x.color.code === state.selected);
  $("currentCode").textContent = item ? `${item.color.code} · ${item.color.name}` : "全部颜色";
  $("remainingCount").textContent = item ? `${item.total - item.done} 颗` : `${filled - done} 颗`;
  $("currentDot").style.background = item ? item.color.hex : "conic-gradient(#f66, #fc5, #5b8, #59c, #f66)";
}

function canvasIndex(event) {
  const rect = els.canvas.getBoundingClientRect();
  let x = (event.clientX - rect.left) / state.zoom, y = (event.clientY - rect.top) / state.zoom;
  if (state.mirrored) x = state.cols * state.cellSize - x;
  const col = Math.floor(x / state.cellSize), row = Math.floor(y / state.cellSize);
  if (col < 0 || row < 0 || col >= state.cols || row >= state.rows) return -1;
  return row * state.cols + col;
}
function toggleCell(event) {
  const index = canvasIndex(event); const color = state.cells[index];
  if (index < 0 || !color || (state.selected && color.code !== state.selected)) return;
  state.completed.has(index) ? state.completed.delete(index) : state.completed.add(index);
  draw(); renderPalette(); updateStats(); saveProgress();
}
function progressKey() { return `bead-progress:${state.imageName}:${state.cols}x${state.rows}`; }
function saveProgress() { localStorage.setItem(progressKey(), JSON.stringify([...state.completed])); $("saveState").innerHTML = "<span></span> 已自动保存"; }
function restoreProgress() { try { state.completed = new Set(JSON.parse(localStorage.getItem(progressKey())) || []); } catch { state.completed = new Set(); } }

function updateTransform() {
  const mirror = state.mirrored ? -1 : 1;
  els.canvas.style.transform = `translate(${state.offsetX}px, ${state.offsetY}px) scale(${mirror * state.zoom}, ${state.zoom})`;
  $("zoomLabel").textContent = `${Math.round(state.zoom * 100)}%`;
}
function setTool(tool) { state.tool = tool; $("markTool").classList.toggle("active", tool === "mark"); $("panTool").classList.toggle("active", tool === "pan"); els.stage.classList.toggle("pan-mode", tool === "pan"); }

$("chooseFile").addEventListener("click", () => els.file.click());
$("newPattern").addEventListener("click", () => els.file.click());
els.file.addEventListener("change", e => acceptFile(e.target.files[0]));
els.dropZone.addEventListener("dragover", e => { e.preventDefault(); els.dropZone.classList.add("dragging"); });
els.dropZone.addEventListener("dragleave", () => els.dropZone.classList.remove("dragging"));
els.dropZone.addEventListener("drop", e => { e.preventDefault(); els.dropZone.classList.remove("dragging"); acceptFile(e.dataTransfer.files[0]); });
$("loadDemo").addEventListener("click", loadDemo); $("buildPattern").addEventListener("click", buildFromImage);
$("showAll").addEventListener("click", () => { state.selected = null; renderPalette(); draw(); updateStats(); });
$("markTool").addEventListener("click", () => setTool("mark")); $("panTool").addEventListener("click", () => setTool("pan"));
$("mirrorButton").addEventListener("click", () => { state.mirrored = !state.mirrored; $("mirrorButton").classList.toggle("active", state.mirrored); updateTransform(); });
$("zoomIn").addEventListener("click", () => { state.zoom = Math.min(3, state.zoom + .2); updateTransform(); });
$("zoomOut").addEventListener("click", () => { state.zoom = Math.max(.4, state.zoom - .2); updateTransform(); });
$("themeButton").addEventListener("click", () => { document.body.classList.toggle("dark"); localStorage.setItem("bead-theme", document.body.classList.contains("dark") ? "dark" : "light"); });

els.canvas.addEventListener("pointerdown", e => {
  if (state.tool === "mark") return toggleCell(e);
  state.dragging = true; state.dragStart = { x: e.clientX - state.offsetX, y: e.clientY - state.offsetY }; els.canvas.setPointerCapture(e.pointerId);
});
els.canvas.addEventListener("pointermove", e => { if (state.dragging) { state.offsetX = e.clientX - state.dragStart.x; state.offsetY = e.clientY - state.dragStart.y; updateTransform(); } });
els.canvas.addEventListener("pointerup", () => state.dragging = false);
els.stage.addEventListener("wheel", e => { if (els.canvas.classList.contains("hidden")) return; e.preventDefault(); state.zoom = Math.max(.4, Math.min(3, state.zoom + (e.deltaY < 0 ? .1 : -.1))); updateTransform(); }, { passive: false });
window.addEventListener("resize", () => { if (state.cells.length) updateTransform(); });

if (localStorage.getItem("bead-theme") === "dark") document.body.classList.add("dark");
