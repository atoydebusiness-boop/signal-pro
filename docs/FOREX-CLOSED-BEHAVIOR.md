# Mercado Forex fechado

Quando o backend detectar que a vela M1 mais recente está velha, ele não retorna a série como válida. Responde 409/`FOREX_FECHADO`. O frontend principal ainda precisa ganhar uma mensagem específica para esse status antes do merge final.
