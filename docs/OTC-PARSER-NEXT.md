# Próximo passo do parser OTC

Precisamos de uma amostra real e sanitizada de mensagem de mercado observada na conta demo. A amostra deve conter somente campos de preço/candle/ativo/timestamp. Qualquer token, cookie, identificador de sessão, saldo ou campo de ordem deve ser removido.

Com essa amostra, implementar parser determinístico para formar candles M1 fechados, deduplicados por `(ativo, timestamp)` e sem repaint.
