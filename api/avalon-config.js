export default function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const clientId=process.env.AVALON_CLIENT_ID||'';
  const apiBaseUrl=process.env.AVALON_API_BASE_URL||'https://api.trade.avalonbroker.com';
  const wsUrl=process.env.AVALON_WS_URL||'wss://ws.trade.avalonbroker.com/echo/websocket';
  const tradeHost=process.env.AVALON_TRADE_HOST||'https://trade.avalonbroker.com';
  const redirectUri=process.env.AVALON_REDIRECT_URI||'https://obsignalpro.vercel.app/avalon/callback';
  const scope=process.env.AVALON_SCOPE||'full offline_access';
  res.status(200).json({ready:Boolean(clientId),clientId,apiBaseUrl,wsUrl,tradeHost,redirectUri,scope});
}
