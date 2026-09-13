import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 8780);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR || "/data";
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "";
const MARKET_UPSTREAM = process.env.MARKET_UPSTREAM || "https://obsignalpro.vercel.app/api/market";
const DEMO_TRADING_ENABLED = process.env.DEMO_TRADING_ENABLED === "true";
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const STATE_FILE = path.join(DATA_DIR, "agent-pairings.json");
const MAX_BODY = 128 * 1024;
const PAIR_TTL_MS = 5 * 60 * 1000;
const AGENT_ONLINE_MS = 60 * 1000;

const state = { devices: {} };
const pairCodes = new Map();
const queues = new Map();
const waiters = new Map();
const pending = new Map();
const authCache = new Map();
const rate = new Map();

function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' https://esm.sh; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}

function send(res, status, body, headers = {}) {
  securityHeaders(res);
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  if (body === null) return res.writeHead(status).end();
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  if (!res.hasHeader("Content-Type")) res.setHeader("Content-Type", typeof body === "object" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(data));
  res.writeHead(status).end(data);
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function limited(key, max, windowMs) {
  const now = Date.now();
  const item = rate.get(key);
  if (!item || now >= item.resetAt) {
    rate.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  item.count += 1;
  return item.count > max;
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error("Payload muito grande"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("JSON inválido"), { status: 400 }); }
}

function bearer(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function requireUser(req) {
  const token = bearer(req);
  if (!token || !SUPABASE_URL || !SUPABASE_KEY) throw Object.assign(new Error("Não autorizado"), { status: 401 });
  const key = crypto.createHash("sha256").update(token).digest("hex");
  const cached = authCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.user;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, signal: controller.signal });
  } finally { clearTimeout(timer); }
  if (!response.ok) throw Object.assign(new Error("Sessão inválida ou expirada"), { status: 401 });
  const user = await response.json();
  if (!user?.id) throw Object.assign(new Error("Sessão inválida"), { status: 401 });
  authCache.set(key, { user: { id: user.id, email: user.email || null }, expiresAt: Date.now() + 30_000 });
  return { id: user.id, email: user.email || null };
}

async function loadState() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const saved = JSON.parse(await readFile(STATE_FILE, "utf8"));
    if (saved && typeof saved.devices === "object") state.devices = saved.devices;
  } catch (error) {
    if (error.code !== "ENOENT") console.error("state_load_failed", error.message);
  }
}

async function persistState() {
  const temp = `${STATE_FILE}.tmp`;
  await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, STATE_FILE);
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function findAgent(req) {
  const token = bearer(req);
  if (!token) return null;
  const hash = tokenHash(token);
  for (const [userId, device] of Object.entries(state.devices)) {
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(String(device.tokenHash || ""), "hex");
    if (a.length === b.length && a.length && crypto.timingSafeEqual(a, b)) return { userId, device };
  }
  return null;
}

function prune() {
  const now = Date.now();
  for (const [code, item] of pairCodes) if (item.expiresAt <= now) pairCodes.delete(code);
  for (const [key, item] of authCache) if (item.expiresAt <= now) authCache.delete(key);
  for (const [key, item] of rate) if (item.resetAt <= now) rate.delete(key);
}

function queueFor(userId) {
  if (!queues.has(userId)) queues.set(userId, []);
  return queues.get(userId);
}

function dispatch(userId, command) {
  const waiter = waiters.get(userId);
  if (waiter) {
    waiters.delete(userId);
    clearTimeout(waiter.timer);
    return waiter.resolve(command);
  }
  const queue = queueFor(userId);
  if (queue.length >= 20) throw Object.assign(new Error("Fila do conector cheia"), { status: 503 });
  queue.push(command);
}

async function rpc(userId, route, method, query, payload) {
  const device = state.devices[userId];
  if (!device || Date.now() - Number(device.lastSeen || 0) > AGENT_ONLINE_MS) throw Object.assign(new Error("Signal Pro Connector está offline"), { status: 503 });
  const id = crypto.randomUUID();
  const command = { id, route, method, query, payload, createdAt: new Date().toISOString() };
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error("O conector não respondeu a tempo"), { status: 504 }));
    }, 40_000);
    pending.set(id, { userId, resolve, reject, timer });
    try { dispatch(userId, command); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}

