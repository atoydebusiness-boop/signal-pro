import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

const token = "test-user-token";
const userId = "11111111-1111-4111-8111-111111111111";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function waitFor(url) {
  for (let index = 0; index < 50; index += 1) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Servidor não iniciou: ${url}`);
}

test("auth, pairing, relay and demo order guard", async () => {
  const mock = http.createServer((req, res) => {
    if (req.url === "/auth/v1/user" && req.headers.authorization === `Bearer ${token}`) {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id: userId, email: "demo@example.test" }));
      return;
    }
    if (req.url === "/market") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, source: "mock" }));
      return;
    }
    res.writeHead(401).end();
  });
  const mockPort = await listen(mock);
  const appPort = 18_000 + Math.floor(Math.random() * 2_000);
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "signal-pro-test-"));
  const child = spawn(process.execPath, ["server/server.mjs"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      PORT: String(appPort),
      DATA_DIR: dataDir,
      SUPABASE_URL: `http://127.0.0.1:${mockPort}`,
      SUPABASE_PUBLISHABLE_KEY: "public-test-key",
      MARKET_UPSTREAM: `http://127.0.0.1:${mockPort}/market`,
      DEMO_TRADING_ENABLED: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://127.0.0.1:${appPort}`;
  const userHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  try {
    await waitFor(`${base}/api/health`);
    assert.equal((await fetch(`${base}/api/market`)).status, 401);
    assert.equal((await fetch(`${base}/api/market`, { headers: userHeaders })).status, 200);

    const pairResponse = await fetch(`${base}/api/mt5/pair-code`, { method: "POST", headers: userHeaders, body: "{}" });
    assert.equal(pairResponse.status, 201);
    const { code } = await pairResponse.json();
    assert.match(code, /^\d{8}$/);

    const paired = await fetch(`${base}/api/mt5/agent/pair`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, deviceName: "test-agent" }) });
    assert.equal(paired.status, 201);
    const { agentToken } = await paired.json();
    const agentHeaders = { Authorization: `Bearer ${agentToken}`, "Content-Type": "application/json" };

    const poll = fetch(`${base}/api/mt5/agent/poll`, { method: "POST", headers: agentHeaders });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const health = fetch(`${base}/api/mt5/health`, { headers: userHeaders });
    const pollResponse = await poll;
    const command = (await pollResponse.json()).command;
    assert.equal(command.route, "health");
    assert.equal(command.payload.password, undefined);
    const result = await fetch(`${base}/api/mt5/agent/result`, { method: "POST", headers: agentHeaders, body: JSON.stringify({ id: command.id, status: 200, body: { ok: true, mt5_connected: false } }) });
    assert.equal(result.status, 202);
    assert.deepEqual(await (await health).json(), { ok: true, mt5_connected: false });

    const blocked = await fetch(`${base}/api/mt5/order/send`, { method: "POST", headers: userHeaders, body: JSON.stringify({ confirm: true }) });
    assert.equal(blocked.status, 403);

    const saved = JSON.parse(await readFile(path.join(dataDir, "agent-pairings.json"), "utf8"));
    assert.notEqual(saved.devices[userId].tokenHash, agentToken);
    assert.equal(JSON.stringify(saved).includes("password"), false);
  } finally {
    child.kill("SIGTERM");
    mock.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
