// ==UserScript==
// @name         Signal Pro OTC Bridge (diagnóstico)
// @namespace    signal-pro
// @version      0.1
// @description  Observa somente mensagens de mercado para diagnosticar candles OTC; não envia ordens.
// @match        https://qxbroker.com/*
// @match        https://quotex.com/*
// @run-at       document-start
// ==/UserScript==
(() => {
  const NativeWS = window.WebSocket;
  const send = payload => window.postMessage({source:'signal-pro-otc-observer',payload}, '*');
  window.WebSocket = function(...args) {
    const ws = new NativeWS(...args);
    ws.addEventListener('message', ev => {
      if (typeof ev.data !== 'string') return;
      const text = ev.data;
      // Diagnóstico: encaminha apenas mensagens textuais que parecem conter dados OTC/candle.
      // Não interpreta login, sessão, saldo, ordens ou credenciais.
      const low = text.toLowerCase();
      if (!(low.includes('otc') && (low.includes('candle') || low.includes('quote') || low.includes('price')))) return;
      send({type:'candidate-market-message',text:text.slice(0,12000),at:Date.now()});
    });
    return ws;
  };
  window.WebSocket.prototype = NativeWS.prototype;
  Object.assign(window.WebSocket, NativeWS);
  send({type:'bridge-ready',at:Date.now()});
})();
