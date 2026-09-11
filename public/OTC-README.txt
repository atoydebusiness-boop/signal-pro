SIGNAL PRO — OTC

Arquivos desta etapa:
- otc-capture.js: armazenamento local dos candles OTC.
- otc-test.html: tela para validar candles recebidos.
- quotex-otc-bridge.user.js: observador de diagnóstico das mensagens de mercado OTC.

O observador não envia ordens e não deve coletar login, token, saldo ou credenciais.
A próxima etapa é identificar o formato exato da mensagem de candle/quote observada na conta demo e criar um parser restrito aos campos de mercado: par, timestamp, OHLC/preço.
