const MP='https://api.mercadopago.com';
async function getUser(token){const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;if(!url||!key)return null;const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`}});return r.ok?r.json():null}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const access=process.env.MERCADOPAGO_ACCESS_TOKEN;if(!access)return res.status(503).json({error:'Pagamento ainda não configurado.'});
 const bearer=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const user=await getUser(bearer);if(!user?.id||!user?.email)return res.status(401).json({error:'Sessão inválida. Entre novamente.'});
 const body={reason:'Signal Pro — Plano Pro',external_reference:user.id,payer_email:user.email,back_url:'https://obsignalpro.vercel.app/app.html?payment=return',auto_recurring:{frequency:1,frequency_type:'months',transaction_amount:59.90,currency_id:'BRL'}};
 try{const r=await fetch(`${MP}/preapproval`,{method:'POST',headers:{Authorization:`Bearer ${access}`,'Content-Type':'application/json','X-Idempotency-Key':`signal-pro-${user.id}`},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)return res.status(502).json({error:'Mercado Pago recusou a criação da assinatura.',detail:data?.message||data?.error||'erro'});return res.status(200).json({id:data.id,init_point:data.init_point||data.sandbox_init_point});}catch(e){return res.status(502).json({error:'Falha ao conectar ao Mercado Pago.'})}
}