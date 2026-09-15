let memoryCache = null;
let memoryCacheAt = 0;
const CACHE_MS = 5000;
const MAX_CANDLE_AGE_MS = 4 * 60 * 1000;

function parseCandleTime(value) {
  if (!value) return NaN;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) { const n = Number(s); return n < 1e12 ? n * 1000 : n; }
  let t = Date.parse(s);
  if (!Number.isNaN(t)) return t;
  return Date.parse(s.replace(" ", "T") + "Z");
}

function newestCandleMs(data, symbols) {
  const times = [];
  for (const pair of symbols) {
    const values = data?.[pair]?.values;
    if (!Array.isArray(values) || !values.length) continue;
    const t = parseCandleTime(values[values.length - 1]?.datetime);
    if (Number.isFinite(t)) times.push(t);
  }
  return times.length ? Math.max(...times) : NaN;
}

function validateFresh(data, symbols) {
  const latest = newestCandleMs(data, symbols);
  if (!Number.isFinite(latest)) throw new Error("timestamp da última vela inválido");
  const age = Date.now() - latest;
  if (age > MAX_CANDLE_AGE_MS) {
    const e = new Error(`mercado sem vela nova há ${Math.round(age/60000)} min`);
    e.code = "MARKET_CLOSED";
    e.latestCandleAt = new Date(latest).toISOString();
    throw e;
  }
  return new Date(latest).toISOString();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  const nowMs = Date.now();
  if (memoryCache && nowMs - memoryCacheAt < CACHE_MS) {
    const latest = newestCandleMs(memoryCache.data, memoryCache.symbols || []);
    if (Number.isFinite(latest) && nowMs - latest <= MAX_CANDLE_AGE_MS)
      return res.status(200).json({ ...memoryCache, cached:true, cacheAgeMs:nowMs-memoryCacheAt });
    memoryCache = null; memoryCacheAt = 0;
  }

  const symbols = ["EUR/USD","GBP/USD","USD/JPY","AUD/USD","EUR/JPY","GBP/JPY"];
  const lseKey = process.env.LSE_API_KEY;
  const finnhubKey = process.env.FINNHUB_API_KEY;
  const twelveKey = process.env.TWELVE_DATA_API_KEY;
  const diagnostics = [];
  let marketClosed = null;

  const save = payload => {
    const latestCandleAt = validateFresh(payload.data, symbols);
    payload = { ...payload, market:"forex", marketOpen:true, latestCandleAt };
    memoryCache = payload; memoryCacheAt = Date.now();
    return res.status(200).json(payload);
  };

  const normalizeLseRows = rows => rows.map(x=>({
    datetime:String(x.timestamp??x.time??x.datetime??x.date??""),
    open:String(x.open??""),high:String(x.high??""),low:String(x.low??""),close:String(x.close??"")
  })).filter(x=>x.open&&x.high&&x.low&&x.close);

  if (lseKey) {
    try {
      const results = await Promise.all(symbols.map(async pair=>{
        const url = new URL("https://api.londonstrategicedge.com/vault/candles");
        url.searchParams.set("symbol",pair); url.searchParams.set("timeframe","1m");
        url.searchParams.set("order","desc"); url.searchParams.set("limit","180");
        const r=await fetch(url,{headers:{"x-api-key":lseKey,Accept:"application/json"}});
        const text=await r.text(); let body=null; try{body=JSON.parse(text)}catch(_){}
        if(!r.ok) throw new Error(`${pair}: HTTP ${r.status} ${text.slice(0,120)}`);
        const rows=Array.isArray(body)?body:Array.isArray(body?.data)?body.data:Array.isArray(body?.rows)?body.rows:null;
        if(!rows||rows.length<30) throw new Error(`${pair}: candles insuficientes (${rows?.length??0})`);
        const values=normalizeLseRows(rows).reverse(); if(values.length<30) throw new Error(`${pair}: OHLC inválido`);
        return [pair,{values}];
      }));
      return save({interval:"1min",symbols,data:Object.fromEntries(results),source:"London Strategic Edge",fetchedAt:Date.now()});
    } catch(e) { if(e?.code==="MARKET_CLOSED") marketClosed=e; diagnostics.push(`LSE: ${e?.message||"falhou"}`); }
  } else diagnostics.push("LSE_API_KEY não configurada");

  if (finnhubKey) {
    try {
      const now=Math.floor(Date.now()/1000),from=now-60*60*8,data={};
      for(const pair of symbols){
        const url=new URL("https://finnhub.io/api/v1/forex/candle");
        url.searchParams.set("symbol",`OANDA:${pair.replace('/','_')}`); url.searchParams.set("resolution","1");
        url.searchParams.set("from",String(from)); url.searchParams.set("to",String(now)); url.searchParams.set("token",finnhubKey);
        const r=await fetch(url),j=await r.json().catch(()=>null);
        if(!r.ok||j?.s!=="ok"||!Array.isArray(j?.t)||j.t.length<30) throw new Error(`${pair}: HTTP ${r.status}, status ${j?.s||"?"}`);
        data[pair]={values:j.t.map((t,i)=>({datetime:new Date(t*1000).toISOString(),open:String(j.o[i]),high:String(j.h[i]),low:String(j.l[i]),close:String(j.c[i])}))};
      }
      return save({interval:"1min",symbols,data,source:"Finnhub (fallback)",fetchedAt:Date.now()});
    } catch(e) { if(e?.code==="MARKET_CLOSED") marketClosed=e; diagnostics.push(`Finnhub: ${e?.message||"falhou"}`); }
  }

  if (twelveKey) {
    try {
      const url=new URL("https://api.twelvedata.com/time_series");
      url.searchParams.set("symbol",symbols.join(",")); url.searchParams.set("interval","1min");
      url.searchParams.set("outputsize","180"); url.searchParams.set("order","ASC"); url.searchParams.set("apikey",twelveKey);
      const r=await fetch(url),raw=await r.json().catch(()=>null);
      if(!r.ok||raw?.status==="error") throw new Error(`HTTP ${r.status}: ${raw?.message||"erro da API"}`);
      const data={};
      for(const pair of symbols){const block=raw?.[pair]||raw; if(Array.isArray(block?.values)) data[pair]={values:block.values};}
      if(Object.keys(data).length!==symbols.length) throw new Error("resposta incompleta");
      return save({interval:"1min",symbols,data,source:"Twelve Data (fallback)",fetchedAt:Date.now()});
    } catch(e) { if(e?.code==="MARKET_CLOSED") marketClosed=e; diagnostics.push(`Twelve Data: ${e?.message||"falhou"}`); }
  }

  if (marketClosed) return res.status(409).json({
    error:"FOREX_FECHADO", market:"forex", marketOpen:false,
    message:"Forex sem vela M1 nova. Sinais Forex foram bloqueados para não reutilizar candles antigos.",
    latestCandleAt:marketClosed.latestCandleAt||null, diagnostics
  });

  return res.status(502).json({error:"Nenhuma fonte conseguiu fornecer Forex M1.",market:"forex",marketOpen:false,diagnostics});
}
