# Plano de validação em demo

1. Confirmar que Forex aberto recebe candle M1 recente.
2. Confirmar que Forex sem candle recente retorna `FOREX_FECHADO` e não gera sinal.
3. Confirmar que o receptor OTC aceita somente OHLC numérico com timestamp.
4. Capturar o formato de mercado OTC na conta demo sem dados de autenticação/ordem.
5. Criar parser para candles fechados e impedir repaint.
6. Comparar Forex e OTC separadamente, com entrada fixa e sem martingale.
