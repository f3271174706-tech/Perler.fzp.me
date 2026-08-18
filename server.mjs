import http from "node:http";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PERLER_PORT || 18040);
const dataRoot = path.resolve(process.env.PERLER_DATA_DIR || path.join(appRoot, ".perler-data"));
const imageRoot = path.join(dataRoot, "examples");
const galleryFile = path.join(dataRoot, "gallery.json");
const maxImageBytes = 40 * 1024 * 1024;
const adminKeyHash = String(process.env.PERLER_ADMIN_KEY_SHA256 || createHash("sha256").update("test-admin-key").digest("hex")).toLowerCase();
const sessionSecret = String(process.env.PERLER_SESSION_SECRET || randomBytes(32).toString("hex"));
const sessionMaxAgeSeconds = 7 * 24 * 60 * 60;
const sessionCookieName = "perler_admin_session";
const loginFailures = new Map();
if (process.env.NODE_ENV === "production" && (!process.env.PERLER_ADMIN_KEY_SHA256 || !process.env.PERLER_SESSION_SECRET)) {
  throw new Error("PERLER_ADMIN_KEY_SHA256 and PERLER_SESSION_SECRET are required in production");
}
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"], [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"], [".png", "image/png"],
  [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".svg", "image/svg+xml"]
]);

await mkdir(imageRoot, { recursive: true });

function cleanGallery(value) {
  const examples = Array.isArray(value?.examples) ? value.examples.filter(item =>
    typeof item?.id === "string" && item.id.startsWith("uploaded:") && typeof item.file === "string" && /^[a-f0-9-]+\.png$/i.test(item.file)
  ).map(item => ({
    id: item.id, file: item.file, name: String(item.name || "示例图纸.png").slice(0, 180),
    gridSpec: /^\d{1,3}x\d{1,3}$/.test(item.gridSpec) ? item.gridSpec : "", createdAt: Number(item.createdAt || Date.now()),
    sha256: /^[a-f0-9]{64}$/.test(item.sha256) ? item.sha256 : ""
  })) : [];
  return {
    version: 1, examples,
    order: Array.isArray(value?.order) ? [...new Set(value.order.filter(id => typeof id === "string" && id.length <= 240))] : [],
    hiddenBuiltins: Array.isArray(value?.hiddenBuiltins) ? [...new Set(value.hiddenBuiltins.filter(id => typeof id === "string" && id.startsWith("builtin:") && id.length <= 240))] : []
  };
}

async function readGallery() {
  try { return cleanGallery(JSON.parse(await readFile(galleryFile, "utf8"))); }
  catch (error) {
    if (error.code !== "ENOENT") console.error("Unable to read gallery metadata", error);
    return cleanGallery(null);
  }
}

let gallery = await readGallery();
let mutationQueue = Promise.resolve();

