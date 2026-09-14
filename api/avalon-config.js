export default function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const clientId=process.env.AVALON_CLIENT_ID||'';
  const authorizationUrl=process.env.AVALON_AUTHORIZATION_URL||'';
  const redirectUri=process.env.AVALON_REDIRECT_URI||'https://obsignalpro.vercel.app/avalon/callback';
  const scope=process.env.AVALON_SCOPE||'full offline_access';
  res.status(200).json({
    ready:Boolean(clientId&&authorizationUrl),
    clientId,
    authorizationUrl,
    redirectUri,
    scope
  });
}
