// Signal Pro — receptor local de candles OTC para testes em conta demo.
// Este módulo NÃO envia ordens e NÃO lê credenciais.
// A origem deve chamar window.SignalProOTC.pushCandle(...) com candles observados na plataforma.
(() => {
  const markets = new Map();
  const MAX = 300;
  const cleanPair = p => String(p || '').trim();
  const cleanTf = tf => String(tf || 'M1').toUpperCase();
  function pushCandle(input) {
    const pair = cleanPair(input?.pair), timeframe = cleanTf(input?.timeframe);
    const candle = {t:+input?.t,o:+input?.o,h:+input?.h,l:+input?.l,c:+input?.c};
    if (!pair || !Number.isFinite(candle.t) || ![candle.o,candle.h,candle.l,candle.c].every(Number.isFinite)) return false;
    const key = `${pair}|${timeframe}`;
    const rows = markets.get(key) || [];
    const i = rows.findIndex(x => x.t === candle.t);
    if (i >= 0) rows[i] = candle; else rows.push(candle);
    rows.sort((a,b)=>a.t-b.t);
    if (rows.length > MAX) rows.splice(0, rows.length-MAX);
    markets.set(key, rows);
    window.dispatchEvent(new CustomEvent('signalpro:otc-candle',{detail:{pair,timeframe,candle,count:rows.length}}));
    return true;
  }
  function snapshot(pair,timeframe='M1') { return [...(markets.get(`${cleanPair(pair)}|${cleanTf(timeframe)}`)||[])]; }
  function pairs() { return [...new Set([...markets.keys()].map(k=>k.split('|')[0]))]; }
  window.SignalProOTC = Object.freeze({pushCandle,snapshot,pairs});
})();
