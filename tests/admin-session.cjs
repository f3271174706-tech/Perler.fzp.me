const { chromium } = require("playwright");

const baseUrl = process.env.PERLER_BASE_URL || "http://127.0.0.1:4173/";
const cookieName = "perler_admin_session";
const sevenDays = 7 * 24 * 60 * 60;

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const initiallyLocked = await page.locator("#adminModeButton").getAttribute("aria-pressed") === "false";

  const origin = new URL(baseUrl).origin;
  const nearExpiry = Date.now() + 30 * 60 * 1000;
  await context.addCookies([{
    name: cookieName,
    value: `v1.${nearExpiry}`,
    url: origin,
    expires: Math.floor(nearExpiry / 1000),
    sameSite: "Strict",
    secure: origin.startsWith("https:")
  }]);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#adminModeButton")?.getAttribute("aria-pressed") === "true");
  const restored = await page.locator("#uploadExamplePattern").isVisible();
  const renewedCookie = (await context.cookies(origin)).find(cookie => cookie.name === cookieName);
  const valueExpiry = Number(renewedCookie?.value.split(".")[1]);
  const slidingRenewed = renewedCookie && renewedCookie.sameSite === "Strict" &&
    renewedCookie.expires > Date.now() / 1000 + sevenDays - 120 &&
    valueExpiry > Date.now() + (sevenDays - 120) * 1000;

  await page.locator("#adminModeButton").click();
  const cookieCleared = !(await context.cookies(origin)).some(cookie => cookie.name === cookieName);
  await page.reload({ waitUntil: "networkidle" });
  const remainsLockedAfterLogout = await page.locator("#adminModeButton").getAttribute("aria-pressed") === "false";

  const browserExpiry = Date.now() + 60 * 60 * 1000;
  await context.addCookies([{
    name: cookieName,
    value: `v1.${Date.now() - 1000}`,
    url: origin,
    expires: Math.floor(browserExpiry / 1000),
    sameSite: "Strict",
    secure: origin.startsWith("https:")
  }]);
  await page.reload({ waitUntil: "networkidle" });
  const expiredMarkerRejected = await page.locator("#adminModeButton").getAttribute("aria-pressed") === "false" &&
    !(await context.cookies(origin)).some(cookie => cookie.name === cookieName);

  const result = { baseUrl, initiallyLocked, restored, slidingRenewed, cookieCleared, remainsLockedAfterLogout, expiredMarkerRejected, errors };
  console.log(JSON.stringify(result));
  await browser.close();
  if (!initiallyLocked || !restored || !slidingRenewed || !cookieCleared || !remainsLockedAfterLogout || !expiredMarkerRejected || errors.length) process.exit(1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
