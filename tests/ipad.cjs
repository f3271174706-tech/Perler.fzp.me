const { chromium } = require("playwright");
const path = require("path");

const baseUrl = process.env.PERLER_BASE_URL || "http://127.0.0.1:4173/";
const devices = [
  { name: "ipad-portrait", width: 1024, height: 1366 },
  { name: "ipad-landscape", width: 1366, height: 1024 }
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  });
  const results = [];

  for (const device of devices) {
    const page = await browser.newPage({
      viewport: { width: device.width, height: device.height },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (["error", "warning"].includes(message.type())) errors.push(message.text());
    });

    await page.goto(`${baseUrl}?device=${device.name}`, { waitUntil: "networkidle" });
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.locator("#addPattern").tap();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(path.resolve(__dirname, "../assets/demo-pattern.png"));
    await page.locator("#alignmentDialog").waitFor({ state: "visible" });
    await page.waitForFunction(() => !document.querySelector("#alignmentConfidence")?.classList.contains("scanning"));
    const calibration = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const dialog = rect("#alignmentDialog"), confirm = rect("#confirmAlignment");
      const crosshairs = ["#redCrosshair", "#blueCrosshair", "#greenCrosshair", "#yellowCrosshair"].map(rect);
      return {
        autoGrid: alignmentCols.value === "52" && alignmentRows.value === "52",
        cellCalibration: alignmentCellSize.textContent.includes("40.0 × 40.0 px"),
        fitsViewport: dialog.left >= 0 && dialog.right <= innerWidth && dialog.top >= 0 && dialog.bottom <= innerHeight,
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
        crosshairsTouchReady: crosshairs.every(handle => handle.width >= 44 && handle.height >= 44),
        confirmTouchReady: confirm.width >= 44 && confirm.height >= 44
      };
    });
    await page.locator("#selectYellowCrosshair").tap();
    await page.locator('.nudge-pad button[data-nudge-x="1"]').tap();
    calibration.cellNudgeWorks = await page.evaluate(() => alignmentCols.value === "51" && alignmentCellSize.textContent.includes("41.0 × 40.0 px"));
    await page.locator("#alignmentPreset").selectOption("52x52");
    const cropBeforeNudge = await page.locator("#alignmentCropSize").textContent();
    await page.locator("#selectBlueCrosshair").tap();
    await page.locator('.nudge-pad button[data-nudge-x="-1"]').tap();
    const cropAfterNudge = await page.locator("#alignmentCropSize").textContent();
    calibration.nudgeWorks = cropBeforeNudge !== cropAfterNudge;
    await page.locator("#resetAlignment").tap();
    await page.waitForFunction(() => !document.querySelector("#alignmentConfidence")?.classList.contains("scanning"));
    await page.locator("#confirmAlignment").tap();
    await page.locator("#paletteList .palette-item").first().waitFor();
    await page.waitForFunction(() => document.querySelector("#gridSize")?.textContent === "52 × 52");

    await page.locator("#paletteList .palette-item").first().tap();
    await page.waitForFunction(() => document.querySelector("#currentColor")?.textContent.includes("已高亮"));
    await page.locator("#zoomOut").tap();

    const metrics = await page.evaluate(() => {
      const rect = selector => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return { top: value.top, right: value.right, bottom: value.bottom, left: value.left, width: value.width, height: value.height };
      };
      const stage = rect("#boardStage"), canvas = rect("#beadCanvas"), palette = rect("#paletteList"), controls = rect(".palette-rail-head");
      const touchTargets = ["#gridPreset", "#paletteSort", "#newPattern", "#showAll", "#exportMenu > summary", "#mirrorButton", "#zoomOut", "#zoomIn"].map(selector => ({ selector, ...rect(selector) }));
      return {
        viewport: [innerWidth, innerHeight],
        maxTouchPoints: navigator.maxTouchPoints,
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
        stageWithinWorkingViewport: stage.bottom <= innerHeight - 170,
        controlsVisible: controls.bottom <= innerHeight,
        paletteBeforeControls: palette.bottom <= controls.top,
        canvasContainedAt75: canvas.left >= stage.left && canvas.right <= stage.right && canvas.top >= stage.top && canvas.bottom <= stage.bottom,
        zoom: document.querySelector("#zoomLabel").textContent,
        touchTargets: touchTargets.map(target => ({ selector: target.selector, width: target.width, height: target.height })),
        touchTargetsAre44: touchTargets.every(target => target.width >= 44 && target.height >= 44)
      };
    });

    await page.locator("#gridPreset").selectOption("custom");
    await page.locator("#gridCols").fill("104");
    await page.locator("#gridRows").fill("78");
    const customControlsFit = await page.evaluate(() => {
      const controls = document.querySelector(".palette-rail-head").getBoundingClientRect();
      return controls.left >= 0 && controls.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
    });

    await page.screenshot({ path: path.join(__dirname, `${device.name}.png`), fullPage: true });
    results.push({ ...device, calibration, ...metrics, customControlsFit, errors });
    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify(results));
  const failed = results.some(result =>
    !result.calibration.autoGrid || !result.calibration.cellCalibration || !result.calibration.fitsViewport || !result.calibration.noHorizontalOverflow || !result.calibration.crosshairsTouchReady || !result.calibration.confirmTouchReady || !result.calibration.cellNudgeWorks || !result.calibration.nudgeWorks ||
    !result.maxTouchPoints || !result.noHorizontalOverflow || !result.stageWithinWorkingViewport ||
    !result.controlsVisible || !result.paletteBeforeControls || !result.canvasContainedAt75 ||
    result.zoom !== "75%" || !result.touchTargetsAre44 || !result.customControlsFit || result.errors.length
  );
  if (failed) process.exit(1);
})();
