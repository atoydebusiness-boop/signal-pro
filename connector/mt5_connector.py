import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import MetaTrader5 as mt5

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": ["https://obsignalpro.vercel.app", "http://localhost:*", "http://127.0.0.1:*"]}})

TIMEFRAMES = {
    "M1": mt5.TIMEFRAME_M1, "M2": mt5.TIMEFRAME_M2, "M3": mt5.TIMEFRAME_M3,
    "M4": mt5.TIMEFRAME_M4, "M5": mt5.TIMEFRAME_M5, "M6": mt5.TIMEFRAME_M6,
    "M10": mt5.TIMEFRAME_M10, "M12": mt5.TIMEFRAME_M12, "M15": mt5.TIMEFRAME_M15,
    "M20": mt5.TIMEFRAME_M20, "M30": mt5.TIMEFRAME_M30, "H1": mt5.TIMEFRAME_H1,
    "H2": mt5.TIMEFRAME_H2, "H3": mt5.TIMEFRAME_H3, "H4": mt5.TIMEFRAME_H4,
    "H6": mt5.TIMEFRAME_H6, "H8": mt5.TIMEFRAME_H8, "H12": mt5.TIMEFRAME_H12,
    "D1": mt5.TIMEFRAME_D1, "W1": mt5.TIMEFRAME_W1, "MN1": mt5.TIMEFRAME_MN1,
}

def err(message, status=400):
    return jsonify({"ok": False, "error": message, "mt5_error": mt5.last_error()}), status

def account_payload():
    a = mt5.account_info()
    if a is None:
        return None
    return {
        "login": a.login, "server": a.server, "company": a.company,
        "name": a.name, "currency": a.currency, "balance": a.balance,
        "equity": a.equity, "margin": a.margin, "margin_free": a.margin_free,
        "leverage": a.leverage, "trade_allowed": bool(a.trade_allowed),
        "trade_expert": bool(a.trade_expert)
    }

@app.get('/api/health')
def health():
    a = account_payload()
    return jsonify({"ok": True, "mt5_connected": a is not None, "account": a})

@app.post('/api/connect')
def connect():
    body = request.get_json(silent=True) or {}
    try:
        login = int(body.get('login', 0))
    except Exception:
        return err('Login MT5 inválido')
    password = str(body.get('password') or '')
    server = str(body.get('server') or '').strip()
    terminal_path = str(body.get('terminal_path') or '').strip()
    if not login or not password or not server:
        return err('Informe login, senha e servidor MT5')
    mt5.shutdown()
    kwargs = dict(login=login, password=password, server=server, timeout=15000)
    ok = mt5.initialize(terminal_path, **kwargs) if terminal_path else mt5.initialize(**kwargs)
    if not ok:
        return err('Não foi possível conectar ao terminal/servidor MT5', 401)
    a = account_payload()
    if not a:
        mt5.shutdown()
        return err('Conta MT5 não confirmou autenticação', 401)
    return jsonify({"ok": True, "account": a})

@app.post('/api/disconnect')
def disconnect():
    mt5.shutdown()
    return jsonify({"ok": True})

@app.get('/api/symbols')
def symbols():
    xs = mt5.symbols_get()
    if xs is None:
        return err('Não foi possível carregar os símbolos', 503)
    data = []
    for s in xs:
        data.append({
            "name": s.name, "description": s.description, "path": s.path,
            "visible": bool(s.visible), "digits": s.digits, "point": s.point,
            "volume_min": s.volume_min, "volume_max": s.volume_max,
            "volume_step": s.volume_step, "trade_contract_size": s.trade_contract_size,
            "currency_base": s.currency_base, "currency_profit": s.currency_profit,
            "currency_margin": s.currency_margin
        })
    return jsonify({"ok": True, "count": len(data), "symbols": data})