async function proxyMarket(req, res) {
  await requireUser(req);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  let upstream;
  try {
    upstream = await fetch(MARKET_UPSTREAM, { headers: { Authorization: req.headers.authorization, Accept: "application/json", "User-Agent": "SignalPro-VPS/1.0" }, signal: controller.signal });
  } finally { clearTimeout(timer); }
  const data = Buffer.from(await upstream.arrayBuffer());
  return send(res, upstream.status, data, { "Content-Type": upstream.headers.get("content-type") || "application/json", "Cache-Control": "private, no-store", "X-Signal-Pro-Upstream": "vercel-market" });
}

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8" };
async function staticFile(urlPath, res) {
  const target = urlPath === "/" ? "/index.html" : urlPath;
  const normalized = path.normalize(decodeURIComponent(target)).replace(/^(\.\.(\/|\\|$))+/, "");
  const file = path.resolve(PUBLIC_DIR, `.${normalized}`);
  if (!file.startsWith(`${PUBLIC_DIR}${path.sep}`)) return false;
  try {
    const data = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    send(res, 200, data, { "Content-Type": mime[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600" });
    return true;
  } catch (error) { return error.code === "ENOENT" ? false : Promise.reject(error); }
}

const mt5Routes = new Set(["health", "broker-hint", "connect", "disconnect", "symbols", "candles", "positions", "risk/lot", "order/check", "order/send"]);

async function handle(req, res) {
  const url = new URL(req.url, "http://signal-pro.local");
  const method = req.method || "GET";
  if (url.pathname === "/api/health" && method === "GET") return send(res, 200, { ok: true, service: "signal-pro", mt5Bridge: true, demoTradingEnabled: DEMO_TRADING_ENABLED, dependencies: { auth: "supabase-cloud", market: "vercel-upstream" }, now: new Date().toISOString() }, { "Cache-Control": "no-store" });
  if (url.pathname === "/api/auth-config" && method === "GET") {
    if (!SUPABASE_URL || !SUPABASE_KEY) return send(res, 503, { error: "Autenticação não configurada" });
    return send(res, 200, { url: SUPABASE_URL, key: SUPABASE_KEY }, { "Cache-Control": "public, max-age=300" });
  }
  if (url.pathname === "/api/market" && method === "GET") return proxyMarket(req, res);

  if (url.pathname === "/api/mt5/pair-code" && method === "POST") {
    const user = await requireUser(req);
    if (limited(`pair:${user.id}:${clientIp(req)}`, 5, 10 * 60_000)) throw Object.assign(new Error("Muitas tentativas de pareamento"), { status: 429 });
    for (const [code, item] of pairCodes) if (item.userId === user.id) pairCodes.delete(code);
    let code;
    do { code = String(crypto.randomInt(10_000_000, 100_000_000)); } while (pairCodes.has(code));
    pairCodes.set(code, { userId: user.id, expiresAt: Date.now() + PAIR_TTL_MS });
    return send(res, 201, { ok: true, code, expiresIn: 300 });
  }

  if (url.pathname === "/api/mt5/agent/pair" && method === "POST") {
    if (limited(`agent-pair:${clientIp(req)}`, 10, 10 * 60_000)) throw Object.assign(new Error("Muitas tentativas"), { status: 429 });
    const body = await bodyJson(req);
    const code = String(body.code || "").trim();
    const item = pairCodes.get(code);
    if (!item || item.expiresAt <= Date.now()) throw Object.assign(new Error("Código inválido ou expirado"), { status: 401 });
    pairCodes.delete(code);
    const token = crypto.randomBytes(48).toString("base64url");
    state.devices[item.userId] = { tokenHash: tokenHash(token), name: String(body.deviceName || "MT5 Windows").slice(0, 80), pairedAt: Date.now(), lastSeen: Date.now() };
    await persistState();
    return send(res, 201, { ok: true, agentToken: token });
  }

  if (url.pathname === "/api/mt5/agent/poll" && method === "POST") {
    const agent = findAgent(req);
    if (!agent) throw Object.assign(new Error("Agente não autorizado"), { status: 401 });
    agent.device.lastSeen = Date.now();
    const queue = queueFor(agent.userId);
    if (queue.length) return send(res, 200, { ok: true, command: queue.shift() }, { "Cache-Control": "no-store" });
    if (waiters.has(agent.userId)) {
      const old = waiters.get(agent.userId); clearTimeout(old.timer); old.resolve(null); waiters.delete(agent.userId);
    }
    const command = await new Promise(resolve => {
      const timer = setTimeout(() => { waiters.delete(agent.userId); resolve(null); }, 25_000);
      waiters.set(agent.userId, { resolve, timer });
    });
    return command ? send(res, 200, { ok: true, command }, { "Cache-Control": "no-store" }) : send(res, 204, null, { "Cache-Control": "no-store" });
  }

  if (url.pathname === "/api/mt5/agent/result" && method === "POST") {
    const agent = findAgent(req);
    if (!agent) throw Object.assign(new Error("Agente não autorizado"), { status: 401 });
    agent.device.lastSeen = Date.now();
    const body = await bodyJson(req);
    const job = pending.get(String(body.id || ""));
    if (!job || job.userId !== agent.userId) throw Object.assign(new Error("Comando não encontrado"), { status: 404 });
    clearTimeout(job.timer); pending.delete(body.id);
    job.resolve({ status: Number(body.status || 200), body: body.body ?? { ok: false, error: "Resposta vazia" } });
    return send(res, 202, { ok: true });
  }

  if (url.pathname === "/api/mt5/status" && method === "GET") {
    const user = await requireUser(req);
    const device = state.devices[user.id];
    return send(res, 200, { ok: true, paired: Boolean(device), agentOnline: Boolean(device && Date.now() - Number(device.lastSeen || 0) <= AGENT_ONLINE_MS), device: device ? { name: device.name, pairedAt: device.pairedAt, lastSeen: device.lastSeen } : null, demoTradingEnabled: DEMO_TRADING_ENABLED }, { "Cache-Control": "no-store" });
  }

  if (url.pathname.startsWith("/api/mt5/")) {
    const route = url.pathname.slice("/api/mt5/".length);
    if (!mt5Routes.has(route)) return send(res, 404, { ok: false, error: "Endpoint MT5 inexistente" });
    const expectedMethod = ["connect", "disconnect", "risk/lot", "order/check", "order/send"].includes(route) ? "POST" : "GET";
    if (method !== expectedMethod) return send(res, 405, { ok: false, error: "Método não permitido" }, { Allow: expectedMethod });
    const user = await requireUser(req);
    const payload = method === "POST" ? await bodyJson(req) : {};
    if (route === "order/send" && !DEMO_TRADING_ENABLED) return send(res, 403, { ok: false, error: "Execução de ordens está OFF no servidor" });
    if (route === "order/send" && payload.confirm !== true) return send(res, 400, { ok: false, error: "Confirmação explícita ausente" });
    const result = await rpc(user.id, route, method, Object.fromEntries(url.searchParams), payload);
    return send(res, result.status, result.body, { "Cache-Control": "no-store" });
  }

  if (method === "GET" || method === "HEAD") {
    if (await staticFile(url.pathname, res)) return;
  }
  return send(res, 404, { error: "Não encontrado" });
}

await loadState();
setInterval(prune, 60_000).unref();
const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    const status = Number(error.status || (error.name === "AbortError" ? 504 : 500));
    if (status >= 500) console.error("request_failed", req.method, req.url, error.message);
    if (!res.headersSent) send(res, status, { ok: false, error: status >= 500 ? "Falha temporária no serviço" : error.message });
    else res.destroy();
  });
});
server.requestTimeout = 50_000;
server.headersTimeout = 55_000;
server.listen(PORT, HOST, () => console.log(`signal-pro listening on ${HOST}:${PORT}`));

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
