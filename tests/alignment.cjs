const { chromium } = require("playwright");
const path = require("path");

const baseUrl = process.env.PERLER_BASE_URL || "http://127.0.0.1:4173/";

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
  await page.locator("#fileInput").setInputFiles(path.resolve(__dirname, "../assets/demo-pattern.png"));
  await page.locator("#alignmentDialog").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#alignmentConfidence")?.classList.contains("scanning"));

  const automatic = await page.evaluate(() => {
    const dialog = alignmentDialog.getBoundingClientRect();
    const handles = [redCrosshair, blueCrosshair, greenCrosshair, yellowCrosshair].map(handle => handle.getBoundingClientRect());
    return {
      grid: `${alignmentCols.value} × ${alignmentRows.value}`,
      detection: alignmentDetection.textContent,
      confidence: alignmentConfidence.textContent,
      crop: alignmentCropSize.textContent,
      cell: alignmentCellSize.textContent,
      dialogFits: dialog.left >= 0 && dialog.top >= 0 && dialog.right <= innerWidth && dialog.bottom <= innerHeight,
      handlesVisible: handles.every(handle => handle.width >= 44 && handle.height >= 44)
    };
  });
  await page.screenshot({ path: path.join(__dirname, "alignment-calibration.png"), fullPage: true });

  await page.locator("#yellowCrosshair").focus();
  await page.locator("#yellowCrosshair").press("ArrowRight");
  await page.locator("#yellowCrosshair").press("ArrowDown");
  const cellCalibrationWorks = await page.evaluate(() => ({
    grid: `${alignmentCols.value} × ${alignmentRows.value}`,
    summary: alignmentCellSize.textContent,
    detection: alignmentDetection.textContent,
    active: selectYellowCrosshair.classList.contains("active") && yellowCrosshair.classList.contains("active")
  }));

  await page.locator("#alignmentPreset").selectOption("52x52");

  await page.locator("#redCrosshair").focus();
  await page.locator("#redCrosshair").press("Shift+ArrowRight");
  await page.locator("#redCrosshair").press("Shift+ArrowDown");
  await page.locator("#blueCrosshair").focus();
  await page.locator("#blueCrosshair").press("Shift+ArrowLeft");
  await page.locator("#blueCrosshair").press("Shift+ArrowUp");
  const adjustedCrop = await page.locator("#alignmentCropSize").textContent();

  await page.locator("#alignmentPreset").selectOption("64x64");
  const presetWorks = await page.evaluate(() => alignmentCols.value === "64" && alignmentRows.value === "64" && alignmentCellSize.textContent.includes("32.2 × 32.2 px"));
  await page.locator("#resetAlignment").click();
  await page.waitForFunction(() => !document.querySelector("#alignmentConfidence")?.classList.contains("scanning"));
  const resetWorks = await page.evaluate(() => alignmentCols.value === "52" && alignmentRows.value === "52" && alignmentCropSize.textContent === "2080 × 2080 px");

  await page.locator("#confirmAlignment").click();
  const processingShown = await page.locator("#alignmentProcessing").isVisible();
  await page.waitForFunction(() => !document.querySelector("#alignmentDialog")?.open, null, { timeout: 30000 });
  await page.locator("#paletteList .palette-item").first().waitFor();

  const completed = await page.evaluate(() => ({
    grid: gridSize.textContent,
    resolution: [beadCanvas.width, beadCanvas.height],
    palette: document.querySelectorAll("#paletteList .palette-item").length,
    progress: alignmentProgressValue.textContent
  }));
  const result = { automatic, cellCalibrationWorks, adjustedCrop, presetWorks, resetWorks, processingShown, completed, errors };
  console.log(JSON.stringify(result));
  await browser.close();

  if (automatic.grid !== "52 × 52" || !automatic.detection.includes("已定位") || !automatic.confidence.includes("高") || automatic.crop !== "2080 × 2080 px" || !automatic.cell.includes("40.0 × 40.0 px") || !automatic.cell.includes("52 × 52") || !automatic.dialogFits || !automatic.handlesVisible || cellCalibrationWorks.grid !== "51 × 51" || !cellCalibrationWorks.summary.includes("41.0 × 41.0 px") || !cellCalibrationWorks.detection.includes("已按单格大小推算") || !cellCalibrationWorks.active || adjustedCrop !== "2060 × 2060 px" || !presetWorks || !resetWorks || !processingShown || completed.grid !== "52 × 52" || completed.resolution[0] !== 2080 || completed.resolution[1] !== 2080 || completed.palette < 1 || completed.progress !== "100%" || errors.length) process.exit(1);
})();
