# Testes

Esta branch deve ser validada antes de merge no `main`.

O teste do Forex verifica o endpoint `/api/market`: quando não existe vela M1 recente, deve retornar `FOREX_FECHADO`.

O teste OTC começa pelo receptor e pelo observador de mensagens de mercado. O parser final só deve ser implementado depois de confirmar o formato real recebido na conta demo.
