# Signal Pro OTC Backend

Backend separado para dados OTC do Signal Pro.

## Objetivo

- Nao injetar comandos no WebSocket da pagina da Quotex.
- Nao executar CALL/PUT ou qualquer ordem.
- Receber candles M1 de um adaptador de dados autorizado.
- Calcular sinais apenas sobre velas fechadas.
- Expor diagnostico e ranking para o frontend Signal Pro.

## Endpoints planejados

- `GET /health` - diagnostico do backend.
- `GET /signals` - ranking dos sinais calculados.
- `POST /candles` - ingestao autenticada de candles fechados por um adaptador autorizado.

## Seguranca

O segredo `OTC_INGEST_SECRET` deve existir somente no servidor. Nunca colocar service role do Supabase, senha, cookie ou sessao da corretora em JavaScript publico.

## Ranking inicial

Sinais validos exigem pelo menos 6 votos favoraveis e no maximo 1 contrario. ADX e outros filtros sao usados como confirmacao/desempate. `5 x 2` deve permanecer AGUARDAR.
