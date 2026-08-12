const { chromium } = require("playwright");

const baseUrl = process.env.PERLER_BASE_URL || "http://127.0.0.1:4173/";
const adminKey = process.env.PERLER_ADMIN_KEY;
if (!adminKey) throw new Error("PERLER_ADMIN_KEY is required");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const button = page.locator("#adminModeButton"), upload = page.locator("#uploadExamplePattern");
  await button.click();
  await page.locator("#adminKeyDialog").waitFor({ state: "visible" });
  const passwordMasked = await page.locator("#adminKeyInput").getAttribute("type") === "password";

  await page.locator("#adminKeyInput").fill("not-the-admin-key");
  await page.locator("#adminKeySubmit").click();
  await page.locator("#adminKeyError").waitFor({ state: "visible" });
  const wrongKeyRejected = await button.getAttribute("aria-pressed") === "false" && await upload.isHidden();

  await page.locator("#adminKeyInput").fill(adminKey);
  await page.locator("#adminKeySubmit").click();
  await page.waitForFunction(() => document.querySelector("#adminModeButton")?.getAttribute("aria-pressed") === "true");
  const correctKeyAccepted = await upload.isVisible();

  const source = await (await page.request.get(new URL("app-board.js?v=20260812-1", baseUrl).href)).text();
  const keyNotExposed = !source.includes(adminKey);
  await button.click();
  const closesWithoutKey = await button.getAttribute("aria-pressed") === "false" && await upload.isHidden();

  const result = { baseUrl, passwordMasked, wrongKeyRejected, correctKeyAccepted, keyNotExposed, closesWithoutKey, errors };
  console.log(JSON.stringify(result));
  await browser.close();
  if (!passwordMasked || !wrongKeyRejected || !correctKeyAccepted || !keyNotExposed || !closesWithoutKey || errors.length) process.exit(1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
