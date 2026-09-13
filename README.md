# Signal Pro

Plataforma web de scanner/análise técnica e integração controlada com uma conta MetaTrader 5 DEMO.

Produção: <https://signalpro.ativasite.com.br>

## Arquitetura atual

- `server/server.mjs`: web/API Node.js na VPS, autenticação do bearer token pelo Supabase Auth e relay para o Connector;
- `public/`: frontend estático;
- `connector/`: agente Windows que conversa com o pacote oficial `MetaTrader5` e abre somente HTTPS de saída;
- `compose.yaml`: stack isolada, sem portas públicas próprias, ligada ao proxy existente pela rede `local-ai-internal`;
- `infra/`: bloco Nginx e renovação de certificados reproduzíveis.

O MT5 não roda no Ubuntu. O pacote oficial só distribui wheels Windows e depende do terminal desktop. Manter o terminal/Connector no Windows evita instalar Wine e bibliotecas globais na VPS compartilhada.

```text
navegador -> HTTPS/VPS -> fila autenticada -> Connector Windows -> terminal MT5 -> corretora DEMO
```

Login, senha e servidor MT5 não são persistidos. O token do Connector é persistido como hash na VPS e o valor bruto fica somente no perfil do usuário Windows.

## Dependências ainda externas

- Supabase Cloud atual: Auth, perfis, histórico e RPC de consumo;
- Vercel atual: `/api/market`, usado temporariamente como upstream autenticado pela API da VPS;
- Windows + terminal MT5: necessário para a integração oficial MetaTrader 5.

A Vercel deve permanecer até as chaves dos provedores de mercado serem migradas para a VPS. Nenhuma migração de banco foi aplicada nesta etapa porque não há migrations nem credencial administrativa do projeto Supabase no repositório.

## Desenvolvimento

Requer Node.js 22+.

```bash
npm test
npm run check
docker compose config --quiet
docker compose up -d --build
```

Copie `.env.example` para `.env` e preencha apenas secrets/valores de ambiente. O `.env` não deve ser versionado.

## Segurança operacional

- envio de ordem fica OFF por padrão na API e no Connector;
- apenas conta DEMO é aceita;
- Stop Loss e chave de idempotência são obrigatórios;
- risco/operação, operações/dia e perda diária possuem limites;
- `%APPDATA%\SignalPro\KILL_SWITCH` impede novos envios imediatamente;
- não existe Martingale;
- não publique a API local do Connector na internet.

Consulte [`connector/README.md`](connector/README.md) para instalar e parear o agente Windows.
