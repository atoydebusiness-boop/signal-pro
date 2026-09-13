# Signal Pro Connector — MetaTrader 5

Este agente roda no mesmo **Windows** do terminal MetaTrader 5 e abre apenas conexões HTTPS de saída para o Signal Pro. A senha MT5 passa pela API somente em memória até o terminal e não é gravada no navegador, na VPS ou no Connector.

## Instalação no Windows

1. Instale e abra o MetaTrader 5 oficial da corretora.
2. Instale Python 3.12 de 64 bits.
3. No PowerShell, dentro da pasta `connector`:

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install --requirement requirements.txt
```

4. No painel Signal Pro, clique em **GERAR CÓDIGO DO CONNECTOR**.
5. Pareie usando o código de 8 dígitos exibido:

```powershell
.venv\Scripts\python mt5_connector.py --pair-code 12345678
```

O token do dispositivo é salvo em `%APPDATA%\SignalPro\agent.json`. Senha, login e servidor da conta MT5 não são persistidos. Não compartilhe o arquivo de pareamento.

## Proteções

- outra conta ativa nunca é derrubada por uma tentativa de login;
- chamadas MT5 são serializadas para evitar corridas;
- lote respeita `volume_min`, `volume_max` e `volume_step`;
- `order_check` testa filling modes aceitos pela corretora;
- envio inicia OFF na VPS e no Connector;
- envio é permitido somente em conta DEMO, com Stop Loss, idempotência, limite por operação, operações/dia e perda diária;
- crie `%APPDATA%\SignalPro\KILL_SWITCH` para bloquear imediatamente novos envios;
- nunca use Martingale.

Para habilitar uma homologação DEMO controlada, tanto a VPS quanto o processo local precisam receber `DEMO_TRADING_ENABLED=true` / `SIGNAL_PRO_TRADING_ENABLED=true`. Mantenha OFF até `health`, símbolos, candles, risco e `order_check` passarem.

## API local opcional

`--local-api` habilita compatibilidade local em `127.0.0.1:8765`. Ela nunca deve ser publicada na internet.
