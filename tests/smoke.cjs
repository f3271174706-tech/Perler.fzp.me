const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const errors = [];
  const consoleProblems = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) consoleProblems.push(message.text()); });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  const directCanvasEntry = await page.evaluate(() => {
    const stage = document.querySelector("#boardStage").getBoundingClientRect();
    return !document.querySelector("#welcomePanel") &&
      document.querySelector("#addPattern")?.textContent.trim() === "添加图纸" &&
      document.querySelector("#startGallery")?.offsetParent !== null &&
      document.querySelectorAll("#startGallery .demo-card").length === 17 && stage.height >= innerHeight - 50;
  });
  await page.screenshot({ path: path.join(__dirname, "empty-canvas.png"), fullPage: true });
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.locator("#addPattern").click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(path.resolve(__dirname, "../assets/demo-pattern.png"));
  await page.locator("#alignmentDialog").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#alignmentConfidence")?.classList.contains("scanning"));
  const alignmentAuto = await page.evaluate(() =>
    document.querySelector("#alignmentCols")?.value === "52" &&
    document.querySelector("#alignmentRows")?.value === "52" &&
    document.querySelector("#redCrosshair")?.offsetParent !== null &&
    document.querySelector("#blueCrosshair")?.offsetParent !== null &&
    document.querySelector("#greenCrosshair")?.offsetParent !== null &&
    document.querySelector("#yellowCrosshair")?.offsetParent !== null &&
    document.querySelector("#alignmentCellSize")?.textContent.includes("40.0 × 40.0 px")
  );
  await page.locator("#confirmAlignment").click();
  await page.locator("#beadCanvas").waitFor({ state: "visible" });
  await page.locator("#paletteList .palette-item").first().waitFor();
  await page.waitForFunction(() => document.querySelector("#gridSize")?.textContent === "52 × 52");
  const initialMean = await page.locator("#beadCanvas").evaluate(canvas => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0; for (let i = 0; i < data.length; i += 400) sum += data[i] + data[i + 1] + data[i + 2];
    return sum;
  });
  const hiddenProbeBefore = await page.locator("#beadCanvas").evaluate(canvas => [...canvas.getContext("2d").getImageData(210, 90, 1, 1).data.slice(0, 3)]);
  const paletteCount = await page.locator("#paletteList .palette-item").count();
  await page.locator("#beadCanvas").evaluate(canvas => { window.__mirrorOriginal = new Uint8ClampedArray(canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data); });
  await page.locator("#mirrorButton").click();
  const mirrorResult = await page.locator("#beadCanvas").evaluate(canvas => {
    const before = window.__mirrorOriginal, after = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const cols = 52, rows = 52, cellWidth = canvas.width / cols, cellHeight = canvas.height / rows;
    let discriminatingSamples = 0, matchingSamples = 0;
    for (let row = 0; row < rows; row++) for (let destCol = 0; destCol < cols; destCol++) {
      const sourceCol = cols - 1 - destCol;
      for (let localY = 4; localY < cellHeight; localY += 7) for (let localX = 4; localX < cellWidth; localX += 7) {
        const destX = Math.floor(destCol * cellWidth + localX), sourceX = Math.floor(sourceCol * cellWidth + localX), y = Math.floor(row * cellHeight + localY);
        const destIndex = (y * canvas.width + destX) * 4, sourceIndex = (y * canvas.width + sourceX) * 4;
        const sourceDiffersFromOldDestination = Math.abs(before[sourceIndex] - before[destIndex]) + Math.abs(before[sourceIndex + 1] - before[destIndex + 1]) + Math.abs(before[sourceIndex + 2] - before[destIndex + 2]) > 12;
        if (!sourceDiffersFromOldDestination) continue;
        discriminatingSamples++;
        if (after[destIndex] === before[sourceIndex] && after[destIndex + 1] === before[sourceIndex + 1] && after[destIndex + 2] === before[sourceIndex + 2]) matchingSamples++;
      }
    }
    const matrix = new DOMMatrix(getComputedStyle(canvas).transform);
    return { discriminatingSamples, mappingRatio: matchingSamples / Math.max(1, discriminatingSamples), textTransformIsForward: matrix.a > 0 };
  });
  await page.locator("#mirrorButton").click();
  await page.locator("#paletteList .palette-item").first().click();
  await page.waitForTimeout(2100);
  await page.locator("#paletteList .palette-item").nth(1).click();
  await page.waitForTimeout(250);
  await page.locator("#mirrorButton").click();
  await page.waitForTimeout(150);
  const mirrorFocusMapping = await page.locator("#beadCanvas").evaluate(canvas => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data, grid = state.grid;
    const cellWidth = (grid.right - grid.left) / grid.cols, cellHeight = (grid.bottom - grid.top) / grid.rows;
    let expectedSelected = 0, correctSelected = 0, expectedHidden = 0, correctHidden = 0;
    for (let row = 0; row < grid.rows; row++) for (let destCol = 0; destCol < grid.cols; destCol++) {
      const sourceCol = grid.cols - 1 - destCol, code = grid.cells[row * grid.cols + sourceCol];
      if (!code) continue;
      const x = Math.floor(grid.left + (destCol + .25) * cellWidth), y = Math.floor(grid.top + (row + .25) * cellHeight), index = (y * canvas.width + x) * 4;
      const isVisible = data[index] < 248 || data[index + 1] < 248 || data[index + 2] < 248;
      if (state.selected.has(code)) { expectedSelected++; if (isVisible) correctSelected++; }
      else { expectedHidden++; if (!isVisible) correctHidden++; }
    }
    return expectedSelected > 10 && correctSelected / expectedSelected > .95 && expectedHidden > 100 && correctHidden / expectedHidden > .95;
  });
  await page.locator("#mirrorButton").click();
  await page.waitForTimeout(150);
  const verticalLayout = await page.evaluate(() => {
    const workspace = document.querySelector("#workspace");
    const palette = document.querySelector("#paletteSection").getBoundingClientRect();
    const selection = document.querySelector(".selection-row").getBoundingClientRect();
    const board = document.querySelector("#boardStage").getBoundingClientRect();
    const style = getComputedStyle(workspace);
    return style.display === "flex" && style.flexDirection === "column" && board.top < selection.top && selection.top < palette.top;
  });
  const paletteTextIsMinimal = await page.locator("#paletteList .palette-item").evaluateAll(items => items.every(item => {
    const children = [...item.children];
    return children.length === 3 && children[0].classList.contains("swatch") && /^[A-Z]\d+$/.test(children[1].textContent) && /^\d+$/.test(children[2].textContent);
  }));
  const highlightedSummary = await page.locator("#currentColor").textContent();
  const mardCodes = await page.locator("#paletteList .palette-item strong").allTextContents();
  const paletteAlphabetical = mardCodes.every((code, index) => !index || code.localeCompare(mardCodes[index - 1], "en", { numeric: true }) >= 0);
  await page.screenshot({ path: path.join(__dirname, "workspace.png"), fullPage: true });
  const initialZoom = await page.locator("#zoomLabel").textContent();
  const fittedAt100 = await page.evaluate(() => {
    const stage = document.querySelector("#boardStage").getBoundingClientRect();
    const canvas = document.querySelector("#beadCanvas").getBoundingClientRect();
    return canvas.width <= stage.width && canvas.height <= stage.height;
  });
  const adaptiveStage = await page.evaluate(() => {
    const stage = document.querySelector("#boardStage");
    const fittedWidth = stage.clientWidth - 36;
    const fittedHeight = stage.clientHeight - 34;
    return Math.abs(fittedWidth / fittedHeight - 1) < .02;
  });
  const stageBeforeZoom = await page.locator("#boardStage").evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }));
  await page.locator("#zoomOut").click({ force: true });
  await page.locator("#zoomOut").click({ force: true });
  const minimumZoom = await page.locator("#zoomLabel").textContent();
  const stageAfterZoom = await page.locator("#boardStage").evaluate(element => ({ width: element.clientWidth, height: element.clientHeight }));
  const focusedMean = await page.locator("#beadCanvas").evaluate(canvas => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0; for (let i = 0; i < data.length; i += 400) sum += data[i] + data[i + 1] + data[i + 2];
    return sum;
  });
  const hiddenProbeAfter = await page.locator("#beadCanvas").evaluate(canvas => [...canvas.getContext("2d").getImageData(210, 90, 1, 1).data.slice(0, 3)]);
  let canvasBox = await page.locator("#beadCanvas").boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 900, canvasBox.y + canvasBox.height / 2 + 900, { steps: 4 });
  await page.mouse.up();
  const containedAt75 = await page.evaluate(() => {
    const stage = document.querySelector("#boardStage").getBoundingClientRect();
    const canvas = document.querySelector("#beadCanvas").getBoundingClientRect();
    return canvas.left >= stage.left - 2 && canvas.top >= stage.top - 2 && canvas.right <= stage.right + 2 && canvas.bottom <= stage.bottom + 2;
  });
  await page.locator("#zoomIn").click(); await page.locator("#zoomIn").click(); await page.locator("#zoomIn").click();
  canvasBox = await page.locator("#beadCanvas").boundingBox();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width / 2 - 900, canvasBox.y + canvasBox.height / 2 - 900, { steps: 4 });
  await page.mouse.up();
  const coversAt150 = await page.evaluate(() => {
    const stage = document.querySelector("#boardStage").getBoundingClientRect();
    const canvas = document.querySelector("#beadCanvas").getBoundingClientRect();
    return canvas.left <= stage.left + 2 && canvas.top <= stage.top + 2 && canvas.right >= stage.right - 2 && canvas.bottom >= stage.bottom - 2;
  });
  const result = {
    title: await page.title(),
    directCanvasEntry,
    alignmentAuto,
    paletteItems: await page.locator("#paletteList .palette-item").count(),
    selectedColors: await page.locator("#paletteList .palette-item.active").count(),
    dimmingApplied: focusedMean > initialMean * 1.05,
    otherColorAndCodeHidden: hiddenProbeBefore.some(value => value < 220) && hiddenProbeAfter.every(value => value === 255),
    hiddenProbeBefore,
    hiddenProbeAfter,
    originalResolution: await page.locator("#beadCanvas").evaluate(canvas => canvas.width === 2080 && canvas.height === 2080),
    gridSize: await page.locator("#gridSize").textContent(),
    initialZoom,
    fittedAt100,
    adaptiveStage,
    minimumZoom,
    containedAt75,
    coversAt150,
    stageStable: JSON.stringify(stageBeforeZoom) === JSON.stringify(stageAfterZoom),
    mardCodes,
    paletteAlphabetical,
    mirrorCellMapping: mirrorResult.mappingRatio > .995 && mirrorResult.discriminatingSamples > 100,
    mirrorTextForward: mirrorResult.textTransformIsForward,
    mirrorFocusMapping,
    verticalLayout,
    paletteTextIsMinimal,
    highlightedSummary: /已高亮\s+[A-Z]\d+、[A-Z]\d+/.test(highlightedSummary),
    canvasVisible: await page.locator("#beadCanvas").isVisible(),
    pageErrors: errors,
    consoleProblems
  };
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const desktopErrors = [];
  desktop.on("pageerror", error => desktopErrors.push(error.message));
  await desktop.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await desktop.locator(".demo-card").first().click();
  await desktop.waitForFunction(() => document.querySelector("#gridSize")?.textContent === "52 × 52");
  await desktop.locator("#paletteList .palette-item").first().click();
  await desktop.locator("#paletteList .palette-item").nth(1).click();
  await desktop.waitForTimeout(2100);
  await desktop.screenshot({ path: path.join(__dirname, "desktop.png"), fullPage: true });
  result.desktopErrors = desktopErrors;
  console.log(JSON.stringify(result));
  await browser.close();
  if (!result.directCanvasEntry || !result.alignmentAuto || !result.paletteAlphabetical || !result.mirrorCellMapping || !result.mirrorTextForward || !result.mirrorFocusMapping || !result.canvasVisible || !result.originalResolution || !result.verticalLayout || !result.paletteTextIsMinimal || !result.highlightedSummary || !result.otherColorAndCodeHidden || result.gridSize !== "52 × 52" || result.initialZoom !== "100%" || !result.fittedAt100 || !result.adaptiveStage || result.minimumZoom !== "75%" || !result.containedAt75 || !result.coversAt150 || !result.stageStable || result.selectedColors !== 2 || !result.dimmingApplied || !result.paletteItems || errors.length || consoleProblems.length || desktopErrors.length) process.exit(1);
})();
