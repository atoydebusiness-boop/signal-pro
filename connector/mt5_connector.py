import os
import secrets
from flask import Flask, request, jsonify
from flask_cors import CORS
import MetaTrader5 as mt5

app=Flask(__name__)
CORS(app,resources={r"/api/*":{"origins":["https://obsignalpro.vercel.app","http://localhost:*","http://127.0.0.1:*"]}})
PAIR_TOKEN=os.getenv('SIGNAL_PRO_PAIR_TOKEN') or secrets.token_urlsafe(24)
TIMEFRAMES={"M1":mt5.TIMEFRAME_M1,"M2":mt5.TIMEFRAME_M2,"M3":mt5.TIMEFRAME_M3,"M4":mt5.TIMEFRAME_M4,"M5":mt5.TIMEFRAME_M5,"M6":mt5.TIMEFRAME_M6,"M10":mt5.TIMEFRAME_M10,"M12":mt5.TIMEFRAME_M12,"M15":mt5.TIMEFRAME_M15,"M20":mt5.TIMEFRAME_M20,"M30":mt5.TIMEFRAME_M30,"H1":mt5.TIMEFRAME_H1,"H2":mt5.TIMEFRAME_H2,"H3":mt5.TIMEFRAME_H3,"H4":mt5.TIMEFRAME_H4,"H6":mt5.TIMEFRAME_H6,"H8":mt5.TIMEFRAME_H8,"H12":mt5.TIMEFRAME_H12,"D1":mt5.TIMEFRAME_D1,"W1":mt5.TIMEFRAME_W1,"MN1":mt5.TIMEFRAME_MN1}
def err(m,s=400):return jsonify({"ok":False,"error":m,"mt5_error":mt5.last_error()}),s
def guard():return None if request.headers.get('X-Signal-Pro-Pair')==PAIR_TOKEN else (jsonify({"ok":False,"error":"Connector não pareado"}),401)
def account():
 a=mt5.account_info()
 if a is None:return None
 return {"login":a.login,"server":a.server,"company":a.company,"name":a.name,"currency":a.currency,"balance":a.balance,"equity":a.equity,"margin":a.margin,"margin_free":a.margin_free,"leverage":a.leverage,"trade_allowed":bool(a.trade_allowed),"trade_expert":bool(a.trade_expert)}
def sym(s):
 return {"name":s.name,"description":s.description,"path":s.path,"visible":bool(s.visible),"digits":s.digits,"point":s.point,"volume_min":s.volume_min,"volume_max":s.volume_max,"volume_step":s.volume_step,"trade_contract_size":s.trade_contract_size,"trade_tick_size":s.trade_tick_size,"trade_tick_value":s.trade_tick_value,"currency_base":s.currency_base,"currency_profit":s.currency_profit,"currency_margin":s.currency_margin}
@app.get('/api/pair')
def pair():return jsonify({"ok":True,"pair_token":PAIR_TOKEN}) if request.remote_addr in ('127.0.0.1','::1') else err('Pareamento disponível apenas localmente',403)
@app.get('/api/health')
def health():
 g=guard()
 if g:return g
 a=account();return jsonify({"ok":True,"mt5_connected":a is not None,"account":a})
@app.get('/api/broker-hint')
def hint():
 g=guard()
 if g:return g
 q=(request.args.get('q') or '').strip().lower();a=account();h=[]
 if a:
  text=f"{a.get('company','')} {a.get('server','')}"
  if not q or q in text.lower():h=[{"broker":a.get('company') or 'Corretora MT5',"server":a.get('server'),"source":"terminal"}]
 return jsonify({"ok":True,"hints":h})
@app.post('/api/connect')
def connect():
 g=guard()
 if g:return g
 b=request.get_json(silent=True) or {}
 try:login=int(b.get('login',0))
 except:return err('Login MT5 inválido')
 password=str(b.get('password') or '');server=str(b.get('server') or '').strip();path=str(b.get('terminal_path') or '').strip()
 if not login or not password or not server:return err('Informe login, senha e servidor MT5')
 mt5.shutdown();kw=dict(login=login,password=password,server=server,timeout=15000);ok=mt5.initialize(path,**kw) if path else mt5.initialize(**kw)
 if not ok:return err('Não foi possível conectar ao terminal/servidor MT5',401)
 a=account()
 if not a:mt5.shutdown();return err('Conta MT5 não confirmou autenticação',401)
 return jsonify({"ok":True,"account":a})
@app.post('/api/disconnect')
def disconnect():
 g=guard()
 if g:return g
 mt5.shutdown();return jsonify({"ok":True})
@app.get('/api/symbols')
def symbols():
 g=guard()
 if g:return g
 xs=mt5.symbols_get()
 if xs is None:return err('Não foi possível carregar os símbolos',503)
 q=(request.args.get('q') or '').strip().lower();data=[sym(s) for s in xs if not q or q in (s.name+' '+s.description+' '+s.path).lower()]
 return jsonify({"ok":True,"count":len(data),"symbols":data})
