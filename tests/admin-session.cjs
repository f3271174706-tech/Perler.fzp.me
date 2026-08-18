const { chromium } = require("playwright");

const baseUrl = process.env.PERLER_BASE_URL || "http://127.0.0.1:4173/";
const adminKey = process.env.PERLER_ADMIN_KEY || "test-admin-key";
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
  const login = await context.request.post(`${origin}/api/admin/session`, { data: { key: adminKey } });
  const loginAccepted = login.ok();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#adminModeButton")?.getAttribute("aria-pressed") === "true");
  const restored = await page.locator("#uploadExamplePattern").isVisible();
  const issuedCookie = (await context.cookies(origin)).find(cookie => cookie.name === cookieName);
  const signedHttpOnlyCookie = issuedCookie?.value.startsWith("v2.") && issuedCookie.httpOnly && issuedCookie.sameSite === "Strict";
  const sevenDayCookie = issuedCookie && issuedCookie.expires > Date.now() / 1000 + sevenDays - 120;

  const previousExpiry = issuedCookie?.expires || 0;
  await page.evaluate(() => { state.adminSessionRenewedAt = 0; renewAdminSession(true); });
  await page.waitForTimeout(200);
  const renewedCookie = (await context.cookies(origin)).find(cookie => cookie.name === cookieName);
  const slidingRenewed = Boolean(renewedCookie && renewedCookie.expires >= previousExpiry);

  await page.locator("#adminModeButton").click();
  await page.waitForTimeout(100);
  const cookieCleared = !(await context.cookies(origin)).some(cookie => cookie.name === cookieName);
  await page.reload({ waitUntil: "networkidle" });
  const remainsLockedAfterLogout = await page.locator("#adminModeButton").getAttribute("aria-pressed") === "false";

  const forgedExpiry = Date.now() + sevenDays * 1000;
  await context.addCookies([{
    name: cookieName,
    value: `v1.${forgedExpiry}`,
    url: origin,
    expires: Math.floor(forgedExpiry / 1000),
    sameSite: "Strict",
    secure: origin.startsWith("https:")
  }]);
  await page.reload({ waitUntil: "networkidle" });
  const forgedCookieRejected = await page.locator("#adminModeButton").getAttribute("aria-pressed") === "false" &&
    !(await context.cookies(origin)).some(cookie => cookie.name === cookieName);

  const result = { baseUrl, initiallyLocked, loginAccepted, restored, signedHttpOnlyCookie, sevenDayCookie, slidingRenewed, cookieCleared, remainsLockedAfterLogout, forgedCookieRejected, errors };
  console.log(JSON.stringify(result));
  await browser.close();
  if (!initiallyLocked || !loginAccepted || !restored || !signedHttpOnlyCookie || !sevenDayCookie || !slidingRenewed || !cookieCleared || !remainsLockedAfterLogout || !forgedCookieRejected || errors.length) process.exit(1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
