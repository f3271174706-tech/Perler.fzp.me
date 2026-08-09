const { chromium } = require("playwright");
const path = require("path");

const baseUrl = "http://127.0.0.1:4173/";
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
    results.push({ ...device, ...metrics, customControlsFit, errors });
    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify(results));
  const failed = results.some(result =>
    !result.maxTouchPoints || !result.noHorizontalOverflow || !result.stageWithinWorkingViewport ||
    !result.controlsVisible || !result.paletteBeforeControls || !result.canvasContainedAt75 ||
    result.zoom !== "75%" || !result.touchTargetsAre44 || !result.customControlsFit || result.errors.length
  );
  if (failed) process.exit(1);
})();
