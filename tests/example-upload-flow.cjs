const { chromium } = require("playwright");
const path = require("path");

const baseUrl = process.env.PERLER_BASE_URL || "http://127.0.0.1:4173/";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  });
  const context = await browser.newContext();
  const origin = new URL(baseUrl).origin, expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  await context.addCookies([{
    name: "perler_admin_session", value: `v1.${expiresAt}`, url: origin,
    expires: Math.floor(expiresAt / 1000), sameSite: "Strict", secure: origin.startsWith("https:")
  }]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(async () => {
    localStorage.removeItem("perler.example-order.v1");
    const request = indexedDB.deleteDatabase("perler-example-gallery");
    await new Promise(resolve => { request.onsuccess = request.onerror = request.onblocked = resolve; });
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  const initialCount = await page.locator("#startGallery .demo-card").count();

  await page.locator("#exampleFileInput").setInputFiles(path.resolve(__dirname, "../assets/demo-pattern.png"));
  await page.locator("#alignmentDialog").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#alignmentConfidence")?.classList.contains("scanning"));
  const normalFlow = await page.evaluate(() => ({
    step: document.querySelector(".alignment-step")?.textContent,
    action: document.querySelector("#confirmAlignment")?.textContent,
    grid: `${alignmentCols.value}x${alignmentRows.value}`,
    fourCrosshairs: [redCrosshair, blueCrosshair, greenCrosshair, yellowCrosshair].every(handle => handle.offsetParent !== null)
  }));
  await page.locator("#cancelAlignment").click();
  const cancelDoesNotSave = await page.locator("#startGallery .demo-card").count() === initialCount;

  await page.locator("#exampleFileInput").setInputFiles(path.resolve(__dirname, "../assets/demo-pattern.png"));
  await page.locator("#alignmentDialog").waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#alignmentConfidence")?.classList.contains("scanning"));
  await page.locator("#confirmAlignment").click();
  await page.waitForFunction(() => !document.querySelector("#alignmentDialog")?.open, null, { timeout: 30000 });
  await page.locator("#exampleReview").waitFor({ state: "visible" });
  await page.locator("#paletteList .palette-item").first().waitFor();
  const localRecognitionReview = await page.evaluate(count => ({
    notSavedYet: document.querySelectorAll("#startGallery .demo-card").length === count,
    grid: gridSize.textContent,
    paletteItems: document.querySelectorAll("#paletteList .palette-item").length,
    summary: exampleReviewSummary.textContent,
    canvasVisible: beadCanvas.offsetParent !== null
  }), initialCount);
  await page.locator("#confirmExampleReview").click();
  await page.waitForFunction(count => document.querySelectorAll("#startGallery .demo-card").length === count + 1, initialCount, { timeout: 30000 });
  const returnedToGallery = await page.locator("#startGallery").isVisible() && await page.locator("#beadCanvas").isHidden() && await page.locator("#exampleReview").isHidden();
  const addedCard = await page.locator("#startGallery .demo-card").last().evaluate(card => ({ name: card.dataset.demoName, grid: card.dataset.demoGrid, text: card.textContent }));
  const databaseRecord = await page.evaluate(async () => {
    const records = await readUploadedExamples();
    const record = records.at(-1);
    return record && { name: record.name, type: record.type, gridSpec: record.gridSpec, blobType: record.blob.type };
  });

  const result = { baseUrl, initialCount, normalFlow, cancelDoesNotSave, localRecognitionReview, returnedToGallery, addedCard, databaseRecord, errors };
  console.log(JSON.stringify(result));
  await browser.close();
  if (!normalFlow.step.includes("上传示例图纸") || !normalFlow.action.includes("本地识别") || normalFlow.grid !== "52x52" || !normalFlow.fourCrosshairs || !cancelDoesNotSave || !localRecognitionReview.notSavedYet || localRecognitionReview.grid !== "52 × 52" || localRecognitionReview.paletteItems < 1 || !localRecognitionReview.summary.includes("本地识别 52 × 52") || !localRecognitionReview.canvasVisible || !returnedToGallery || addedCard.grid !== "52x52" || !addedCard.text.includes("52 × 52") || databaseRecord.gridSpec !== "52x52" || databaseRecord.type !== "image/png" || databaseRecord.blobType !== "image/png" || errors.length) process.exit(1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
