// Diagnóstico experimental do feed OTC da Quotex em ambiente serverless.
// Não executa ordens e não expõe a sessão ao navegador.

const DEFAULT_ASSETS = ['EURUSD_otc','GBPUSD_otc','USDJPY_otc','AUDUSD_otc'];
const WS_URLS = [
  'wss://ws2.qxbroker.com/socket.io/?EIO=3&transport=websocket',
  'wss://quotex.io/socket.io/?EIO=4&transport=websocket'
];

function safeSession(raw){
  if(!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return raw; }
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  const configured = Boolean(process.env.QUOTEX_SESSION);
  const requested = String(req.query?.assets || '').split(',').map(x=>x.trim()).filter(Boolean);
  const assets = requested.length ? requested.slice(0,10) : DEFAULT_ASSETS;

  // Esta primeira rota é propositalmente de diagnóstico. Vercel Functions não oferecem
  // uma conexão WebSocket persistente; antes de gerar sinais precisamos confirmar que
  // uma conexão curta consegue autenticar e receber histórico/candles na infraestrutura.
  if(!configured){
    return res.status(503).json({
      ok:false,
      mode:'quotex_otc',
      stage:'configuration',
      error:'QUOTEX_SESSION_NOT_CONFIGURED',
      message:'Configure QUOTEX_SESSION nas variáveis de ambiente da Vercel. Não coloque a sessão no frontend.',
      assets,
      candidates:WS_URLS
    });
  }

  // Nunca devolvemos o valor da sessão. Apenas confirmamos que a variável existe.
  const session = safeSession(process.env.QUOTEX_SESSION);
  const sessionShape = typeof session === 'object' && session ? Object.keys(session).slice(0,8) : ['opaque'];

  return res.status(200).json({
    ok:true,
    mode:'quotex_otc',
    stage:'configured',
    sessionConfigured:true,
    sessionShape,
    assets,
    candidates:WS_URLS,
    next:'websocket_probe',
    warning:'Diagnóstico somente. Nenhum sinal OTC é liberado até validar candles reais da Quotex.'
  });
}
