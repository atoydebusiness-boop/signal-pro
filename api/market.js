export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.setHeader("CDN-Cache-Control", "public, s-maxage=58, stale-while-revalidate=300");
  res.setHeader("Vercel-CDN-Cache-Control", "public, s-maxage=58, stale-while-revalidate=300");

  const symbols = ["EUR/USD","GBP/USD","USD/JPY","AUD/USD","EUR/JPY","GBP/JPY"];
  const lseKey = process.env.LSE_API_KEY;
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const twelveKey = process.env.TWELVE_DATA_API_KEY;

  // Principal: London Strategic Edge. Endpoint e autenticação seguem o SDK oficial.
  if (lseKey) {
    try {
      const results = await Promise.all(symbols.map(async pair => {
        const url = new URL("https://api.londonstrategicedge.com/vault/candles");
        url.searchParams.set("symbol", pair);
        url.searchParams.set("timeframe", "1m");
        url.searchParams.set("order", "asc");
        url.searchParams.set("limit", "180");
        const r = await fetch(url, { headers: {
          "x-api-key": lseKey,
          "User-Agent": "signal-pro (+https://obsignalpro.vercel.app)"
        }});
        const rows = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(rows) || rows.length < 30) throw new Error(`LSE ${pair} HTTP ${r.status}`);
        return [pair, { values: rows.map(x => ({
          datetime: String(x.timestamp || x.time || x.datetime || ""),
          open: String(x.open), high: String(x.high), low: String(x.low), close: String(x.close)
        })) }];
      }));
      const data = Object.fromEntries(results);
      return res.status(200).json({ interval:"1min", symbols, data, source:"London Strategic Edge", fetchedAt:Date.now() });
    } catch (_) {}
  }

  // Fallback 1: Finnhub.
  if (finnhubKey) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const from = now - 60 * 60 * 8;
      const data = {};
      let ok = true;
      for (const pair of symbols) {
        const symbol = `OANDA:${pair.replace('/', '_')}`;
        const url = new URL("https://finnhub.io/api/v1/forex/candle");
        url.searchParams.set("symbol", symbol);
        url.searchParams.set("resolution", "1");
        url.searchParams.set("from", String(from));
        url.searchParams.set("to", String(now));
        url.searchParams.set("token", finnhubKey);
        const r = await fetch(url);
        const j = await r.json();
        if (!r.ok || j.s !== "ok" || !Array.isArray(j.t) || j.t.length < 30) { ok = false; break; }
        data[pair] = { values: j.t.map((t,i)=>({ datetime:new Date(t*1000).toISOString(), open:String(j.o[i]), high:String(j.h[i]), low:String(j.l[i]), close:String(j.c[i]) })) };
      }
      if (ok) return res.status(200).json({ interval:"1min", symbols, data, source:"Finnhub (fallback)", fetchedAt:Date.now() });
    } catch (_) {}
  }

  // Fallback 2: Twelve Data.
  if (twelveKey) {
    try {
      const url = new URL("https://api.twelvedata.com/time_series");
      url.searchParams.set("symbol", symbols.join(","));
      url.searchParams.set("interval", "1min");
      url.searchParams.set("outputsize", "180");
      url.searchParams.set("order", "ASC");
      url.searchParams.set("apikey", twelveKey);
      const r = await fetch(url);
      const data = await r.json();
      if (r.ok && data.status !== "error") return res.status(200).json({ interval:"1min", symbols, data, source:"Twelve Data (fallback)", fetchedAt:Date.now() });
    } catch (_) {}
  }

  return res.status(502).json({
    error:"Nenhuma fonte conseguiu fornecer Forex M1 nesta conta.",
    lseConfigured:!!lseKey,
    finnhubConfigured:!!finnhubKey,
    twelveConfigured:!!twelveKey
  });
}
