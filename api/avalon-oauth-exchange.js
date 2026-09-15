import { OAuthMethod } from '@quadcode-tech/client-sdk-js';

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  const clientId=process.env.AVALON_CLIENT_ID||'';
  const clientSecret=process.env.AVALON_CLIENT_SECRET||'';
  const apiBaseUrl=process.env.AVALON_API_BASE_URL||'https://api.trade.avalonbroker.com';
  const redirectUri=process.env.AVALON_REDIRECT_URI||'https://obsignalpro.vercel.app/avalon/callback';
  const scope=process.env.AVALON_SCOPE||'full offline_access';
  if(!clientId||!clientSecret) return res.status(503).json({error:'AVALON_NOT_CONFIGURED'});
  const {code,codeVerifier}=req.body||{};
  if(!code||!codeVerifier) return res.status(400).json({error:'MISSING_OAUTH_CODE'});
  try{
    const oauth=new OAuthMethod({apiBaseUrl,clientId:Number(clientId),clientSecret,redirectUri,scope});
    const token=await oauth.issueAccessTokenWithAuthCode(code,codeVerifier);
    const accessToken=token?.accessToken||'';
    if(!accessToken) throw new Error('Avalon não retornou access token');
    // O client secret nunca é enviado ao navegador. O refresh token também fica fora da resposta.
    // Persistência de refresh token por usuário será adicionada no backend antes de habilitar conexão permanente.
    return res.status(200).json({ok:true,accessToken,expiresIn:token?.expiresIn||null});
  }catch(e){
    console.error('Avalon OAuth exchange:',e);
    return res.status(502).json({error:'AVALON_OAUTH_EXCHANGE_FAILED',message:e?.message||'Falha ao trocar código OAuth'});
  }
}
