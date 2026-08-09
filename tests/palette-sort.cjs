const { chromium } = require("playwright");
const path = require("path");
const os = require("os");

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

  await page.goto("http://127.0.0.1:4173/?test=palette-sort", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "示例图纸" }).click();
  await page.locator(".demo-card").nth(2).click();
  await page.waitForFunction(() => document.querySelector("#gridSize")?.textContent === "104 × 104", null, { timeout: 30000 });

  const readPalette = () => page.locator("#paletteList .palette-item").evaluateAll(items => items.map(item => ({
    code: item.querySelector("strong").textContent,
    count: Number(item.querySelector(".color-count").textContent)
  })));
  const byCode = await readPalette();
  await page.locator("#paletteSort").selectOption("count");
  const byCount = await readPalette();
  const screenshot = path.join(os.tmpdir(), "perler-palette-sort-count.png");
  await page.locator("#paletteSort").scrollIntoViewIfNeeded();
  await page.screenshot({ path: screenshot, fullPage: false });
  await page.locator("#paletteSort").selectOption("code");
  const restoredByCode = await readPalette();

  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const codeSorted = list => list.every((item, index) => !index || collator.compare(list[index - 1].code, item.code) <= 0);
  const countSorted = list => list.every((item, index) => !index ||
    list[index - 1].count > item.count ||
    (list[index - 1].count === item.count && collator.compare(list[index - 1].code, item.code) <= 0));
  const result = {
    title: await page.title(),
    url: page.url(),
    defaultMode: "code",
    codeSorted: codeSorted(byCode),
    countSorted: countSorted(byCount),
    restored: codeSorted(restoredByCode),
    firstByCount: byCount.slice(0, 5),
    screenshot,
    errors
  };
  console.log(JSON.stringify(result));
  await browser.close();
  if (!result.codeSorted || !result.countSorted || !result.restored || errors.length) process.exit(1);
})();
