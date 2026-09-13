# Signal Pro Connector — MetaTrader 5

Conector local do Signal Pro para um terminal MetaTrader 5 instalado no Windows.

## Instalação

1. Instale/abra o MetaTrader 5 da corretora no mesmo computador.
2. Instale Python 3.12+.
3. No diretório `connector`:

```bash
pip install -r requirements.txt
python mt5_connector.py
```

O serviço local inicia em `http://127.0.0.1:8765`.

## Endpoints

- `GET /api/health` — status e conta conectada.
- `POST /api/connect` — login real no terminal MT5 usando `login`, `password`, `server` e opcional `terminal_path`.
- `POST /api/disconnect` — encerra a sessão do conector.
- `GET /api/symbols` — todos os símbolos e especificações retornados pela corretora.
- `GET /api/candles?symbol=XAUUSD&timeframe=M15&count=300` — candles reais do terminal.
- `GET /api/positions` — posições abertas.
- `POST /api/order/check` — valida uma ordem antes do envio.
- `POST /api/order/send` — envia a ordem; exige `confirm: true`.

## Segurança

A senha é usada para autenticar no terminal e não é persistida pelo conector. Não coloque credenciais MT5 em Supabase, Vercel ou no repositório.

O robô deve iniciar desligado e ser homologado primeiro em conta DEMO. `order_check` reduz erros de parâmetros/fundos, mas não garante que uma ordem será executada pelo servidor.

## Próxima camada

A interface web precisa falar com este conector. Como uma página HTTPS hospedada não deve depender diretamente de um serviço HTTP localhost em produção, a versão distribuída deve usar um canal local seguro (ou um agente com conexão de saída autenticada) entre o Connector e o backend Signal Pro.
