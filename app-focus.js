"use strict";

const $ = id => document.getElementById(id);
const state = { image: null, name: "", palette: [], selected: new Set(), original: null, groups: null, zoom: 1, mirrored: false, x: 0, y: 0, dragging: false, renderToken: 0 };
const els = { welcome: $("welcomePanel"), workspace: $("workspace"), drop: $("dropZone"), file: $("fileInput"), canvas: $("beadCanvas"), stage: $("boardStage"), empty: $("emptyBoard"), palette: $("paletteList"), imageCard: $("imageCard"), paletteSection: $("paletteSection"), current: $("currentColor") };
const ctx = els.canvas.getContext("2d", { willReadFrequently: true });
let toastTimer;

function toast(text, duration = 1800) { $("toast").textContent = text; $("toast").classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("show"), duration); }
function dist(a, b) { const mr = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2]; return (2 + mr / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mr) / 256) * db * db; }
function nearest(rgb, colors) { let best = 0, score = Infinity; colors.forEach((c, i) => { const d = dist(rgb, c.rgb); if (d < score) { best = i; score = d; } }); return best; }
function hex(rgb) { return `#${rgb.map(v => Math.round(v).toString(16).padStart(2, "0")).join("")}`; }
function nameColor([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), light = (max + min) / 2;
  if (max - min < 18) return light > 235 ? "白色" : light > 180 ? "浅灰" : light > 75 ? "灰色" : "黑色";
  if (r > g * 1.25 && r > b * 1.25) return g > b * 1.4 ? "橙色" : light > 175 ? "粉色" : "红色";
  if (r > b * 1.18 && g > b * 1.12) return light > 175 ? "奶油黄" : "黄色";
  if (g > r * 1.18 && g > b * 1.1) return light > 170 ? "浅绿色" : "绿色";
  if (b > r * 1.16 && b > g * 1.07) return r > g * 1.12 ? "紫色" : light > 175 ? "浅蓝色" : "蓝色";
  if (r > b * 1.16 && g > b * 1.06) return light > 170 ? "肤色" : "棕色";
  return "综合色";
}

function acceptFile(file) {
  if (!file || !file.type.startsWith("image/")) return toast("请选择 PNG、JPG 或 WEBP 图片");
  const reader = new FileReader(); reader.onload = () => { const image = new Image(); image.onload = () => loadImage(image, file.name); image.onerror = () => toast("图片读取失败"); image.src = reader.result; }; reader.readAsDataURL(file);
}

async function loadImage(image, filename) {
  Object.assign(state, { image, name: filename, zoom: 1, mirrored: false, x: 0, y: 0 }); state.selected.clear();
  $("patternName").textContent = filename.replace(/\.[^.]+$/, ""); $("imageResolution").textContent = `${image.naturalWidth} × ${image.naturalHeight} px · 原图 1:1`;
  els.welcome.classList.add("hidden"); els.workspace.classList.remove("hidden"); els.empty.classList.add("hidden"); els.canvas.classList.remove("hidden"); els.imageCard.classList.remove("hidden"); els.paletteSection.classList.add("hidden"); els.current.classList.remove("hidden");
  toast("正在分析图纸中的主要颜色…", 5000); await new Promise(r => requestAnimationFrame(r));
  prepareCanvas(); state.palette = detectPalette(image, 18); await classifyPixels(); renderPalette(); renderFocus(); updateSummary();
  els.paletteSection.classList.remove("hidden"); toast(`识别到 ${state.palette.length} 种主要颜色，可同时选择多种`);
}

function prepareCanvas() {
  // Keep a true 1:1 pixel canvas. Screen fitting happens only through CSS, so zooming never
  // falls back to a reduced working copy of the uploaded pattern.
  els.canvas.width = state.image.naturalWidth; els.canvas.height = state.image.naturalHeight;
  ctx.drawImage(state.image, 0, 0, els.canvas.width, els.canvas.height); state.original = ctx.getImageData(0, 0, els.canvas.width, els.canvas.height); requestAnimationFrame(fitCanvas);
}
function fitCanvas() { const s = Math.min((els.stage.clientWidth - 36) / els.canvas.width, (els.stage.clientHeight - 36) / els.canvas.height, 1); els.canvas.style.width = `${els.canvas.width * s}px`; els.canvas.style.height = `${els.canvas.height * s}px`; transformCanvas(); }

