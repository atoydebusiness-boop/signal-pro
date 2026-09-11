export default async function handler(req, res) {
  // Uma única URL/cache para todo o site. M5 é montado no navegador a partir do M1.
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.setHeader("CDN-Cache-Control", "public, s-maxage=58, stale-while-revalidate=300");
  res.setHeader("Vercel-CDN-Cache-Control", "public, s-maxage=58, stale-while-revalidate=300");

  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return res.status(500).json({ error: "TWELVE_DATA_API_KEY não configurada." });

  const symbols = ["EUR/USD","GBP/USD","USD/JPY","AUD/USD","EUR/JPY","GBP/JPY"];
  try {
    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", symbols.join(","));
    url.searchParams.set("interval", "1min");
    url.searchParams.set("outputsize", "300");
    url.searchParams.set("order", "ASC");
    url.searchParams.set("apikey", key);

    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok || data.status === "error") {
      return res.status(502).json({ error: data.message || "Fonte de mercado temporariamente indisponível." });
    }
    return res.status(200).json({ interval: "1min", symbols, data, fetchedAt: Date.now() });
  } catch (e) {
    return res.status(500).json({ error: "Erro interno ao consultar o mercado." });
  }
}
