const { chromium } = require("playwright");

const baseUrl = process.env.PERLER_BASE_URL || "http://127.0.0.1:4173/";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#startGallery .demo-card").first().click();
  await page.waitForFunction(() => state.grid && state.used.length && !document.querySelector("#beadCanvas").classList.contains("hidden"));

  const beforeZoom = await page.locator("#zoomLabel").textContent();
  const stage = await page.locator("#boardStage").boundingBox();
  const center = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { id: 1, x: center.x - 35, y: center.y }, { id: 2, x: center.x + 35, y: center.y }
  ] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [
    { id: 1, x: center.x - 95, y: center.y }, { id: 2, x: center.x + 95, y: center.y }
  ] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForFunction(() => Number.parseInt(document.querySelector("#zoomLabel").textContent, 10) > 100);
  const afterZoom = await page.locator("#zoomLabel").textContent();
  while (Number.parseInt(await page.locator("#zoomLabel").textContent(), 10) > 125) await page.locator("#zoomOut").click();

  await page.locator("#editCellsButton").click();
  const editMode = await page.locator("#editCellsButton").getAttribute("aria-pressed");

  async function visibleCell(kind) {
    return page.evaluate(expected => {
      const grid = state.grid, canvasRect = beadCanvas.getBoundingClientRect(), stageRect = boardStage.getBoundingClientRect();
      const candidates = grid.cells.map((code, index) => ({ code, index, row: Math.floor(index / grid.cols), col: index % grid.cols }))
        .filter(cell => expected === "filled" ? Boolean(cell.code) : !cell.code)
        .sort((a, b) => Math.hypot(a.col - grid.cols / 2, a.row - grid.rows / 2) - Math.hypot(b.col - grid.cols / 2, b.row - grid.rows / 2));
      for (const cell of candidates) {
        const pixelX = grid.left + (cell.col + .5) * (grid.right - grid.left) / grid.cols;
        const pixelY = grid.top + (cell.row + .5) * (grid.bottom - grid.top) / grid.rows;
        const x = canvasRect.left + pixelX * canvasRect.width / beadCanvas.width;
        const y = canvasRect.top + pixelY * canvasRect.height / beadCanvas.height;
        if (x > stageRect.left + 8 && x < stageRect.right - 8 && y > stageRect.top + 8 && y < stageRect.bottom - 8) return { ...cell, x, y };
      }
      return null;
    }, kind);
  }

  const filled = await visibleCell("filled");
  if (!filled) throw new Error("No visible filled cell found");
  await page.touchscreen.tap(filled.x, filled.y);
  await page.locator("#cellEditorDialog").waitFor({ state: "visible" });
  const replacement = await page.evaluate(current => state.mard.find(color => color.code !== current).code, filled.code);
  await page.locator("#cellColorInput").fill(replacement);
  await page.locator("#cellEditorForm .primary-action").click();
  const filledResult = await page.evaluate(({ index, replacement }) => ({
    code: state.grid.cells[index], edit: state.cellEdits.get(index), count: state.grid.codeCounts.get(replacement), palette: state.used.some(color => color.code === replacement)
  }), { index: filled.index, replacement });

  const blank = await visibleCell("blank");
  if (!blank) throw new Error("No visible blank cell found");
  await page.touchscreen.tap(blank.x, blank.y);
  await page.locator("#cellEditorDialog").waitFor({ state: "visible" });
  await page.screenshot({ path: require("path").resolve(__dirname, "mobile-edit.png"), fullPage: true });
  const blankCode = await page.evaluate(() => state.mard[state.mard.length - 1].code);
  await page.locator("#cellColorInput").fill(blankCode);
  await page.locator("#cellEditorForm .primary-action").click();
  const blankResult = await page.evaluate(({ index, blankCode }) => ({
    code: state.grid.cells[index], edit: state.cellEdits.get(index), count: state.grid.codeCounts.get(blankCode), palette: state.used.some(color => color.code === blankCode)
  }), { index: blank.index, blankCode });

  const result = {
    viewport: page.viewportSize(), beforeZoom, afterZoom, pinchZoomed: Number.parseInt(afterZoom, 10) > 100,
    editMode: editMode === "true", filledResult, blankResult,
    editorFits: await page.locator("#cellEditorDialog").evaluate(dialog => {
      const rect = dialog.getBoundingClientRect(); return rect.width <= innerWidth && rect.height <= innerHeight;
    }),
    errors
  };
  console.log(JSON.stringify(result));
  if (!result.pinchZoomed || !result.editMode || filledResult.code !== replacement || blankResult.code !== blankCode || !filledResult.palette || !blankResult.palette || errors.length) process.exitCode = 1;
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