function detectPalette(image, limit) {
  const sample = document.createElement("canvas"), scale = Math.min(1, 180 / Math.max(image.naturalWidth, image.naturalHeight)); sample.width = Math.max(1, Math.round(image.naturalWidth * scale)); sample.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const sctx = sample.getContext("2d", { willReadFrequently: true }); sctx.drawImage(image, 0, 0, sample.width, sample.height); const data = sctx.getImageData(0, 0, sample.width, sample.height).data, bins = new Map();
  for (let i = 0; i < data.length; i += 4) { if (data[i + 3] < 100) continue; const key = `${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`, bin = bins.get(key) || { n: 0, sum: [0, 0, 0] }; bin.n++; bin.sum[0] += data[i]; bin.sum[1] += data[i + 1]; bin.sum[2] += data[i + 2]; bins.set(key, bin); }
  const candidates = [...bins.values()].sort((a, b) => b.n - a.n).map(x => x.sum.map(v => v / x.n)), colors = [];
  for (const rgb of candidates) { if (colors.every(c => dist(rgb, c.rgb) > 650)) colors.push({ rgb, count: 0 }); if (colors.length >= limit) break; }
  if (!colors.length) colors.push({ rgb: [255, 255, 255], count: 1 });
  for (let pass = 0; pass < 4; pass++) { const sums = colors.map(() => [0, 0, 0, 0]); for (let i = 0; i < data.length; i += 16) { if (data[i + 3] < 100) continue; const rgb = [data[i], data[i + 1], data[i + 2]], j = nearest(rgb, colors); sums[j][0] += rgb[0]; sums[j][1] += rgb[1]; sums[j][2] += rgb[2]; sums[j][3]++; } sums.forEach((s, i) => { if (s[3]) colors[i].rgb = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; }); }
  colors.forEach(c => c.count = 0); for (let i = 0; i < data.length; i += 16) if (data[i + 3] >= 100) colors[nearest([data[i], data[i + 1], data[i + 2]], colors)].count++;
  const total = colors.reduce((n, c) => n + c.count, 0); return colors.filter(c => c.count / total > .002).sort((a, b) => b.count - a.count).map((c, id) => ({ id, rgb: c.rgb.map(Math.round), hex: hex(c.rgb), name: nameColor(c.rgb), share: c.count / total }));
}

async function classifyPixels() {
  const data = state.original.data, groups = new Uint8Array(data.length / 4), chunk = 200000;
  for (let start = 0; start < groups.length; start += chunk) { const end = Math.min(groups.length, start + chunk); for (let p = start; p < end; p++) { const i = p * 4; groups[p] = data[i + 3] < 20 ? 255 : nearest([data[i], data[i + 1], data[i + 2]], state.palette); } if (end < groups.length) await new Promise(r => setTimeout(r, 0)); }
  state.groups = groups;
}

function renderPalette() {
  els.palette.innerHTML = ""; state.palette.forEach(color => { const button = document.createElement("button"); button.className = `palette-item${state.selected.has(color.id) ? " active" : ""}`; button.innerHTML = `<span class="swatch" style="background:${color.hex}"></span><span><strong>${color.name}</strong><small>${color.hex.toUpperCase()}</small></span><span>${Math.max(1, Math.round(color.share * 100))}%</span>`; button.onclick = () => { state.selected.has(color.id) ? state.selected.delete(color.id) : state.selected.add(color.id); renderPalette(); renderFocus(); updateSummary(); }; els.palette.appendChild(button); });
}

