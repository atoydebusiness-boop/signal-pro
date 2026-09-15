module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') return res.status(405).json({ error: 'METHOD_NOT_ALLOWED', message: 'Método não permitido.' });
  try {
    var clientId = process.env.AVALON_CLIENT_ID || '';
    var clientSecret = process.env.AVALON_CLIENT_SECRET || '';
    var apiBaseUrl = (process.env.AVALON_API_BASE_URL || 'https://api.trade.avalonbroker.com').replace(/\/$/, '');
    var redirectUri = process.env.AVALON_REDIRECT_URI || 'https://obsignalpro.vercel.app/avalon/callback';
    if (!clientId || !clientSecret) return res.status(503).json({ error: 'AVALON_NOT_CONFIGURED', message: 'As credenciais Avalon não estão configuradas no deploy.' });
    var body = req.body || {};
    if (typeof body === 'string') body = JSON.parse(body || '{}');
    var code = body.code;
    var codeVerifier = body.codeVerifier;
    if (!code || !codeVerifier) return res.status(400).json({ error: 'MISSING_OAUTH_CODE', message: 'Código OAuth ou verificador PKCE ausente.' });
    var response = await fetch(apiBaseUrl + '/auth/oauth.v5/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'signal-pro-oauth/1.0' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: code, redirect_uri: redirectUri, client_id: Number(clientId), client_secret: clientSecret, code_verifier: codeVerifier })
    });
    var text = await response.text();
    var data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
    if (!response.ok || !data.access_token) return res.status(502).json({ error: 'AVALON_OAUTH_EXCHANGE_FAILED', message: data.error_description || data.message || ('A Avalon recusou a troca do código (HTTP ' + response.status + ').'), status: response.status });
    return res.status(200).json({ ok: true, accessToken: data.access_token, expiresIn: data.expires_in || null });
  } catch (error) {
    console.error('Avalon OAuth exchange:', error);
    return res.status(500).json({ error: 'AVALON_SERVER_ERROR', message: error && error.message ? error.message : 'Falha interna ao conectar à Avalon.' });
  }
};
