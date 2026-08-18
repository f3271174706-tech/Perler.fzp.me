const fs = require("node:fs");
const path = require("node:path");

const baseUrl = process.env.PERLER_BASE_URL || "http://127.0.0.1:4173/";
const origin = new URL(baseUrl).origin;
const adminKey = process.env.PERLER_ADMIN_KEY || "test-admin-key";

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";")[0] || "";
}

async function json(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${payload.error || response.statusText}`);
  return payload;
}

(async () => {
  const forged = await fetch(`${origin}/api/examples/order`, {
    method: "PUT", headers: { "Content-Type": "application/json", Cookie: `perler_admin_session=v1.${Date.now() + 604800000}` },
    body: JSON.stringify({ order: [] })
  });
  const forgedCookieRejected = forged.status === 401;

  const wrong = await fetch(`${origin}/api/admin/session`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "wrong-key" })
  });
  const wrongKeyRejected = wrong.status === 401;

  const login = await fetch(`${origin}/api/admin/session`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: adminKey })
  });
  const cookie = cookieFrom(login);
  const sessionCookieProtected = login.ok && /perler_admin_session=v2\./.test(cookie) && /HttpOnly/i.test(login.headers.get("set-cookie") || "");

  const before = await json(await fetch(`${origin}/api/examples`));
  const png = fs.readFileSync(path.resolve(__dirname, "../assets/demo-pattern.png"));
  const upload = await fetch(`${origin}/api/examples`, {
    method: "POST", headers: {
      Cookie: cookie, "Content-Type": "image/png", "X-Example-Name": encodeURIComponent("跨设备测试图纸.png"), "X-Grid-Spec": "52x52"
    }, body: png
  });
  const uploaded = (await json(upload)).example;
  const duplicateUpload = await fetch(`${origin}/api/examples`, {
    method: "POST", headers: {
      Cookie: cookie, "Content-Type": "image/png", "X-Example-Name": encodeURIComponent("同图重复上传.png"), "X-Grid-Spec": "52x52"
    }, body: png
  });
  const duplicatePayload = await json(duplicateUpload);

  const anonymousView = await json(await fetch(`${origin}/api/examples`));
  const visibleWithoutAdmin = anonymousView.examples.some(record => record.id === uploaded.id && record.gridSpec === "52x52");
  const duplicateDeduplicated = duplicatePayload.duplicate === true && duplicatePayload.example.id === uploaded.id &&
    anonymousView.examples.filter(record => record.id === uploaded.id).length === 1;
  const image = await fetch(new URL(uploaded.url, origin));
  const imageBytes = Buffer.from(await image.arrayBuffer());
  const imageAvailable = image.ok && imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const desiredOrder = [uploaded.id, ...before.order.filter(id => id !== uploaded.id)];
  const ordered = await json(await fetch(`${origin}/api/examples/order`, {
    method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ order: desiredOrder, hiddenBuiltins: ["builtin:server-gallery-test.png"] })
  }));
  const orderPersisted = ordered.order[0] === uploaded.id && ordered.hiddenBuiltins.includes("builtin:server-gallery-test.png") &&
    (await json(await fetch(`${origin}/api/examples`))).order[0] === uploaded.id;

  const secondLogin = await fetch(`${origin}/api/admin/session`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: adminKey })
  });
  const secondCookie = cookieFrom(secondLogin);
  const deleteResponse = await fetch(`${origin}/api/examples/${encodeURIComponent(uploaded.id)}`, { method: "DELETE", headers: { Cookie: secondCookie } });
  const deleted = deleteResponse.ok && !(await json(await fetch(`${origin}/api/examples`))).examples.some(record => record.id === uploaded.id);

  await fetch(`${origin}/api/examples/order`, {
    method: "PUT", headers: { Cookie: secondCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ order: before.order, hiddenBuiltins: before.hiddenBuiltins })
  });

  const result = { forgedCookieRejected, wrongKeyRejected, sessionCookieProtected, visibleWithoutAdmin, duplicateDeduplicated, imageAvailable, orderPersisted, deleted };
  console.log(JSON.stringify(result));
  if (Object.values(result).some(value => !value)) process.exit(1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