function renderFocus() {
  const token = ++state.renderToken;
  if (!state.selected.size) return ctx.putImageData(state.original, 0, 0);
  const output = new ImageData(new Uint8ClampedArray(state.original.data), els.canvas.width, els.canvas.height), pixels = output.data;
  requestAnimationFrame(() => { if (token !== state.renderToken) return; for (let p = 0; p < state.groups.length; p++) { if (state.selected.has(state.groups[p]) || state.groups[p] === 255) continue; const i = p * 4; pixels[i] = Math.round(pixels[i] * .2); pixels[i + 1] = Math.round(pixels[i + 1] * .2); pixels[i + 2] = Math.round(pixels[i + 2] * .2); } if (token === state.renderToken) ctx.putImageData(output, 0, 0); });
}
function updateSummary() { const colors = state.palette.filter(c => state.selected.has(c.id)), count = colors.length; $("focusStatus").textContent = count ? `已高亮 ${count} 种颜色` : "显示全部颜色"; $("currentCode").textContent = count ? colors.map(c => c.name).join("、") : "显示全部颜色"; $("remainingCount").textContent = count ? "亮度 20%" : "原亮度"; $("currentDot").style.background = count === 1 ? colors[0].hex : count > 1 ? `linear-gradient(135deg,${colors.slice(0, 4).map(c => c.hex).join(",")})` : "conic-gradient(#f66,#fc5,#5b8,#59c,#f66)"; }
function clearFocus() { state.selected.clear(); renderPalette(); renderFocus(); updateSummary(); }
function transformCanvas() { els.canvas.style.transform = `translate(${state.x}px,${state.y}px) scale(${state.mirrored ? -state.zoom : state.zoom},${state.zoom})`; $("zoomLabel").textContent = `${Math.round(state.zoom * 100)}%`; }

function demo() {
  const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 900; const c = canvas.getContext("2d"), colors = ["#f0d95b", "#ef806d", "#72afd2", "#78bd8c", "#75599c", "#303a51"], cell = 30; c.fillStyle = "#fffdf5"; c.fillRect(0, 0, 1200, 900);
  for (let row = 0; row < 26; row++) for (let col = 0; col < 36; col++) { const inside = (col - 18) ** 2 / 250 + (row - 13) ** 2 / 115 < 1, ci = Math.floor((col + row) / 5) % colors.length; c.fillStyle = inside ? colors[ci] : "#fffdf5"; c.fillRect(60 + col * cell, 60 + row * cell, cell, cell); c.strokeStyle = "rgba(25,30,35,.3)"; c.strokeRect(60 + col * cell, 60 + row * cell, cell, cell); if (inside) { c.fillStyle = "rgba(10,10,10,.65)"; c.font = "10px system-ui"; c.textAlign = "center"; c.fillText(String(ci + 1), 75 + col * cell, 79 + row * cell); } }
  const image = new Image(); image.onload = () => loadImage(image, "示例高清图纸.png"); image.src = canvas.toDataURL();
}

$("chooseFile").onclick = () => els.file.click(); $("newPattern").onclick = () => els.file.click(); els.file.onchange = e => acceptFile(e.target.files[0]); $("loadDemo").onclick = demo; $("showAll").onclick = clearFocus;
els.drop.ondragover = e => { e.preventDefault(); els.drop.classList.add("dragging"); }; els.drop.ondragleave = () => els.drop.classList.remove("dragging"); els.drop.ondrop = e => { e.preventDefault(); els.drop.classList.remove("dragging"); acceptFile(e.dataTransfer.files[0]); };
$("mirrorButton").onclick = () => { state.mirrored = !state.mirrored; $("mirrorButton").classList.toggle("active", state.mirrored); transformCanvas(); }; $("zoomIn").onclick = () => { state.zoom = Math.min(5, state.zoom + .2); transformCanvas(); }; $("zoomOut").onclick = () => { state.zoom = Math.max(.25, state.zoom - .2); transformCanvas(); };
$("themeButton").onclick = () => { document.body.classList.toggle("dark"); localStorage.setItem("bead-theme", document.body.classList.contains("dark") ? "dark" : "light"); };
els.canvas.onpointerdown = e => { state.dragging = true; state.start = { x: e.clientX - state.x, y: e.clientY - state.y }; els.canvas.setPointerCapture(e.pointerId); }; els.canvas.onpointermove = e => { if (state.dragging) { state.x = e.clientX - state.start.x; state.y = e.clientY - state.start.y; transformCanvas(); } }; els.canvas.onpointerup = els.canvas.onpointercancel = () => state.dragging = false;
els.stage.addEventListener("wheel", e => { if (!state.image) return; e.preventDefault(); state.zoom = Math.max(.25, Math.min(5, state.zoom + (e.deltaY < 0 ? .1 : -.1))); transformCanvas(); }, { passive: false }); window.onresize = () => state.image && fitCanvas();
if (localStorage.getItem("bead-theme") === "dark") document.body.classList.add("dark");
