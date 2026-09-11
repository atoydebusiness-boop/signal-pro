# Separação de mercados

`forex`: candles provenientes do backend `/api/market` e fontes externas de Forex real.

`quotex_otc`: candles observados na própria plataforma OTC durante teste demo.

Um sinal nunca deve trocar de uma origem para a outra silenciosamente. A origem deve ser exibida e persistida junto ao resultado quando a integração ao histórico for implementada.
