export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.setHeader("CDN-Cache-Control", "public, s-maxage=55, stale-while-revalidate=300");
  res.setHeader("Vercel-CDN-Cache-Control", "public, s-maxage=55, stale-while-revalidate=300");
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return res.status(500).json({error:"TWELVE_DATA_API_KEY não configurada."});

  const allowed = ["EUR/USD","GBP/USD","USD/JPY","AUD/USD","EUR/JPY","GBP/JPY"];
  const interval = req.query.interval === "5min" ? "5min" : "1min";

  try {
    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", allowed.join(","));
    url.searchParams.set("interval", interval);
    url.searchParams.set("outputsize", "120");
    url.searchParams.set("order", "ASC");
    url.searchParams.set("apikey", key);

    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok || data.status === "error") {
      return res.status(502).json({error:data.message || "Falha na fonte de mercado"});
    }
    return res.status(200).json({interval, symbols:allowed, data, fetchedAt:Date.now()});
  } catch(e) {
    return res.status(500).json({error:"Erro interno ao consultar mercado."});
  }
}
