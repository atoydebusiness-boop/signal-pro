// ==UserScript==
// @name         Signal Pro - Quotex OTC Bridge
// @namespace    signal-pro
// @version      0.2.0
// @description  Captura somente dados de mercado OTC visíveis no WebSocket da Quotex para diagnóstico do Signal Pro. Não envia ordens nem captura credenciais.
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

  const CHANNEL = 'signal-pro-otc-v2';
  const NativeWebSocket = window.WebSocket;
  const recent = new Map();

  const emit = (type, payload = {}) => {
    window.postMessage({ channel: CHANNEL, type, payload, at: Date.now() }, '*');
  };

  const safeText = value => typeof value === 'string' ? value : '';
  const looksSensitive = text => /authorization|ssid|token|password|balance|deposit|withdraw|order/i.test(text);
  const looksMarket = text => /otc|candle|quote|price|tick|history|asset/i.test(text);

  function sanitize(value, depth = 0) {
    if (depth > 5 || value == null) return null;
    if (Array.isArray(value)) return value.slice(0, 500).map(v => sanitize(v, depth + 1));
    if (typeof value !== 'object') return value;

    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (/ssid|token|auth|password|cookie|balance|deposit|withdraw|order|user|email/i.test(key)) continue;
      if (/asset|symbol|pair|time|timestamp|open|high|low|close|price|value|payout|period|timeframe|candl|quote|tick|history/i.test(key)) {
        out[key] = sanitize(val, depth + 1);
      } else if (val && typeof val === 'object') {
        const nested = sanitize(val, depth + 1);
        if (nested && (Array.isArray(nested) ? nested.length : Object.keys(nested).length)) out[key] = nested;
      }
    }
    return out;
  }

  function parseSocketIo(text) {
    const trimmed = text.trim();
    const start = trimmed.indexOf('[');
    if (start < 0) return null;
    try { return JSON.parse(trimmed.slice(start)); } catch { return null; }
  }

  function publishCandidate(raw) {
    const text = safeText(raw);
    if (!text || text.length > 2_000_000 || looksSensitive(text) || !looksMarket(text)) return;

    const parsed = parseSocketIo(text);
    if (!parsed) return;
    const clean = sanitize(parsed);
    if (!clean) return;

    const serialized = JSON.stringify(clean);
    if (serialized.length < 10) return;
    const key = serialized.slice(0, 1200);
    const now = Date.now();
    if (recent.has(key) && now - recent.get(key) < 1000) return;
    recent.set(key, now);
    if (recent.size > 200) recent.delete(recent.keys().next().value);

    emit('market-data', clean);
  }

  function WrappedWebSocket(...args) {
    const ws = new NativeWebSocket(...args);
    ws.addEventListener('message', event => publishCandidate(event.data));
    return ws;
  }

  WrappedWebSocket.prototype = NativeWebSocket.prototype;
  for (const key of ['CONNECTING','OPEN','CLOSING','CLOSED']) WrappedWebSocket[key] = NativeWebSocket[key];
  window.WebSocket = WrappedWebSocket;

  emit('bridge-ready', { version: '0.2.0', host: location.host });
  console.info('[Signal Pro] OTC Bridge ativo. Somente dados de mercado são observados; ordens e credenciais são ignoradas.');
})();