async function writeGallery() {
  const contents = `${JSON.stringify(gallery, null, 2)}\n`;
  if (process.platform === "win32") {
    await writeFile(galleryFile, contents, { mode: 0o640 });
    return;
  }
  const temporary = `${galleryFile}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, contents, { mode: 0o640 });
  await rename(temporary, galleryFile);
}

function mutateGallery(action) {
  const operation = mutationQueue.then(action, action);
  mutationQueue = operation.catch(() => {});
  return operation;
}

function json(response, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store", ...headers });
  response.end(body);
}

function parseCookies(request) {
  return new Map(String(request.headers.cookie || "").split(";").map(value => value.trim()).filter(Boolean).map(value => {
    const index = value.indexOf("="); return index < 0 ? [value, ""] : [value.slice(0, index), decodeURIComponent(value.slice(index + 1))];
  }));
}

function sessionSignature(payload) { return createHmac("sha256", sessionSecret).update(payload).digest("hex"); }

function readSession(request) {
  const value = parseCookies(request).get(sessionCookieName), match = String(value || "").match(/^v2\.(\d+)\.([a-f0-9]{64})$/);
  if (!match) return null;
  const expiresAt = Number(match[1]), payload = `v2.${match[1]}`, expected = Buffer.from(sessionSignature(payload), "hex"), actual = Buffer.from(match[2], "hex");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { expiresAt };
}

function isSecureRequest(request) { return String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https"; }

function issueSessionCookie(request) {
  const expiresAt = Date.now() + sessionMaxAgeSeconds * 1000, payload = `v2.${expiresAt}`;
  return `${sessionCookieName}=${payload}.${sessionSignature(payload)}; Path=/; Max-Age=${sessionMaxAgeSeconds}; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; SameSite=Strict${isSecureRequest(request) ? "; Secure" : ""}`;
}

function clearSessionCookie(request) {
  return `${sessionCookieName}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict${isSecureRequest(request) ? "; Secure" : ""}`;
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === request.headers.host; } catch { return false; }
}

function loginClient(request) {
  return String(request.headers["cf-connecting-ip"] || request.socket.remoteAddress || "unknown").slice(0, 80);
}

function recordLoginFailure(client) {
  const now = Date.now(), current = loginFailures.get(client);
  const next = !current || current.resetAt <= now ? { count: 1, resetAt: now + 15 * 60 * 1000 } : { ...current, count: current.count + 1 };
  loginFailures.set(client, next);
  return next;
}

function requireAdmin(request, response) {
  if (!sameOrigin(request)) { json(response, 403, { error: "请求来源不受信任" }); return false; }
  if (!readSession(request)) { json(response, 401, { error: "管理员登录已过期" }, { "Set-Cookie": clearSessionCookie(request) }); return false; }
  return true;
}

async function readBody(request, maximum = 64 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length; if (size > maximum) throw Object.assign(new Error("请求内容过大"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function publicExample(record) {
  return { id: record.id, name: record.name, gridSpec: record.gridSpec, createdAt: record.createdAt, url: `/api/examples/${encodeURIComponent(record.id)}/image` };
}

async function handleAdminSession(request, response) {
  if (request.method === "GET") {
    if (!readSession(request)) return json(response, 200, { authenticated: false }, { "Set-Cookie": clearSessionCookie(request) });
    return json(response, 200, { authenticated: true }, { "Set-Cookie": issueSessionCookie(request) });
  }
  if (request.method === "DELETE") return json(response, 200, { authenticated: false }, { "Set-Cookie": clearSessionCookie(request) });
  if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" }, { Allow: "GET, POST, DELETE" });
  if (!sameOrigin(request)) return json(response, 403, { error: "请求来源不受信任" });
  const client = loginClient(request), attempts = loginFailures.get(client);
  if (attempts?.count >= 8 && attempts.resetAt > Date.now()) {
    return json(response, 429, { error: "密钥尝试次数过多，请稍后再试" }, { "Retry-After": String(Math.ceil((attempts.resetAt - Date.now()) / 1000)) });
  }
  const body = JSON.parse((await readBody(request)).toString("utf8") || "{}");
  const suppliedHash = createHash("sha256").update(String(body.key || "")).digest("hex");
  const expected = Buffer.from(adminKeyHash, "hex"), actual = Buffer.from(suppliedHash, "hex");
  if (expected.length !== 32 || !timingSafeEqual(expected, actual)) {
    recordLoginFailure(client);
    return json(response, 401, { error: "密钥不正确" }, { "Set-Cookie": clearSessionCookie(request) });
  }
  loginFailures.delete(client);
  return json(response, 200, { authenticated: true }, { "Set-Cookie": issueSessionCookie(request) });
}

async function handleImageUpload(request, response) {
  if (!requireAdmin(request, response)) return;
  if (request.headers["content-type"] !== "image/png") return json(response, 415, { error: "只接受识别流程生成的 PNG 图纸" });
  const length = Number(request.headers["content-length"] || 0);
  if (length > maxImageBytes) return json(response, 413, { error: "图纸超过 40MB 限制" });
  const image = await readBody(request, maxImageBytes);
  if (image.length < 8 || !image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return json(response, 415, { error: "PNG 文件格式无效" });
  let name = "示例图纸.png";
  try { name = decodeURIComponent(String(request.headers["x-example-name"] || name)); } catch { /* keep fallback */ }
  name = path.basename(name).replace(/[^\p{L}\p{N}_.()\-\s]/gu, "_").slice(0, 180).replace(/\.[^.]+$/, "") + ".png";
  const gridSpec = String(request.headers["x-grid-spec"] || "");
  if (!/^\d{1,3}x\d{1,3}$/.test(gridSpec)) return json(response, 400, { error: "图纸规格无效" });
  const [cols, rows] = gridSpec.split("x").map(Number);
  if (cols < 8 || cols > 300 || rows < 8 || rows > 300) return json(response, 400, { error: "图纸规格超出范围" });
  const sha256 = createHash("sha256").update(image).digest("hex");
  let record, created = false;
  await mutateGallery(async () => {
    const existing = gallery.examples.find(item => item.sha256 === sha256 && item.gridSpec === gridSpec);
    if (existing) { record = existing; return; }
    const uuid = randomUUID();
    record = { id: `uploaded:${uuid}`, file: `${uuid}.png`, name, gridSpec, createdAt: Date.now(), sha256 };
    const filename = path.join(imageRoot, record.file);
    await writeFile(filename, image, { flag: "wx", mode: 0o640 });
    try { gallery.examples.push(record); gallery.order.push(record.id); await writeGallery(); created = true; }
    catch (error) { await unlink(filename).catch(() => {}); throw error; }
  });
  json(response, created ? 201 : 200, { example: publicExample(record), duplicate: !created }, { "Set-Cookie": issueSessionCookie(request) });
}

async function handleOrderUpdate(request, response) {
  if (!requireAdmin(request, response)) return;
  const body = JSON.parse((await readBody(request, 128 * 1024)).toString("utf8") || "{}");
  const uploadedIds = new Set(gallery.examples.map(item => item.id));
  const order = [...new Set((Array.isArray(body.order) ? body.order : []).filter(id =>
    typeof id === "string" && id.length <= 240 && (id.startsWith("builtin:") || uploadedIds.has(id))
  ))];
  const hiddenBuiltins = [...new Set((Array.isArray(body.hiddenBuiltins) ? body.hiddenBuiltins : []).filter(id =>
    typeof id === "string" && id.startsWith("builtin:") && id.length <= 240
  ))];
  await mutateGallery(async () => { gallery.order = order; gallery.hiddenBuiltins = hiddenBuiltins; await writeGallery(); });
  json(response, 200, { order, hiddenBuiltins }, { "Set-Cookie": issueSessionCookie(request) });
}

async function handleDeleteExample(request, response, id) {
  if (!requireAdmin(request, response)) return;
  let removed;
  await mutateGallery(async () => {
    const index = gallery.examples.findIndex(item => item.id === id);
    if (index < 0) throw Object.assign(new Error("示例图纸不存在"), { status: 404 });
    [removed] = gallery.examples.splice(index, 1);
    gallery.order = gallery.order.filter(item => item !== id);
    await writeGallery();
    await unlink(path.join(imageRoot, removed.file)).catch(error => { if (error.code !== "ENOENT") console.error("Unable to delete example image", error); });
  });
  json(response, 200, { deleted: id }, { "Set-Cookie": issueSessionCookie(request) });
}

async function serveExampleImage(request, response, id) {
  const record = gallery.examples.find(item => item.id === id);
  if (!record) return json(response, 404, { error: "示例图纸不存在" });
  const filename = path.join(imageRoot, record.file), info = await stat(filename);
  response.writeHead(200, { "Content-Type": "image/png", "Content-Length": info.size, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
  if (request.method === "HEAD") return response.end();
  createReadStream(filename).pipe(response);
}

async function handleApi(request, response, url) {
  if (url.pathname === "/api/admin/session") return handleAdminSession(request, response);
  if (url.pathname === "/api/examples" && request.method === "GET") return json(response, 200, {
    examples: gallery.examples.map(publicExample), order: gallery.order, hiddenBuiltins: gallery.hiddenBuiltins
  });
  if (url.pathname === "/api/examples" && request.method === "POST") return handleImageUpload(request, response);
  if (url.pathname === "/api/examples/order" && request.method === "PUT") return handleOrderUpdate(request, response);
  const imageMatch = url.pathname.match(/^\/api\/examples\/([^/]+)\/image$/);
  if (imageMatch && (request.method === "GET" || request.method === "HEAD")) return serveExampleImage(request, response, decodeURIComponent(imageMatch[1]));
  const deleteMatch = url.pathname.match(/^\/api\/examples\/([^/]+)$/);
  if (deleteMatch && request.method === "DELETE") return handleDeleteExample(request, response, decodeURIComponent(deleteMatch[1]));
  return json(response, 404, { error: "API not found" });
}

async function serveStatic(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: "Method not allowed" });
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return json(response, 400, { error: "路径无效" }); }
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (requested === "server.mjs" || requested.startsWith("deploy/") || requested.split(/[\\/]/).some(part => part.startsWith("."))) {
    return json(response, 404, { error: "Not found" });
  }
  const filename = path.resolve(appRoot, requested);
  if (filename !== appRoot && !filename.startsWith(`${appRoot}${path.sep}`)) return json(response, 403, { error: "Forbidden" });
  try {
    const info = await stat(filename); if (!info.isFile()) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
    const extension = path.extname(filename).toLowerCase(), headers = {
      "Content-Type": mimeTypes.get(extension) || "application/octet-stream", "Content-Length": info.size,
      "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=14400", "X-Content-Type-Options": "nosniff"
    };
    response.writeHead(200, headers); if (request.method === "HEAD") return response.end();
    createReadStream(filename).pipe(response);
  } catch (error) {
    if (error.code === "ENOENT") return json(response, 404, { error: "Not found" });
    throw error;
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname.startsWith("/api/")) await handleApi(request, response, url);
    else await serveStatic(request, response, url);
  } catch (error) {
    console.error(error);
    if (!response.headersSent) json(response, error.status || (error instanceof SyntaxError ? 400 : 500), { error: error.message || "服务器错误" });
    else response.destroy();
  }
});

server.listen(port, "127.0.0.1", () => console.log(`perler.cloud listening on 127.0.0.1:${port}`));
