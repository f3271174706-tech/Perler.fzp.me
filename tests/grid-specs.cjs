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
      const white = !specialty && (col * 11 + row * 5) % 47 === 0;
      if (!specialty && !white && (col + row * 2) % 9 !== 0 && (col * 3 + row) % 17 !== 0) continue;
      const first = (col + row) % 2 === 0;
      context.fillStyle = white ? "#fff" : specialty ? "#AB91C0" : first ? "#C70039" : "#F84F49";
      context.fillRect(marginX + col * cell, marginTop + row * cell, cell, cell);
      context.fillStyle = white ? "#222" : "#fff";
      context.font = `700 ${Math.max(5, Math.floor(cell * .34))}px system-ui`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(white ? "H2" : specialty ? "ZG8" : first ? "F8" : "F3", marginX + (col + .5) * cell, marginTop + (row + .52) * cell);
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

async function injectCalibratedProfilePattern(page) {
  await page.evaluate(async () => {
    const colors = [
      ["H2",255,255,255],["A21",255,227,149],["G14",141,97,76],["M9",165,135,103],
      ["H12",255,245,237],["G17",86,64,60],["M7",180,164,151],["G12",235,187,131],
      ["H1",226,226,226],["G21",203,142,119],["E11",252,221,210],["G3",244,195,165],
      ["H3",179,179,179],["C23",194,220,235],["M4",218,206,190],["A25",255,214,125],
      ["C14",213,253,255],["D23",234,218,252],["H4",134,134,134],["A23",243,213,191],
      ["G4",225,179,131],["D11",185,186,225],["C28",187,207,237],["G8",89,42,33],
      ["M13",209,144,102],["H16",59,47,35],["M10",197,177,188],["D26",233,195,246],
      ["H20",148,159,163],["E23",147,122,141],["G10",200,129,53],["A11",255,221,153]
    ];
    const cols = 32, rows = 32, cell = 24, canvas = document.createElement("canvas");
    canvas.width = cols * cell; canvas.height = rows * cell;
    const context = canvas.getContext("2d");
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const [code, red, green, blue] = colors[(row * cols + col) % colors.length];
      context.fillStyle = `rgb(${red},${green},${blue})`; context.fillRect(col * cell, row * cell, cell, cell);
      context.fillStyle = red * .299 + green * .587 + blue * .114 < 120 ? "#fff" : "#222";
      context.font = "600 9px Arial"; context.textAlign = "center"; context.textBaseline = "middle";
      context.fillText(code, (col + .5) * cell, (row + .52) * cell);
    }
    context.strokeStyle = "#aaa"; context.lineWidth = 1;
    for (let index = 0; index <= cols; index++) {
      context.beginPath(); context.moveTo(index * cell + .5, 0); context.lineTo(index * cell + .5, canvas.height); context.stroke();
      context.beginPath(); context.moveTo(0, index * cell + .5); context.lineTo(canvas.width, index * cell + .5); context.stroke();
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const file = new File([blob], "calibrated-profile-32x32.png", { type: "image/png" });
    const transfer = new DataTransfer(); transfer.items.add(file);
    const input = document.querySelector("#fileInput");
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
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
    [52, 64, 18], [104, 78, 12], [104, 104, 24, true], [156, 156, 9, true], [208, 208, 12, true]
  ];
  const suggested = [], detected = [], extensionMatches = [], whiteMatches = [];
  for (const [cols, rows, cell, fullCanvas = false] of specifications) {
    await page.goto(`${baseUrl}?grid=${cols}x${rows}`, { waitUntil: "networkidle" });
    await injectSyntheticPattern(page, cols, rows, cell, fullCanvas);
    const expected = `${cols} × ${rows}`;
    await page.locator("#alignmentDialog").waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector("#alignmentConfidence")?.classList.contains("scanning"));
    suggested.push(await page.evaluate(() => `${alignmentCols.value} × ${alignmentRows.value}`));
    await page.locator("#confirmAlignment").click();
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
    const codes = await page.locator("#paletteList .palette-item strong").allTextContents();
    extensionMatches.push(codes.includes("ZG8"));
    whiteMatches.push(codes.includes("H2") && !codes.includes("T1"));
  }

  await page.goto(`${baseUrl}?grid=calibrated-profile`, { waitUntil: "networkidle" });
  await injectCalibratedProfilePattern(page);
  await page.locator("#alignmentDialog").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#alignmentConfidence")?.classList.contains("scanning"));
  await page.locator("#confirmAlignment").click();
  await page.waitForFunction(() => document.querySelector("#gridSize")?.textContent === "32 × 32");
  const calibratedProfileCodes = await page.locator("#paletteList .palette-item strong").allTextContents();
  const expectedProfileCodes = ["A11","A21","A23","A25","C14","C23","C28","D11","D23","D26","E11","E23","G3","G4","G8","G10","G12","G14","G17","G21","H1","H2","H3","H4","H12","H16","H20","M4","M7","M9","M10","M13"];
  const calibratedProfileMatches = JSON.stringify(calibratedProfileCodes) === JSON.stringify(expectedProfileCodes);

  await page.goto(`${baseUrl}?grid=manual-controls`, { waitUntil: "networkidle" });
  await page.locator(".demo-card").first().click();
  await page.waitForFunction(() => document.querySelector("#gridSize")?.textContent === "52 × 52");
  await page.locator("#gridPreset").selectOption("64x64");
  await page.waitForFunction(() => document.querySelector("#gridSize")?.textContent === "64 × 64");
  await page.waitForFunction(() => state.analysisBusy === false);
  const manualPreset = await page.locator("#gridSize").textContent();
  await page.locator("#gridPreset").selectOption("custom");
  await page.locator("#gridCols").fill("137");
  await page.locator("#gridRows").fill("149");
  await page.locator("#applyGrid").click();
  await page.waitForFunction(() => document.querySelector("#gridSize")?.textContent === "137 × 149");
  const manualCustom = await page.locator("#gridSize").textContent();

  const expected = specifications.map(([cols, rows]) => `${cols} × ${rows}`);
  const result = { paletteCheck, expected, suggested, detected, extensionMatches, whiteMatches, calibratedProfileMatches, calibratedProfileCodes, manualPreset, manualCustom, errors };
  console.log(JSON.stringify(result));
  await browser.close();
  if (paletteCheck.declared !== 291 || paletteCheck.actual !== 291 || !paletteCheck.hasExtensions || suggested.some((value, index) => value !== expected[index]) || detected.some((value, index) => value !== expected[index]) || extensionMatches.some(value => !value) || whiteMatches.some(value => !value) || !calibratedProfileMatches || manualPreset !== "64 × 64" || manualCustom !== "137 × 149" || errors.length) process.exit(1);
})();
