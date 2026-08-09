const { chromium } = require("playwright");

const baseUrl = "http://127.0.0.1:4173/";

async function injectSyntheticPattern(page, cols, rows, cell, fullCanvas = false) {
  await page.evaluate(async ({ cols, rows, cell, fullCanvas }) => {
    const marginX = fullCanvas ? 0 : 60;
    const marginTop = fullCanvas ? 0 : 80;
    const marginBottom = fullCanvas ? 0 : 60;
    const canvas = document.createElement("canvas");
    canvas.width = marginX * 2 + cols * cell;
    canvas.height = marginTop + marginBottom + rows * cell;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!fullCanvas) {
      context.fillStyle = "#111";
      context.font = "700 16px system-ui";
      context.fillText(`MARD 291 · ${cols}×${rows}`, marginX, 28);
    }

    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const specialty = (col * 7 + row) % 31 === 0;
      if (!specialty && (col + row * 2) % 9 !== 0 && (col * 3 + row) % 17 !== 0) continue;
      const first = (col + row) % 2 === 0;
      context.fillStyle = specialty ? "#AB91C0" : first ? "#C70039" : "#F84F49";
      context.fillRect(marginX + col * cell, marginTop + row * cell, cell, cell);
      context.fillStyle = "#fff";
      context.font = `700 ${Math.max(5, Math.floor(cell * .34))}px system-ui`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(specialty ? "ZG8" : first ? "F8" : "F3", marginX + (col + .5) * cell, marginTop + (row + .52) * cell);
    }

    for (let col = 0; col <= cols; col++) {
      context.beginPath();
      context.strokeStyle = col % 10 === 0 || col === cols ? "#777" : "#d5d5d5";
      context.lineWidth = col % 10 === 0 || col === cols ? 1.4 : 1;
      const x = marginX + col * cell + .5;
      context.moveTo(x, marginTop);
      context.lineTo(x, marginTop + rows * cell);
      context.stroke();
    }
    for (let row = 0; row <= rows; row++) {
      context.beginPath();
      context.strokeStyle = row % 10 === 0 || row === rows ? "#777" : "#d5d5d5";
      context.lineWidth = row % 10 === 0 || row === rows ? 1.4 : 1;
      const y = marginTop + row * cell + .5;
      context.moveTo(marginX, y);
      context.lineTo(marginX + cols * cell, y);
      context.stroke();
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], `synthetic-${cols}x${rows}.png`, { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector("#fileInput");
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, { cols, rows, cell, fullCanvas });
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const paletteCheck = await page.evaluate(async () => {
    const data = await fetch("./mard-291.json").then(response => response.json());
    return { declared: data.color_count, actual: data.colors?.length, hasExtensions: data.colors?.some(color => color.code === "ZG8") };
  });

  const specifications = [
    [26, 26, 32], [32, 32, 30], [40, 40, 26], [52, 52, 22], [58, 58, 20], [64, 64, 18],
    [72, 72, 17], [78, 78, 16], [90, 90, 14], [104, 104, 12],
    [52, 64, 18], [104, 78, 12], [156, 156, 9, true]
  ];
  const detected = [], extensionMatches = [];
  for (const [cols, rows, cell, fullCanvas = false] of specifications) {
    await page.goto(`${baseUrl}?grid=${cols}x${rows}`, { waitUntil: "networkidle" });
    await injectSyntheticPattern(page, cols, rows, cell, fullCanvas);
    const expected = `${cols} × ${rows}`;
    try {
      await page.waitForFunction(value => document.querySelector("#gridSize")?.textContent === value, expected, { timeout: 20000 });
    } catch (error) {
      console.log("DETECTION_MISMATCH", expected, await page.evaluate(() => {
        const analysis = makeAnalysisCanvas(state.image);
        const scores = edgeScores(analysis.pixels, analysis.canvas.width, analysis.canvas.height);
        return {
          grid: document.querySelector("#gridSize")?.textContent,
          status: document.querySelector("#gridStatus")?.textContent,
          toast: document.querySelector("#toast")?.textContent,
          xAxis: regularAxis(scores.vertical, scores.verticalCoverage),
          yAxis: regularAxis(scores.horizontal, scores.horizontalCoverage)
        };
      }));
      throw error;
    }
    detected.push(await page.locator("#gridSize").textContent());
    extensionMatches.push((await page.locator("#paletteList .palette-item strong").allTextContents()).includes("ZG8"));
  }

  await page.locator("#gridPreset").selectOption("64x64");
  await page.waitForFunction(() => document.querySelector("#gridSize")?.textContent === "64 × 64");
  const manualPreset = await page.locator("#gridSize").textContent();
  await page.locator("#gridPreset").selectOption("custom");
  await page.locator("#gridCols").fill("137");
  await page.locator("#gridRows").fill("149");
  await page.locator("#applyGrid").click();
  await page.waitForFunction(() => document.querySelector("#gridSize")?.textContent === "137 × 149");
  const manualCustom = await page.locator("#gridSize").textContent();

  const expected = specifications.map(([cols, rows]) => `${cols} × ${rows}`);
  const result = { paletteCheck, expected, detected, extensionMatches, manualPreset, manualCustom, errors };
  console.log(JSON.stringify(result));
  await browser.close();
  if (paletteCheck.declared !== 291 || paletteCheck.actual !== 291 || !paletteCheck.hasExtensions || detected.some((value, index) => value !== expected[index]) || extensionMatches.some(value => !value) || manualPreset !== "64 × 64" || manualCustom !== "137 × 149" || errors.length) process.exit(1);
})();
