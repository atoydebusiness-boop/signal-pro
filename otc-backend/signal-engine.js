'use strict';

function sma(values, n) {
  if (values.length < n) return null;
  const a = values.slice(-n);
  return a.reduce((s, x) => s + x, 0) / n;
}

function ema(values, n) {
  if (values.length < n) return null;
  let e = values.slice(0, n).reduce((s, x) => s + x, 0) / n;
  const k = 2 / (n + 1);
  for (let i = n; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function emaSeries(values, n) {
  if (values.length < n) return [];
  let e = values.slice(0, n).reduce((s, x) => s + x, 0) / n;
  const out = [e], k = 2 / (n + 1);
  for (let i = n; i < values.length; i++) { e = values[i] * k + e * (1 - k); out.push(e); }
  return out;
}

function rsi(values, n = 14) {
  if (values.length <= n) return null;
  let gain = 0, loss = 0;
  for (let i = values.length - n; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  if (!loss) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function atr(c, n = 14) {
  if (c.length < n + 1) return null;
  const tr = [];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(c[i].high-c[i].low, Math.abs(c[i].high-c[i-1].close), Math.abs(c[i].low-c[i-1].close)));
  return sma(tr, n);
}

function macd(values) {
  if (values.length < 35) return null;
  const fast = emaSeries(values, 12), slow = emaSeries(values, 26), off = fast.length - slow.length, line = [];
  for (let i = 0; i < slow.length; i++) line.push(fast[i + off] - slow[i]);
  const signal = ema(line, 9), current = line.at(-1);
  return signal == null ? null : { histogram: current - signal };
}

function bollinger(values, n = 20) {
  if (values.length < n) return null;
  const a = values.slice(-n), mid = sma(a, n);
  const sd = Math.sqrt(a.reduce((s, x) => s + (x-mid)**2, 0) / n);
  return { mid, upper: mid + 2*sd, lower: mid - 2*sd };
}

function stochastic(c, n = 14) {
  if (c.length < n) return null;
  const a = c.slice(-n), hi = Math.max(...a.map(x=>x.high)), lo = Math.min(...a.map(x=>x.low));
  return hi === lo ? 50 : 100 * (a.at(-1).close - lo) / (hi - lo);
}

function adx(c, n = 14) {
  if (c.length < n*2+1) return null;
  const tr=[], plus=[], minus=[];
  for (let i=1;i<c.length;i++) {
    const up=c[i].high-c[i-1].high, down=c[i-1].low-c[i].low;
    plus.push(up>down&&up>0?up:0); minus.push(down>up&&down>0?down:0);
    tr.push(Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close)));
  }
  const dx=[];
  for(let end=n;end<=tr.length;end++) {
    const t=tr.slice(end-n,end).reduce((a,b)=>a+b,0); if(!t) continue;
    const p=100*plus.slice(end-n,end).reduce((a,b)=>a+b,0)/t, m=100*minus.slice(end-n,end).reduce((a,b)=>a+b,0)/t;
    if(p+m) dx.push(100*Math.abs(p-m)/(p+m));
  }
  return dx.length<n?null:sma(dx,n);
}

function analyze(asset, candles) {
  if (!Array.isArray(candles) || candles.length < 60) return null;
  const c = candles.slice(-200), closes=c.map(x=>x.close), last=c.at(-1), prev=c.at(-2);
  const e9=ema(closes,9), e21=ema(closes,21), R=rsi(closes), M=macd(closes), B=bollinger(closes), S=stochastic(c), A=adx(c), T=atr(c);
  if ([e9,e21,R,S,A,T].some(x=>x==null)||!M||!B) return null;
  let buy=0,sell=0;
  e9>e21?buy++:sell++;
  if(R>=52&&R<72)buy++; else if(R<=48&&R>28)sell++;
  M.histogram>0?buy++:sell++;
  if(last.close>B.mid&&last.close<B.upper)buy++; else if(last.close<B.mid&&last.close>B.lower)sell++;
  if(S>=55&&S<85)buy++; else if(S<=45&&S>15)sell++;
  const mom=last.close-c.at(-6).close; mom>0?buy++:mom<0&&sell++;
  last.close>last.open?buy++:last.close<last.open&&sell++;
  if(last.high>prev.high&&last.low>=prev.low)buy++; else if(last.low<prev.low&&last.high<=prev.high)sell++;
  const strength=Math.max(buy,sell), opposition=Math.min(buy,sell), emaDistance=Math.abs(e9-e21);
  let direction='WAIT';
  if(A>=18 && emaDistance>T*0.04 && strength>=6 && opposition<=1) direction=buy>sell?'BUY':'SELL';
  return { asset, direction, buy, sell, strength, opposition, adx:A, rsi:R, candleTime:last.time };
}

function rank(signals) {
  const valid=signals.filter(x=>x&&x.direction!=='WAIT');
  valid.sort((a,b)=> b.strength-a.strength || a.opposition-b.opposition || b.adx-a.adx);
  return valid;
}

module.exports={analyze,rank};