@app.get('/api/candles')
def candles():
    symbol = (request.args.get('symbol') or '').strip()
    tf_name = (request.args.get('timeframe') or 'M15').upper()
    count = min(max(int(request.args.get('count', 300)), 60), 2000)
    tf = TIMEFRAMES.get(tf_name)
    if not symbol or tf is None:
        return err('Símbolo ou timeframe inválido')
    info = mt5.symbol_info(symbol)
    if info is None:
        return err('Símbolo não encontrado', 404)
    if not info.visible and not mt5.symbol_select(symbol, True):
        return err('Não foi possível ativar o símbolo')
    rates = mt5.copy_rates_from_pos(symbol, tf, 0, count)
    if rates is None:
        return err('Não foi possível carregar candles', 503)
    data = [{"time": int(x['time']), "open": float(x['open']), "high": float(x['high']), "low": float(x['low']), "close": float(x['close']), "tick_volume": int(x['tick_volume'])} for x in rates]
    return jsonify({"ok": True, "symbol": symbol, "timeframe": tf_name, "candles": data})

@app.get('/api/positions')
def positions():
    xs = mt5.positions_get()
    if xs is None:
        return err('Não foi possível carregar posições', 503)
    data = [{"ticket": x.ticket, "symbol": x.symbol, "type": x.type, "volume": x.volume, "price_open": x.price_open, "price_current": x.price_current, "sl": x.sl, "tp": x.tp, "profit": x.profit} for x in xs]
    return jsonify({"ok": True, "positions": data})

@app.post('/api/order/check')
def order_check():
    body = request.get_json(silent=True) or {}
    request_data, problem = make_order(body)
    if problem:
        return err(problem)
    result = mt5.order_check(request_data)
    if result is None:
        return err('MT5 não conseguiu validar a ordem', 503)
    return jsonify({"ok": result.retcode == 0, "retcode": result.retcode, "comment": result.comment, "request": request_data})

@app.post('/api/order/send')
def order_send():
    body = request.get_json(silent=True) or {}
    # Execução real exige confirmação explícita por chamada. O painel deve iniciar em DEMO/robô OFF.
    if body.get('confirm') is not True:
        return err('Ordem não enviada: confirmação explícita ausente')
    request_data, problem = make_order(body)
    if problem:
        return err(problem)
    checked = mt5.order_check(request_data)
    if checked is None or checked.retcode != 0:
        return err('Ordem reprovada pelo order_check')
    result = mt5.order_send(request_data)
    if result is None:
        return err('Falha ao enviar ordem', 503)
    return jsonify({"ok": result.retcode == mt5.TRADE_RETCODE_DONE, "retcode": result.retcode, "comment": result.comment, "order": result.order, "deal": result.deal, "volume": result.volume, "price": result.price})

def make_order(body):
    symbol = str(body.get('symbol') or '').strip()
    side = str(body.get('side') or '').lower()
    try:
        volume = float(body.get('volume', 0))
        sl = float(body.get('sl', 0) or 0)
        tp = float(body.get('tp', 0) or 0)
    except Exception:
        return None, 'Volume/SL/TP inválido'
    if side not in ('buy', 'sell') or not symbol or volume <= 0:
        return None, 'Informe símbolo, direção e volume válidos'
    info = mt5.symbol_info(symbol)
    if info is None:
        return None, 'Símbolo não encontrado'
    if not info.visible and not mt5.symbol_select(symbol, True):
        return None, 'Símbolo indisponível no Market Watch'
    if volume < info.volume_min or volume > info.volume_max:
        return None, f'Lote fora do permitido ({info.volume_min} a {info.volume_max})'
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return None, 'Cotação indisponível'
    is_buy = side == 'buy'
    price = tick.ask if is_buy else tick.bid
    req = {
        'action': mt5.TRADE_ACTION_DEAL, 'symbol': symbol, 'volume': volume,
        'type': mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL,
        'price': price, 'sl': sl, 'tp': tp, 'deviation': int(body.get('deviation', 20)),
        'magic': 560056, 'comment': 'Signal Pro', 'type_time': mt5.ORDER_TIME_GTC,
        'type_filling': info.filling_mode
    }
    return req, None

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.getenv('SIGNAL_PRO_PORT', '8765')), debug=False)
