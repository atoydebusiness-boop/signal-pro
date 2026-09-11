// ==UserScript==
// @name         Signal Pro - Quotex OTC Bridge
// @namespace    signal-pro
// @version      0.3.0
// @description  Detecta todos os ativos OTC vistos no fluxo de mercado da Quotex e mostra o status na própria tela. Não envia ordens nem captura credenciais.
// @match        https://qxbroker.com/*
// @match        https://*.qxbroker.com/*
// @match        https://quotex.com/*
// @match        https://*.quotex.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (window.__SIGNAL_PRO_OTC_BRIDGE__) return;
  window.__SIGNAL_PRO_OTC_BRIDGE__ = true;

  const NativeWebSocket = window.WebSocket;
  const assets = new Map();
  let messages = 0;
  let lastMarketAt = 0;
  let panel;

  const sensitive = /authorization|ssid|token|password|cookie|balance|deposit|withdraw|order|email/i;
  const marketWords = /otc|candle|quote|price|tick|history|asset/i;
  const assetPattern = /\b([A-Z]{3}[\/_-]?[A-Z]{3}(?:[_-]?OTC)?)\b/gi;

  function normalizeAsset(v) {
    return String(v || '').toUpperCase().replace('/', '').replace('-', '_');
  }

  function rememberAsset(name, price) {
    const n = normalizeAsset(name);
    if (!n || !/^[A-Z]{6}(?:_?OTC)?$/.test(n)) return;
    const key = n.includes('OTC') ? n.replace(/_?OTC$/, '_OTC') : n;
    const old = assets.get(key) || { count: 0, price: null, at: 0 };
    old.count++;
    old.at = Date.now();
    if (Number.isFinite(Number(price))) old.price = Number(price);
    assets.set(key, old);
  }

  function walk(value, parent = {}) {
    if (value == null) return;
    if (Array.isArray(value)) { value.slice(0, 2000).forEach(v => walk(v, parent)); return; }
    if (typeof value !== 'object') return;

    let asset = value.asset || value.symbol || value.pair || value.active;
    let price = value.price ?? value.close ?? value.value;
    if (asset) rememberAsset(asset, price);

    for (const [k, v] of Object.entries(value)) {
      if (sensitive.test(k)) continue;
      if (typeof v === 'string') {
        const matches = v.toUpperCase().match(assetPattern) || [];
        matches.forEach(a => rememberAsset(a));
      } else if (v && typeof v === 'object') walk(v, value);
    }
  }

  function parse(text) {
    const start = text.indexOf('[');
    if (start < 0) return null;
    try { return JSON.parse(text.slice(start)); } catch { return null; }
  }

  function processMessage(raw) {
    if (typeof raw !== 'string' || raw.length > 2_000_000) return;
    if (sensitive.test(raw) || !marketWords.test(raw)) return;
    const data = parse(raw);
    if (!data) return;
    messages++;
    lastMarketAt = Date.now();
    walk(data);
    render();
  }

  function ensurePanel() {
    if (panel || !document.body) return;
    panel = document.createElement('div');
    panel.id = 'signal-pro-otc-panel';
    Object.assign(panel.style, {
      position:'fixed', right:'16px', bottom:'16px', width:'300px', maxHeight:'360px', overflow:'auto',
      zIndex:'2147483647', background:'rgba(8,13,24,.96)', color:'#fff', border:'1px solid #26344d',
      borderRadius:'14px', boxShadow:'0 12px 40px rgba(0,0,0,.45)', padding:'14px',
      fontFamily:'Arial,sans-serif', fontSize:'12px', lineHeight:'1.4'
    });
    document.body.appendChild(panel);
    render();
  }

  function render() {
    ensurePanel();
    if (!panel) return;
    const age = lastMarketAt ? Date.now() - lastMarketAt : Infinity;
    const connected = age < 10000;
    const list = [...assets.entries()].sort((a,b) => b[1].at-a[1].at);
    const otc = list.filter(([a]) => a.includes('OTC'));
    const shown = (otc.length ? otc : list).slice(0, 30);
    panel.innerHTML = `
      <div style="font-size:14px;font-weight:800;margin-bottom:7px">SIGNAL PRO • OTC</div>
      <div style="font-weight:700;color:${connected ? '#36e28a' : '#ffcc66'}">${connected ? '● RECEBENDO DADOS' : '● AGUARDANDO DADOS'}</div>
      <div style="color:#9fb0c8;margin:5px 0 10px">Mensagens: ${messages} • Ativos detectados: ${assets.size}</div>
      ${shown.length ? shown.map(([a,d]) => `<div style="display:flex;justify-content:space-between;border-top:1px solid #1c2940;padding:6px 0"><b>${a}</b><span>${d.price ?? 'dados ✓'}</span></div>`).join('') : '<div style="color:#9fb0c8">Abra um ativo OTC e aguarde alguns segundos.</div>'}
      <div style="color:#708198;margin-top:9px">Somente leitura de mercado. Nenhuma ordem é enviada.</div>`;
  }

  function WrappedWebSocket(...args) {
    const ws = new NativeWebSocket(...args);
    ws.addEventListener('message', e => processMessage(e.data));
    return ws;
  }
  WrappedWebSocket.prototype = NativeWebSocket.prototype;
  ['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(k => WrappedWebSocket[k] = NativeWebSocket[k]);
  window.WebSocket = WrappedWebSocket;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensurePanel, {once:true});
  else ensurePanel();
  setInterval(render, 2000);
})();
