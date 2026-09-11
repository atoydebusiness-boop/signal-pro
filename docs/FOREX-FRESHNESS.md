# Frescor do Forex

O backend aceita como atual somente feed cuja vela M1 mais recente tenha timestamp com idade máxima de 4 minutos. Se todas as fontes disponíveis retornarem candles mais antigos, responde HTTP 409 com `error: FOREX_FECHADO`.

O cache em memória também é descartado quando o candle contido nele ultrapassa essa idade. Assim, cache antigo não deve ser apresentado como mercado online.
