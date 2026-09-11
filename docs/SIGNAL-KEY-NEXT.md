# Chave de sinal

A integração final deve usar chave determinística com origem + ativo + timeframe + timestamp da vela + direção e persistir essa chave no banco com unicidade por usuário, evitando sinal duplicado após refresh.
