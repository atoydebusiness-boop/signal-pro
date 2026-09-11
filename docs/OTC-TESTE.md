# Signal Pro — teste Forex x OTC

## Regra atual

- O endpoint `/api/market` representa somente **Forex real**.
- Se a última vela M1 estiver velha, o endpoint responde `FOREX_FECHADO` e não entrega candles antigos como se fossem atuais.
- OTC não deve reutilizar o feed Forex.

## Próxima fonte: Quotex OTC

O modo OTC deverá receber somente dados de mercado/candles da sessão da plataforma e alimentar o mesmo analisador sem enviar ordens.

Formato interno planejado:

```json
{
  "market": "quotex_otc",
  "pair": "AUD/USD (OTC)",
  "timeframe": "M1",
  "candles": [{"t": 0, "o": 0, "h": 0, "l": 0, "c": 0}]
}
```

O histórico deverá manter Forex e OTC identificados separadamente para que WIN/LOSS e assertividade possam ser comparados sem misturar mercados.
