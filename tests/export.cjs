const { chromium } = require("playwright");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sampleIndex = Math.max(0, Number(process.argv[2] || 0));

function pngSize(filename) {
  const data = fs.readFileSync(filename);
  if (data.toString("ascii", 1, 4) !== "PNG") throw new Error(`${filename} 不是 PNG`);
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), bytes: data.length };
}

function sha256(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });

  await page.goto("http://127.0.0.1:4173/?test=export", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "示例图纸" }).click();
  await page.locator(".demo-card").nth(sampleIndex).click();
  await page.waitForFunction(() => state.analysisBusy === false && state.grid && state.used.length > 0, null, { timeout: 30000 });

  const expected = await page.evaluate(() => ({
    width: state.original.width,
    height: state.original.height,
    cols: state.grid.cols,
    rows: state.grid.rows,
    colors: state.used.length,
    total: state.used.reduce((sum, color) => sum + color.count, 0)
  }));
  const paletteLayout = await page.locator("#paletteList").evaluate(list => {
    const items = [...list.querySelectorAll(".palette-item")];
    const rowTops = [...new Set(items.map(item => Math.round(item.getBoundingClientRect().top)))];
    return { rows: rowTops.length, visibleHeight: list.clientHeight, scrollHeight: list.scrollHeight };
  });
  const mirrorCaption = await page.locator(".mirror-control").textContent();
  await page.locator("#mirrorButton").click();
  const mirrorActive = await page.locator("#mirrorButton").evaluate(button => button.classList.contains("active"));

  async function saveDownload(buttonSelector, basename) {
    if (!await page.locator("#exportMenu").evaluate(menu => menu.open)) await page.locator("#exportMenu > summary").click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator(buttonSelector).click();
    const download = await downloadPromise;
    const filename = path.join(os.tmpdir(), basename);
    await download.saveAs(filename);
    return { filename, suggested: download.suggestedFilename() };
  }

  const original = await saveDownload("#exportOriginal", `perler-export-${sampleIndex}-original.png`);
  const mirror = await saveDownload("#exportMirror", `perler-export-${sampleIndex}-mirror.png`);
  const txt = await saveDownload("#exportTxt", `perler-export-${sampleIndex}-counts.txt`);
  const txtContent = fs.readFileSync(txt.filename, "utf8");
  const countSum = [...txtContent.matchAll(/^([A-Z]+\d+) (\d+)颗$/gm)].reduce((sum, match) => sum + Number(match[2]), 0);

  await page.locator("#paletteList").scrollIntoViewIfNeeded();
  await page.locator("#exportMenu > summary").click();
  const screenshot = path.join(os.tmpdir(), `perler-export-controls-${sampleIndex}.png`);
  await page.screenshot({ path: screenshot, fullPage: false });

  const originalSize = pngSize(original.filename), mirrorSize = pngSize(mirror.filename);
  const result = {
    title: await page.title(),
    url: page.url(),
    expected,
    paletteLayout,
    mirrorCaption: mirrorCaption.trim(),
    mirrorActive,
    original: { ...originalSize, suggested: original.suggested },
    mirror: { ...mirrorSize, suggested: mirror.suggested },
    imagesDiffer: sha256(original.filename) !== sha256(mirror.filename),
    txt: {
      suggested: txt.suggested,
      hasBom: txtContent.charCodeAt(0) === 0xfeff,
      hasSpecification: txtContent.includes(`规格：${expected.cols}×${expected.rows}`),
      hasColorCount: txtContent.includes(`颜色数：${expected.colors}`),
      hasTotal: txtContent.includes(`总豆数：${expected.total}`),
      countSum
    },
    screenshot,
    errors
  };
  console.log(JSON.stringify(result));
  await browser.close();

  const failed = errors.length || paletteLayout.rows !== 2 || paletteLayout.scrollHeight > paletteLayout.visibleHeight + 1 ||
    !result.mirrorCaption.includes("镜像") || !mirrorActive ||
    originalSize.width !== expected.width || originalSize.height !== expected.height ||
    mirrorSize.width !== expected.width || mirrorSize.height !== expected.height || !result.imagesDiffer ||
    !result.txt.hasBom || !result.txt.hasSpecification || !result.txt.hasColorCount || !result.txt.hasTotal || result.txt.countSum !== expected.total;
  if (failed) process.exit(1);
})();
