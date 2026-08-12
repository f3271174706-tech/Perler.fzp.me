const { chromium } = require("playwright");
const path = require("path");
const os = require("os");

const baseUrl = "http://127.0.0.1:4173/";
const adminKey = process.env.PERLER_ADMIN_KEY;
if (!adminKey) throw new Error("PERLER_ADMIN_KEY is required");

async function enableAdminMode(page, verifyWrongKey = false) {
  if (await page.locator("#adminModeButton").getAttribute("aria-pressed") === "true") return;
  await page.locator("#adminModeButton").click();
  await page.locator("#adminKeyDialog").waitFor({ state: "visible" });
  if (verifyWrongKey) {
    await page.locator("#adminKeyInput").fill("not-the-admin-key");
    await page.locator("#adminKeySubmit").click();
    await page.locator("#adminKeyError").waitFor({ state: "visible" });
    if (await page.locator("#adminModeButton").getAttribute("aria-pressed") !== "false") {
      throw new Error("Wrong administrator key was accepted");
    }
  }
  await page.locator("#adminKeyInput").fill(adminKey);
  await page.locator("#adminKeySubmit").click();
  await page.waitForFunction(() => document.querySelector("#adminModeButton")?.getAttribute("aria-pressed") === "true");
}

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
  { index: 15, grid: "52 × 52", name: "MARD_52x52_示例图纸_B" },
  { index: 16, grid: "104 × 104", name: "MARD_104x104_示例图纸_G" }
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
  const appSource = await (await page.request.get(`${baseUrl}app-board.js`)).text();
  const adminKeyNotExposed = !appSource.includes(adminKey);
  await enableAdminMode(page, true);
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
  await page.locator("#alignmentDialog").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#alignmentConfidence")?.classList.contains("scanning"));
  const exampleUsesCalibration = await page.evaluate(() =>
    document.querySelector(".alignment-step")?.textContent.includes("上传示例图纸") &&
    document.querySelector("#confirmAlignment")?.textContent.includes("添加示例") &&
    alignmentCols.value === "52" && alignmentRows.value === "52"
  );
  await page.locator("#cancelAlignment").click();
  const cancelDoesNotSave = await page.locator("#startGallery .demo-card").count() === 17;

  const confirmChooserPromise = page.waitForEvent("filechooser");
  await page.locator("#uploadExamplePattern").click();
  const confirmChooser = await confirmChooserPromise;
  await confirmChooser.setFiles(path.resolve(__dirname, "../assets/demo-pattern.png"));
  await page.locator("#alignmentDialog").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#alignmentConfidence")?.classList.contains("scanning"));
  await page.locator("#confirmAlignment").click();
  await page.waitForFunction(() => document.querySelectorAll("#startGallery .demo-card").length === 18);
  await page.waitForFunction(() => !document.querySelector("#alignmentDialog")?.open, null, { timeout: 30000 });
  const uploadedExampleAdded = await page.locator("#startGallery .demo-card").last().evaluate(card => card.textContent.includes("示例 18") && card.textContent.includes("52 × 52"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("#startGallery .demo-card").length === 18);
  const uploadedExamplePersisted = await page.locator("#startGallery .demo-card").last().evaluate(card => card.dataset.demoName === "demo-pattern.png");
  await enableAdminMode(page);
  const adminControlsCount = await page.locator("#startGallery .demo-card-admin").count();
  const lastHandle = page.locator("#startGallery .demo-card-shell").last().locator(".demo-drag-handle");
  const previousShell = page.locator("#startGallery .demo-card-shell").nth(16);
  await lastHandle.scrollIntoViewIfNeeded();
  await previousShell.evaluate(shell => shell.scrollIntoView({ block: "center" }));
  const handleBox = await lastHandle.boundingBox(), previousBox = await previousShell.boundingBox();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  const dragStarted = await page.locator("#startGallery .demo-card-shell").last().evaluate(shell => shell.classList.contains("is-dragging"));
  await page.mouse.move(previousBox.x + previousBox.width * .25, previousBox.y + 36, { steps: 8 });
  await page.mouse.up();
  const orderAfterDrag = await page.locator("#startGallery .demo-card").evaluateAll(cards => cards.map(card => card.dataset.demoName));
  const uploadedExampleReordered = await page.locator("#startGallery .demo-card").nth(16).evaluate(card => card.dataset.demoName === "demo-pattern.png");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("#startGallery .demo-card").length === 18);
  const uploadedOrderPersisted = await page.locator("#startGallery .demo-card").nth(16).evaluate(card => card.dataset.demoName === "demo-pattern.png");
  await enableAdminMode(page);
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#startGallery .demo-card[data-demo-name='demo-pattern.png']").locator("xpath=..").locator(".demo-delete-button").click();
  await page.waitForFunction(() => document.querySelectorAll("#startGallery .demo-card").length === 17);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("#startGallery .demo-card").length === 17);
  const uploadedExampleDeleted = await page.locator("#startGallery .demo-card[data-demo-name='demo-pattern.png']").count() === 0;
  await enableAdminMode(page);
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#startGallery .demo-card[data-demo-name='MARD_104x104_示例图纸_G.png']").locator("xpath=..").locator(".demo-delete-button").click();
  await page.waitForFunction(() => document.querySelectorAll("#startGallery .demo-card").length === 16);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("#startGallery .demo-card").length === 16);
  const builtinExampleDeleted = await page.locator("#startGallery .demo-card[data-demo-name='MARD_104x104_示例图纸_G.png']").count() === 0;

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
  await enableAdminMode(ipad);
  const firstIpadShell = ipad.locator("#startGallery .demo-card-shell").first();
  const secondIpadShell = ipad.locator("#startGallery .demo-card-shell").nth(1);
  const firstIpadName = await firstIpadShell.locator(".demo-card").getAttribute("data-demo-name");
  const secondIpadName = await secondIpadShell.locator(".demo-card").getAttribute("data-demo-name");
  const touchHandleBox = await secondIpadShell.locator(".demo-drag-handle").boundingBox();
  const touchTargetBox = await firstIpadShell.boundingBox();
  const cdp = await ipad.context().newCDPSession(ipad);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchHandleBox.x + touchHandleBox.width / 2, y: touchHandleBox.y + touchHandleBox.height / 2, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchTargetBox.x + 24, y: touchTargetBox.y + 58, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const ipadTouchReorder = await ipad.locator("#startGallery .demo-card").first().getAttribute("data-demo-name") === secondIpadName && firstIpadName !== secondIpadName;
  await ipad.locator("#adminModeButton").tap();
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
    adminKeyNotExposed,
    adminState,
    exampleUsesCalibration,
    cancelDoesNotSave,
    uploadedExampleAdded,
    uploadedExamplePersisted,
    adminControlsCount,
    dragStarted,
    dragBoxes: { handleBox, previousBox },
    orderAfterDrag,
    uploadedExampleReordered,
    uploadedOrderPersisted,
    uploadedExampleDeleted,
    builtinExampleDeleted,
    results,
    screenshot,
    ipad: { pickerFits: ipadPickerFits, touchReorder: ipadTouchReorder, addButton: ipadAddButton, screenshot: ipadScreenshot, errors: ipadErrors },
    errors
  };
  console.log(JSON.stringify(result));
  await browser.close();

  const failed = errors.length || ipadErrors.length || !desktopAddButtonVisible || !uploadHiddenBeforeAdmin || !adminKeyNotExposed || !adminState.iconOnly || !adminState.pressed || !adminState.uploadBelowAdd || !adminState.uploadFullyVisible || !exampleUsesCalibration || !cancelDoesNotSave || !uploadedExampleAdded || !uploadedExamplePersisted || adminControlsCount !== 18 || !uploadedExampleReordered || !uploadedOrderPersisted || !uploadedExampleDeleted || !builtinExampleDeleted || !ipadPickerFits || !ipadTouchReorder || !ipadAddButton.visible || !ipadAddButton.white || !ipadAddButton.rounded || !result.galleryVisible || results.some((item, index) =>
    item.cardCount !== examples.length || item.grid !== examples[index].grid ||
    item.name !== examples[index].name || item.paletteItems < 1
  );
  if (failed) process.exit(1);
})();
