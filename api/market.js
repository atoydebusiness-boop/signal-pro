let memoryCache = null;
let memoryCacheAt = 0;
const CACHE_MS = 55000;
const STALE_MS = 10 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");

  const nowMs = Date.now();
  if (memoryCache && nowMs - memoryCacheAt < CACHE_MS) {
    return res.status(200).json({ ...memoryCache, cached: true, cacheAgeMs: nowMs - memoryCacheAt });
  }

  const symbols = ["EUR/USD","GBP/USD","USD/JPY","AUD/USD","EUR/JPY","GBP/JPY"];
  const lseKey = process.env.LSE_API_KEY;
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const twelveKey = process.env.TWELVE_DATA_API_KEY;
  const diagnostics = [];

  const save = payload => {
    memoryCache = payload;
    memoryCacheAt = Date.now();
    return res.status(200).json(payload);
  };

  const normalizeLseRows = rows => rows
    .map(x => ({
      datetime: String(x.timestamp ?? x.time ?? x.datetime ?? x.date ?? ""),
      open: String(x.open ?? ""), high: String(x.high ?? ""),
      low: String(x.low ?? ""), close: String(x.close ?? "")
    }))
    .filter(x => x.open && x.high && x.low && x.close);

  if (lseKey) {
    try {
      const results = await Promise.all(symbols.map(async pair => {
        const url = new URL("https://api.londonstrategicedge.com/vault/candles");
        url.searchParams.set("symbol", pair);
        url.searchParams.set("timeframe", "1m");
        url.searchParams.set("order", "desc");
        url.searchParams.set("limit", "180");
        const r = await fetch(url, { headers: { "x-api-key": lseKey, Accept: "application/json" } });
        const text = await r.text();
        let body = null; try { body = JSON.parse(text); } catch (_) {}
        if (!r.ok) throw new Error(`${pair}: HTTP ${r.status} ${text.slice(0,120)}`);
        const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.rows) ? body.rows : null;
        if (!rows || rows.length < 30) throw new Error(`${pair}: candles insuficientes (${rows?.length ?? 0})`);
        const values = normalizeLseRows(rows).reverse();
        if (values.length < 30) throw new Error(`${pair}: OHLC inválido`);
        return [pair, { values }];
      }));
      return save({ interval:"1min", symbols, data:Object.fromEntries(results), source:"London Strategic Edge", fetchedAt:Date.now() });
    } catch (e) { diagnostics.push(`LSE: ${e?.message || "falhou"}`); }
  } else diagnostics.push("LSE_API_KEY não configurada");

  if (finnhubKey) {
    try {
      const now = Math.floor(Date.now()/1000), from = now - 60*60*8, data = {};
      for (const pair of symbols) {
        const url = new URL("https://finnhub.io/api/v1/forex/candle");
        url.searchParams.set("symbol", `OANDA:${pair.replace('/', '_')}`);
        url.searchParams.set("resolution", "1"); url.searchParams.set("from", String(from));
        url.searchParams.set("to", String(now)); url.searchParams.set("token", finnhubKey);
        const r = await fetch(url), j = await r.json().catch(()=>null);
        if (!r.ok || j?.s !== "ok" || !Array.isArray(j?.t) || j.t.length < 30) throw new Error(`${pair}: HTTP ${r.status}, status ${j?.s || "?"}`);
        data[pair] = { values:j.t.map((t,i)=>({datetime:new Date(t*1000).toISOString(),open:String(j.o[i]),high:String(j.h[i]),low:String(j.l[i]),close:String(j.c[i])})) };
      }
      return save({ interval:"1min", symbols, data, source:"Finnhub (fallback)", fetchedAt:Date.now() });
    } catch(e) { diagnostics.push(`Finnhub: ${e?.message || "falhou"}`); }
  }

  if (twelveKey) {
    try {
      const url = new URL("https://api.twelvedata.com/time_series");
      url.searchParams.set("symbol", symbols.join(",")); url.searchParams.set("interval", "1min");
      url.searchParams.set("outputsize", "180"); url.searchParams.set("order", "ASC"); url.searchParams.set("apikey", twelveKey);
      const r = await fetch(url), data = await r.json().catch(()=>null);
      if (!r.ok || data?.status === "error") throw new Error(`HTTP ${r.status}: ${data?.message || "erro da API"}`);
      return save({ interval:"1min", symbols, data, source:"Twelve Data (fallback)", fetchedAt:Date.now() });
    } catch(e) { diagnostics.push(`Twelve Data: ${e?.message || "falhou"}`); }
  }

  if (memoryCache && Date.now() - memoryCacheAt < STALE_MS) {
    return res.status(200).json({ ...memoryCache, source:`${memoryCache.source} • reconectando`, stale:true, cacheAgeMs:Date.now()-memoryCacheAt, diagnostics });
  }

  return res.status(502).json({ error:"Nenhuma fonte conseguiu fornecer Forex M1.", diagnostics });
}