@app.get('/api/candles')
def candles():
 g=guard()
 if g:return g
 symbol=(request.args.get('symbol') or '').strip();tf_name=(request.args.get('timeframe') or 'M15').upper();count=min(max(int(request.args.get('count',300)),60),2000);tf=TIMEFRAMES.get(tf_name)
 if not symbol or tf is None:return err('Símbolo ou timeframe inválido')
 info=mt5.symbol_info(symbol)
 if info is None:return err('Símbolo não encontrado',404)
 if not info.visible and not mt5.symbol_select(symbol,True):return err('Não foi possível ativar o símbolo')
 rates=mt5.copy_rates_from_pos(symbol,tf,0,count)
 if rates is None:return err('Não foi possível carregar candles',503)
 return jsonify({"ok":True,"symbol":symbol,"timeframe":tf_name,"candles":[{"time":int(x['time']),"open":float(x['open']),"high":float(x['high']),"low":float(x['low']),"close":float(x['close']),"tick_volume":int(x['tick_volume'])} for x in rates]})
@app.get('/api/positions')
def positions():
 g=guard()
 if g:return g
 xs=mt5.positions_get()
 if xs is None:return err('Não foi possível carregar posições',503)
 return jsonify({"ok":True,"positions":[{"ticket":x.ticket,"symbol":x.symbol,"type":x.type,"volume":x.volume,"price_open":x.price_open,"price_current":x.price_current,"sl":x.sl,"tp":x.tp,"profit":x.profit} for x in xs]})
@app.post('/api/risk/lot')
def risk_lot():
 g=guard()
 if g:return g
 b=request.get_json(silent=True) or {};symbol=str(b.get('symbol') or '').strip();side=str(b.get('side') or 'buy').lower()
 try:risk=float(b.get('risk_money',0));entry=float(b.get('entry',0));stop=float(b.get('stop',0))
 except:return err('Dados de risco inválidos')
 info=mt5.symbol_info(symbol)
 if not info or risk<=0 or entry<=0 or stop<=0 or entry==stop:return err('Informe símbolo, risco, entrada e stop válidos')
 typ=mt5.ORDER_TYPE_BUY if side=='buy' else mt5.ORDER_TYPE_SELL
 loss=mt5.order_calc_profit(typ,symbol,1.0,entry,stop)
 if loss is None or abs(loss)<=0:return err('Corretora não retornou o risco para 1 lote',503)
 raw=risk/abs(loss);step=info.volume_step or info.volume_min or .01
 lots=max(info.volume_min,min(info.volume_max,(raw//step)*step));lots=round(lots,8)
 actual=mt5.order_calc_profit(typ,symbol,lots,entry,stop)
 return jsonify({"ok":True,"symbol":symbol,"lot":lots,"risk_requested":risk,"risk_estimated":abs(actual) if actual is not None else None,"currency":(account() or {}).get('currency'),"volume_min":info.volume_min,"volume_max":info.volume_max,"volume_step":info.volume_step})
def make_order(b):
 symbol=str(b.get('symbol') or '').strip();side=str(b.get('side') or '').lower()
 try:volume=float(b.get('volume',0));sl=float(b.get('sl',0) or 0);tp=float(b.get('tp',0) or 0)
 except:return None,'Volume/SL/TP inválido'
 if side not in ('buy','sell') or not symbol or volume<=0:return None,'Informe símbolo, direção e volume válidos'
 info=mt5.symbol_info(symbol)
 if info is None:return None,'Símbolo não encontrado'
 if not info.visible and not mt5.symbol_select(symbol,True):return None,'Símbolo indisponível no Market Watch'
 if volume<info.volume_min or volume>info.volume_max:return None,f'Lote fora do permitido ({info.volume_min} a {info.volume_max})'
 tick=mt5.symbol_info_tick(symbol)
 if tick is None:return None,'Cotação indisponível'
 buy=side=='buy';price=tick.ask if buy else tick.bid
 return {'action':mt5.TRADE_ACTION_DEAL,'symbol':symbol,'volume':volume,'type':mt5.ORDER_TYPE_BUY if buy else mt5.ORDER_TYPE_SELL,'price':price,'sl':sl,'tp':tp,'deviation':int(b.get('deviation',20)),'magic':560056,'comment':'Signal Pro','type_time':mt5.ORDER_TIME_GTC,'type_filling':info.filling_mode},None
@app.post('/api/order/check')
def check():
 g=guard()
 if g:return g
 req,p=make_order(request.get_json(silent=True) or {})
 if p:return err(p)
 r=mt5.order_check(req)
 if r is None:return err('MT5 não conseguiu validar a ordem',503)
 return jsonify({"ok":r.retcode==0,"retcode":r.retcode,"comment":r.comment,"request":req})
@app.post('/api/order/send')
def send():
 g=guard()
 if g:return g
 b=request.get_json(silent=True) or {}
 if b.get('confirm') is not True:return err('Ordem não enviada: confirmação explícita ausente')
 req,p=make_order(b)
 if p:return err(p)
 chk=mt5.order_check(req)
 if chk is None or chk.retcode!=0:return err('Ordem reprovada pelo order_check')
 r=mt5.order_send(req)
 if r is None:return err('Falha ao enviar ordem',503)
 return jsonify({"ok":r.retcode==mt5.TRADE_RETCODE_DONE,"retcode":r.retcode,"comment":r.comment,"order":r.order,"deal":r.deal,"volume":r.volume,"price":r.price})
if __name__=='__main__':
 print('\nSIGNAL PRO CONNECTOR MT5\nPareamento local:',PAIR_TOKEN,'\n')
 app.run(host='127.0.0.1',port=int(os.getenv('SIGNAL_PRO_PORT','8765')),debug=False)
