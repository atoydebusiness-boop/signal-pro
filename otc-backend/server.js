'use strict';

const http = require('http');
const crypto = require('crypto');
const { analyze, rank } = require('./signal-engine');

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.OTC_INGEST_SECRET || '';
const MAX_CANDLES = 250;
const store = new Map();

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': process.env.CORS_ORIGIN || '*',
    'access-control-allow-headers': 'content-type,x-signal-pro-secret',
    'access-control-allow-methods': 'GET,POST,OPTIONS'
  });
  res.end(JSON.stringify(body));
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a || ''));
  const B = Buffer.from(String(b || ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

function normalizeAsset(v) {
  return String(v || '').trim().toUpperCase().replace('/', '').replace(/_?OTC$/, '_OTC');
}

function normalizeCandle(raw) {
  const c = {
    time: Number(raw?.time), open: Number(raw?.open), high: Number(raw?.high),
    low: Number(raw?.low), close: Number(raw?.close)
  };
  if (!Object.values(c).every(Number.isFinite)) return null;
  if (!(c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close))) return null;
  if (c.time > 1e12) c.time = Math.floor(c.time / 1000);
  c.time = Math.floor(c.time / 60) * 60;
  return c;
}

function isClosed(candleTime) {
  const currentMinute = Math.floor(Date.now() / 1000 / 60) * 60;
  return candleTime < currentMinute;
}

function putCandle(asset, candle) {
  const list = store.get(asset) || [];
  const map = new Map(list.map(c => [c.time, c]));
  map.set(candle.time, candle);
  store.set(asset, [...map.values()].sort((a,b) => a.time-b.time).slice(-MAX_CANDLES));
}

function snapshot() {
  const signals = [];
  for (const [asset, candles] of store.entries()) {
    const s = analyze(asset, candles);
    if (s) signals.push(s);
  }
  const ranked = rank(signals);
  return {
    generatedAt: new Date().toISOString(),
    assets: store.size,
    ready: [...store.values()].filter(x => x.length >= 60).length,
    best: ranked[0] || null,
    signals: signals.sort((a,b) => {
      const av = a.direction !== 'WAIT', bv = b.direction !== 'WAIT';
      if (av !== bv) return Number(bv) - Number(av);
      return b.strength-a.strength || a.opposition-b.opposition || b.adx-a.adx;
    })
  };
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 2_000_000) throw new Error('payload_too_large');
  }
  return JSON.parse(raw || '{}');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, mode: 'read-only-market-data', assets: store.size, uptime: Math.floor(process.uptime()) });
  }

  if (req.method === 'GET' && url.pathname === '/signals') return json(res, 200, snapshot());

  if (req.method === 'POST' && url.pathname === '/candles') {
    if (!SECRET) return json(res, 503, { error: 'OTC_INGEST_SECRET_not_configured' });
    if (!safeEqual(req.headers['x-signal-pro-secret'], SECRET)) return json(res, 401, { error: 'unauthorized' });
    try {
      const body = await readBody(req);
      const asset = normalizeAsset(body.asset);
      if (!asset.endsWith('_OTC')) return json(res, 400, { error: 'invalid_otc_asset' });
      const input = Array.isArray(body.candles) ? body.candles : [body.candle].filter(Boolean);
      let accepted = 0, rejectedOpen = 0;
      for (const raw of input) {
        const candle = normalizeCandle(raw);
        if (!candle) continue;
        if (!isClosed(candle.time)) { rejectedOpen++; continue; }
        putCandle(asset, candle); accepted++;
      }
      return json(res, 200, { ok: true, asset, accepted, rejectedOpen, stored: (store.get(asset) || []).length });
    } catch (e) {
      return json(res, e.message === 'payload_too_large' ? 413 : 400, { error: e.message || 'bad_request' });
    }
  }

  return json(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => console.log(`Signal Pro OTC backend listening on :${PORT}`));
