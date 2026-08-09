const { chromium } = require("playwright");
const path = require("path");
const os = require("os");

const baseUrl = "http://127.0.0.1:4173/";
const examples = [
  { index: 0, grid: "52 × 52", name: "MARD_52x52_示例图纸" },
  { index: 1, grid: "104 × 104", name: "MARD_104x104_示例图纸_A" },
  { index: 2, grid: "104 × 104", name: "MARD_104x104_示例图纸_B" },
  { index: 3, grid: "156 × 156", name: "MARD_156x156_示例图纸" },
  { index: 4, grid: "104 × 104", name: "MARD_104x104_示例图纸_C" },
  { index: 5, grid: "104 × 104", name: "MARD_104x104_示例图纸_D" },
  { index: 6, grid: "104 × 73", name: "MARD_104x73_示例图纸" },
  { index: 7, grid: "75 × 75", name: "MARD_75x75_示例图纸" },
  { index: 8, grid: "104 × 104", name: "MARD_104x104_示例图纸_E" },
  { index: 9, grid: "104 × 104", name: "MARD_104x104_示例图纸_F" },
  { index: 10, grid: "145 × 145", name: "MARD_145x145_示例图纸" },
  { index: 11, grid: "78 × 104", name: "MARD_78x104_示例图纸" },
  { index: 12, grid: "64 × 64", name: "MARD_64x64_示例图纸" },
  { index: 13, grid: "54 × 96", name: "MARD_54x96_示例图纸" },
  { index: 14, grid: "90 × 160", name: "MARD_90x160_示例图纸" },
  { index: 15, grid: "52 × 52", name: "MARD_52x52_示例图纸_B" }
];

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

  const results = [];
  for (const example of examples) {
    await page.goto(`${baseUrl}?example=${example.index + 1}`, { waitUntil: "networkidle" });
    const gallery = page.locator("#startGallery");
    await gallery.waitFor({ state: "visible" });
    const cards = gallery.locator(".demo-card");
    const cardCount = await cards.count();
    await cards.nth(example.index).click();
    await page.waitForFunction(expected => document.querySelector("#gridSize")?.textContent === expected, example.grid, { timeout: 30000 });
    await page.locator("#paletteList .palette-item").first().waitFor();
    results.push({
      cardCount,
      grid: await page.locator("#gridSize").textContent(),
      name: await page.locator("#patternName").textContent(),
      paletteItems: await page.locator("#paletteList .palette-item").count()
    });
  }

  const screenshot = path.join(os.tmpdir(), "perler-example-picker.png");
  await page.goto(`${baseUrl}?picker=screenshot`, { waitUntil: "networkidle" });
  await page.locator("#startGallery").waitFor({ state: "visible" });
  await page.waitForFunction(() => [...document.querySelectorAll(".demo-card img")].every(image => image.complete && image.naturalWidth > 0));
  const uploadHiddenBeforeAdmin = await page.locator("#uploadExamplePattern").isHidden();
  await page.locator("#adminModeButton").click();
  await page.locator("#uploadExamplePattern").waitFor({ state: "visible" });
  const adminState = await page.evaluate(() => {
    const admin = document.querySelector("#adminModeButton"), add = document.querySelector("#addPattern"), upload = document.querySelector("#uploadExamplePattern");
    const addRect = add.getBoundingClientRect(), uploadRect = upload.getBoundingClientRect();
    return {
      iconOnly: admin.textContent.trim() === "" && !!admin.querySelector("svg"),
      pressed: admin.getAttribute("aria-pressed") === "true",
      uploadBelowAdd: uploadRect.top >= addRect.bottom,
      uploadFullyVisible: uploadRect.top >= 0 && uploadRect.bottom <= innerHeight
    };
  });
  const desktopAddButtonVisible = await page.locator("#addPattern").evaluate(button => {
    const rect = button.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight;
  });
  await page.waitForTimeout(2100);
  await page.screenshot({ path: screenshot, fullPage: false });
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#uploadExamplePattern").click();
  const chooser = await chooserPromise;
  await chooser.setFiles(path.resolve(__dirname, "../assets/demo-pattern.png"));
  await page.waitForFunction(() => document.querySelectorAll("#startGallery .demo-card").length === 17);
  const uploadedExampleAdded = await page.locator("#startGallery .demo-card").last().evaluate(card => card.textContent.includes("示例 17") && card.textContent.includes("自动识别"));

  const ipad = await browser.newPage({
    viewport: { width: 1024, height: 1366 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true
  });
  const ipadErrors = [];
  ipad.on("pageerror", error => ipadErrors.push(error.message));
  ipad.on("console", message => {
    if (["error", "warning"].includes(message.type())) ipadErrors.push(message.text());
  });
  await ipad.goto(`${baseUrl}?picker=ipad`, { waitUntil: "networkidle" });
  await ipad.locator("#startGallery").waitFor({ state: "visible" });
  const ipadPickerFits = await ipad.locator("#startGallery").evaluate(gallery => {
    const rect = gallery.getBoundingClientRect();
    return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
  });
  const tallExample = ipad.locator(".demo-card").nth(14);
  await tallExample.scrollIntoViewIfNeeded();
  await tallExample.tap();
  await ipad.waitForFunction(() => document.querySelector("#gridSize")?.textContent === "90 × 160", null, { timeout: 30000 });
  const ipadScreenshot = path.join(os.tmpdir(), "perler-example-picker-ipad.png");
  await ipad.goto(`${baseUrl}?picker=ipad-screenshot`, { waitUntil: "networkidle" });
  await ipad.locator("#startGallery").waitFor({ state: "visible" });
  await ipad.waitForFunction(() => [...document.querySelectorAll(".demo-card img")].every(image => image.complete && image.naturalWidth > 0));
  await ipad.locator("#addPattern").scrollIntoViewIfNeeded();
  await ipad.waitForTimeout(500);
  const ipadAddButton = await ipad.locator("#addPattern").evaluate(button => {
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      visible: rect.top >= 0 && rect.bottom <= innerHeight,
      white: style.backgroundColor === "rgb(255, 255, 255)",
      rounded: Number.parseFloat(style.borderRadius) >= 10
    };
  });
  await ipad.screenshot({ path: ipadScreenshot, fullPage: false });

  const result = {
    url: page.url(),
    title: await page.title(),
    galleryVisible: await page.locator("#startGallery").isVisible(),
    desktopAddButtonVisible,
    uploadHiddenBeforeAdmin,
    adminState,
    uploadedExampleAdded,
    results,
    screenshot,
    ipad: { pickerFits: ipadPickerFits, addButton: ipadAddButton, screenshot: ipadScreenshot, errors: ipadErrors },
    errors
  };
  console.log(JSON.stringify(result));
  await browser.close();

  const failed = errors.length || ipadErrors.length || !desktopAddButtonVisible || !uploadHiddenBeforeAdmin || !adminState.iconOnly || !adminState.pressed || !adminState.uploadBelowAdd || !adminState.uploadFullyVisible || !uploadedExampleAdded || !ipadPickerFits || !ipadAddButton.visible || !ipadAddButton.white || !ipadAddButton.rounded || !result.galleryVisible || results.some((item, index) =>
    item.cardCount !== examples.length || item.grid !== examples[index].grid ||
    item.name !== examples[index].name || item.paletteItems < 1
  );
  if (failed) process.exit(1);
})();
