import crypto from 'node:crypto';

function validSignature(req, secret) {
  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  const dataId = String(req.query?.['data.id'] || req.query?.data_id || req.body?.data?.id || '').toLowerCase();
  if (!xSignature || !xRequestId || !dataId || !secret) return false;
  const parts = Object.fromEntries(String(xSignature).split(',').map(p => p.split('=').map(v => v.trim())));
  const ts = parts.ts, received = parts.v1;
  if (!ts || !received) return false;
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected)); } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, endpoint: 'mercadopago-webhook' });
  if (req.method !== 'POST') return res.status(405).end();
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook secret not configured' });
  if (!validSignature(req, secret)) return res.status(401).json({ error: 'Invalid signature' });
  // A assinatura foi validada. A sincronização do status com o Supabase
  // será habilitada junto com as credenciais privadas de produção do Mercado Pago.
  return res.status(200).json({ received: true });
}
