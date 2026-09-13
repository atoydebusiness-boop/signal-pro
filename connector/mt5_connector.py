"""Signal Pro MT5 Connector.

Runs beside a Windows MetaTrader 5 terminal. In cloud mode it opens only outbound
HTTPS connections to Signal Pro; MT5 credentials stay in process memory and are
never persisted or logged.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import platform
import secrets
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal, ROUND_FLOOR
from pathlib import Path
from typing import Any

import MetaTrader5 as mt5
import requests
from flask import Flask, jsonify, request


APP_NAME = "Signal Pro Connector"
MAGIC = 560056
TIMEFRAMES = {
    "M1": mt5.TIMEFRAME_M1, "M2": mt5.TIMEFRAME_M2, "M3": mt5.TIMEFRAME_M3,
    "M4": mt5.TIMEFRAME_M4, "M5": mt5.TIMEFRAME_M5, "M6": mt5.TIMEFRAME_M6,
    "M10": mt5.TIMEFRAME_M10, "M12": mt5.TIMEFRAME_M12, "M15": mt5.TIMEFRAME_M15,
    "M20": mt5.TIMEFRAME_M20, "M30": mt5.TIMEFRAME_M30, "H1": mt5.TIMEFRAME_H1,
    "H2": mt5.TIMEFRAME_H2, "H3": mt5.TIMEFRAME_H3, "H4": mt5.TIMEFRAME_H4,
    "H6": mt5.TIMEFRAME_H6, "H8": mt5.TIMEFRAME_H8, "H12": mt5.TIMEFRAME_H12,
    "D1": mt5.TIMEFRAME_D1, "W1": mt5.TIMEFRAME_W1, "MN1": mt5.TIMEFRAME_MN1,
}
MT5_LOCK = threading.RLock()
IDEMPOTENCY: dict[str, dict[str, Any]] = {}
LOG = logging.getLogger("signal-pro-connector")


def config_dir() -> Path:
    base = os.getenv("APPDATA") or str(Path.home())
    return Path(base) / "SignalPro"


def agent_file() -> Path:
    return config_dir() / "agent.json"


def kill_switch_file() -> Path:
    return config_dir() / "KILL_SWITCH"


def idempotency_file() -> Path:
    return config_dir() / "order-idempotency.json"


def load_idempotency() -> None:
    try:
        saved = json.loads(idempotency_file().read_text(encoding="utf-8"))
        cutoff = time.time() - 7 * 24 * 60 * 60
        IDEMPOTENCY.update({
            key: value for key, value in saved.items()
            if isinstance(value, dict) and float(value.get("created_at", 0)) >= cutoff
        })
    except (OSError, ValueError, TypeError):
        pass


def persist_idempotency() -> None:
    target = idempotency_file(); target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(".tmp")
    temp.write_text(json.dumps(IDEMPOTENCY, indent=2), encoding="utf-8")
    os.replace(temp, target)


def error(message: str, status: int = 400) -> tuple[dict[str, Any], int]:
    # MT5 last_error can contain broker/path details; keep it only in local logs.
    LOG.warning("mt5_error status=%s message=%s code=%s", status, message, mt5.last_error()[0])
    return {"ok": False, "error": message}, status


def account_data() -> dict[str, Any] | None:
    account = mt5.account_info()
    if account is None:
        return None
    trade_mode = int(account.trade_mode)
    demo_mode = int(getattr(mt5, "ACCOUNT_TRADE_MODE_DEMO", 0))
    return {
        "login": int(account.login), "server": account.server, "company": account.company,
        "name": account.name, "currency": account.currency, "balance": float(account.balance),
        "equity": float(account.equity), "margin": float(account.margin),
        "margin_free": float(account.margin_free), "leverage": int(account.leverage),
        "trade_allowed": bool(account.trade_allowed), "trade_expert": bool(account.trade_expert),
        "trade_mode": trade_mode, "is_demo": trade_mode == demo_mode,
    }


def symbol_data(symbol: Any) -> dict[str, Any]:
    return {
        "name": symbol.name, "description": symbol.description, "path": symbol.path,
        "visible": bool(symbol.visible), "digits": int(symbol.digits), "point": float(symbol.point),
        "trade_stops_level": int(symbol.trade_stops_level), "volume_min": float(symbol.volume_min),
        "volume_max": float(symbol.volume_max), "volume_step": float(symbol.volume_step),
        "trade_contract_size": float(symbol.trade_contract_size),
        "trade_tick_size": float(symbol.trade_tick_size), "trade_tick_value": float(symbol.trade_tick_value),
        "currency_base": symbol.currency_base, "currency_profit": symbol.currency_profit,
        "currency_margin": symbol.currency_margin,
    }


def require_connected() -> tuple[dict[str, Any] | None, tuple[dict[str, Any], int] | None]:
    account = account_data()
    return (account, None) if account else (None, error("Terminal MT5 não conectado", 503))


def connect_account(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    try:
        login = int(body.get("login", 0))
    except (TypeError, ValueError):
        return error("Login MT5 inválido")
    password = str(body.get("password") or "")
    server = str(body.get("server") or "").strip()
    terminal_path = str(body.get("terminal_path") or "").strip()
    if not login or not password or not server:
        return error("Informe login, senha e servidor MT5")
    current = account_data()
    if current:
        if current["login"] == login and current["server"].casefold() == server.casefold():
            if not current["is_demo"]:
                return error("Conta real detectada. Esta etapa aceita somente DEMO.", 403)
            return {"ok": True, "account": current, "already_connected": True}, 200
        return error("Outra conta já está ativa. Desconecte-a explicitamente antes de trocar.", 409)
    kwargs = {"login": login, "password": password, "server": server, "timeout": 15_000}
    ok = mt5.initialize(terminal_path, **kwargs) if terminal_path else mt5.initialize(**kwargs)
    password = ""
    if not ok:
        mt5.shutdown()
        return error("Não foi possível autenticar no terminal/servidor MT5", 401)
    account = account_data()
    if not account:
        mt5.shutdown()
        return error("Conta MT5 não confirmou autenticação", 401)
    if not account["is_demo"]:
        mt5.shutdown()
        return error("Conta real detectada. Esta etapa aceita somente DEMO.", 403)
    return {"ok": True, "account": account}, 200


def list_symbols(query: str) -> tuple[dict[str, Any], int]:
    symbols = mt5.symbols_get()
    if symbols is None:
        return error("Não foi possível carregar os símbolos", 503)
    needle = query.strip().casefold()
    result = [symbol_data(item) for item in symbols if not needle or needle in f"{item.name} {item.description} {item.path}".casefold()]
    return {"ok": True, "count": len(result), "symbols": result}, 200


def candles(query: dict[str, Any]) -> tuple[dict[str, Any], int]:
    symbol = str(query.get("symbol") or "").strip()
    timeframe_name = str(query.get("timeframe") or "M15").upper()
    try:
        count = min(max(int(query.get("count", 300)), 60), 2_000)
    except (TypeError, ValueError):
        return error("Quantidade de candles inválida")
    timeframe = TIMEFRAMES.get(timeframe_name)
    if not symbol or timeframe is None:
        return error("Símbolo ou timeframe inválido")
    info = mt5.symbol_info(symbol)
    if info is None:
        return error("Símbolo não encontrado", 404)
    if not info.visible and not mt5.symbol_select(symbol, True):
        return error("Não foi possível ativar o símbolo")
    rates = mt5.copy_rates_from_pos(symbol, timeframe, 0, count)
    if rates is None:
        return error("Não foi possível carregar candles", 503)
    items = [{
        "time": int(row["time"]), "open": float(row["open"]), "high": float(row["high"]),
        "low": float(row["low"]), "close": float(row["close"]),
        "tick_volume": int(row["tick_volume"]), "spread": int(row["spread"]),
    } for row in rates]
    return {"ok": True, "symbol": symbol, "timeframe": timeframe_name, "candles": items}, 200


def positions() -> tuple[dict[str, Any], int]:
    items = mt5.positions_get()
    if items is None:
        return error("Não foi possível carregar posições", 503)
    return {"ok": True, "positions": [{
        "ticket": int(item.ticket), "symbol": item.symbol, "type": int(item.type),
        "volume": float(item.volume), "price_open": float(item.price_open),
        "price_current": float(item.price_current), "sl": float(item.sl), "tp": float(item.tp),
        "profit": float(item.profit),
    } for item in items]}, 200


def decimal_places(value: Decimal) -> int:
    return max(0, -value.normalize().as_tuple().exponent)


def floor_volume(raw: float, info: Any) -> float:
    step = Decimal(str(info.volume_step or info.volume_min))
    minimum = Decimal(str(info.volume_min))
    maximum = Decimal(str(info.volume_max))
    amount = Decimal(str(raw))
    if amount < minimum:
        return 0.0
    normalized = (amount / step).to_integral_value(rounding=ROUND_FLOOR) * step
    normalized = min(maximum, normalized)
    return round(float(normalized), decimal_places(step))


def risk_lot(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    symbol = str(body.get("symbol") or "").strip()
    side = str(body.get("side") or "").lower()
    if side not in {"buy", "sell"}:
        return error("Direção deve ser buy ou sell")
    try:
        risk = float(body.get("risk_money", 0)); entry = float(body.get("entry", 0)); stop = float(body.get("stop", 0))
    except (TypeError, ValueError):
        return error("Dados de risco inválidos")
    info = mt5.symbol_info(symbol)
    if not info or risk <= 0 or entry <= 0 or stop <= 0 or entry == stop:
        return error("Informe símbolo, risco, entrada e stop válidos")
    if (side == "buy" and stop >= entry) or (side == "sell" and stop <= entry):
        return error("Stop está do lado incorreto da entrada")
    order_type = mt5.ORDER_TYPE_BUY if side == "buy" else mt5.ORDER_TYPE_SELL
    one_lot = mt5.order_calc_profit(order_type, symbol, 1.0, entry, stop)
    if one_lot is None or abs(one_lot) <= 0:
        return error("Corretora não retornou o risco para 1 lote", 503)
    raw = risk / abs(one_lot)
    lots = floor_volume(raw, info)
    if lots <= 0:
        return error(f"O lote mínimo ({info.volume_min}) excede o risco informado", 422)
    actual = mt5.order_calc_profit(order_type, symbol, lots, entry, stop)
    estimated = abs(float(actual)) if actual is not None else None
    if estimated is None or estimated > risk * 1.02:
        return error("Não foi possível respeitar o risco informado com o volume permitido", 422)
    account = account_data() or {}
    return {
        "ok": True, "symbol": symbol, "lot": lots, "risk_requested": risk,
        "risk_estimated": estimated, "currency": account.get("currency"),
        "volume_min": float(info.volume_min), "volume_max": float(info.volume_max),
        "volume_step": float(info.volume_step),
    }, 200


def candidate_order(body: dict[str, Any]) -> tuple[dict[str, Any] | None, tuple[dict[str, Any], int] | None]:
    symbol = str(body.get("symbol") or "").strip()
    side = str(body.get("side") or "").lower()
    try:
        requested_volume = float(body.get("volume", 0)); sl = float(body.get("sl", 0)); tp = float(body.get("tp", 0) or 0)
    except (TypeError, ValueError):
        return None, error("Volume/SL/TP inválido")
    if side not in {"buy", "sell"} or not symbol or requested_volume <= 0 or sl <= 0:
        return None, error("Informe símbolo, direção, volume e Stop Loss válidos")
    info = mt5.symbol_info(symbol)
    if info is None:
        return None, error("Símbolo não encontrado", 404)
    if not info.visible and not mt5.symbol_select(symbol, True):
        return None, error("Símbolo indisponível no Market Watch")
    volume = floor_volume(requested_volume, info)
    tolerance = max(1e-9, float(info.volume_step) / 1000)
    if volume <= 0 or abs(volume - requested_volume) > tolerance:
        return None, error(f"Lote deve respeitar mínimo {info.volume_min}, máximo {info.volume_max} e passo {info.volume_step}")
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        return None, error("Cotação indisponível", 503)
    is_buy = side == "buy"
    price = float(tick.ask if is_buy else tick.bid)
    if (is_buy and sl >= price) or (not is_buy and sl <= price):
        return None, error("Stop Loss está do lado incorreto do preço atual")
    if tp and ((is_buy and tp <= price) or (not is_buy and tp >= price)):
        return None, error("Take Profit está do lado incorreto do preço atual")
    minimum_distance = float(info.trade_stops_level or 0) * float(info.point or 0)
    if minimum_distance and abs(price - sl) < minimum_distance:
        return None, error("Stop Loss está mais próximo que o mínimo permitido pela corretora")
    deviation = min(max(int(body.get("deviation", 20)), 1), 100)
    return {
        "action": mt5.TRADE_ACTION_DEAL, "symbol": symbol, "volume": volume,
        "type": mt5.ORDER_TYPE_BUY if is_buy else mt5.ORDER_TYPE_SELL, "price": price,
        "sl": sl, "tp": tp, "deviation": deviation, "magic": MAGIC,
        "comment": "Signal Pro", "type_time": mt5.ORDER_TIME_GTC,
    }, None


def validated_order(body: dict[str, Any]) -> tuple[dict[str, Any] | None, Any | None, tuple[dict[str, Any], int] | None]:
    order, problem = candidate_order(body)
    if problem:
        return None, None, problem
    filling_modes = [mt5.ORDER_FILLING_IOC, mt5.ORDER_FILLING_FOK, mt5.ORDER_FILLING_RETURN]
    last = None
    for mode in dict.fromkeys(filling_modes):
        candidate = {**order, "type_filling": mode}
        checked = mt5.order_check(candidate)
        last = checked
        if checked is not None and int(checked.retcode) == 0:
            return candidate, checked, None
    message = getattr(last, "comment", "parâmetros rejeitados") if last is not None else "sem resposta"
    return None, last, error(f"Ordem reprovada pelo MT5: {message}", 422)


def daily_guard(account: dict[str, Any], order: dict[str, Any]) -> tuple[dict[str, Any], int] | None:
    if not account.get("is_demo"):
        return error("Execução bloqueada: somente contas DEMO", 403)
    if os.getenv("SIGNAL_PRO_TRADING_ENABLED", "false").lower() != "true":
        return error("Execução de ordens está OFF no Connector", 403)
    if kill_switch_file().exists():
        return error("Kill switch ativo", 403)
    max_risk_percent = min(max(float(os.getenv("SIGNAL_PRO_MAX_RISK_PERCENT", "1")), 0.1), 2.0)
    loss = mt5.order_calc_profit(order["type"], order["symbol"], order["volume"], order["price"], order["sl"])
    if loss is None or loss >= 0 or abs(float(loss)) > float(account["balance"]) * max_risk_percent / 100:
        return error(f"Risco da ordem excede {max_risk_percent:g}% da banca", 403)
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    deals = mt5.history_deals_get(today, datetime.now(timezone.utc)) or []
    own_deals = [deal for deal in deals if int(getattr(deal, "magic", 0)) == MAGIC]
    max_operations = min(max(int(os.getenv("SIGNAL_PRO_MAX_DAILY_OPERATIONS", "3")), 1), 20)
    operation_ids = {int(deal.position_id) for deal in own_deals if int(getattr(deal, "entry", -1)) == int(getattr(mt5, "DEAL_ENTRY_IN", 0))}
    if len(operation_ids) >= max_operations:
        return error("Limite diário de operações atingido", 403)
    realized = sum(float(getattr(deal, "profit", 0)) + float(getattr(deal, "commission", 0)) + float(getattr(deal, "swap", 0)) for deal in own_deals)
    max_daily_loss_percent = min(max(float(os.getenv("SIGNAL_PRO_MAX_DAILY_LOSS_PERCENT", "3")), 0.5), 10.0)
    if realized <= -float(account["balance"]) * max_daily_loss_percent / 100:
        return error("Limite diário de perda atingido", 403)
    return None


def order_check(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    order, checked, problem = validated_order(body)
    if problem:
        return problem
    safe_request = {key: value for key, value in order.items() if key != "comment"}
    return {"ok": True, "retcode": int(checked.retcode), "comment": checked.comment, "request": safe_request}, 200


def order_send(body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    if body.get("confirm") is not True:
        return error("Ordem não enviada: confirmação explícita ausente")
    idempotency_key = str(body.get("idempotency_key") or "").strip()
    if not idempotency_key or len(idempotency_key) > 128:
        return error("Chave de idempotência obrigatória")
    digest = hashlib.sha256(idempotency_key.encode()).hexdigest()
    if digest in IDEMPOTENCY:
        return {**IDEMPOTENCY[digest]["response"], "idempotent_replay": True}, 200
    account, problem = require_connected()
    if problem:
        return problem
    order, _checked, problem = validated_order(body)
    if problem:
        return problem
    guard = daily_guard(account, order)
    if guard:
        return guard
    result = mt5.order_send(order)
    if result is None:
        return error("Falha ao enviar ordem", 503)
    response = {
        "ok": int(result.retcode) == int(mt5.TRADE_RETCODE_DONE), "retcode": int(result.retcode),
        "comment": result.comment, "order": int(result.order), "deal": int(result.deal),
        "volume": float(result.volume), "price": float(result.price),
    }
    if response["ok"]:
        IDEMPOTENCY[digest] = {"created_at": time.time(), "response": response}
        persist_idempotency()
    return response, 200 if response["ok"] else 422


def execute(route: str, method: str, query: dict[str, Any], body: dict[str, Any]) -> tuple[dict[str, Any], int]:
    with MT5_LOCK:
        if route == "health":
            account = account_data(); return {"ok": True, "mt5_connected": account is not None, "account": account}, 200
        if route == "connect" and method == "POST": return connect_account(body)
        if route == "disconnect" and method == "POST": mt5.shutdown(); return {"ok": True}, 200
        _account, problem = require_connected()
        if problem: return problem
        if route == "broker-hint":
            needle = str(query.get("q") or "").strip().casefold(); account = account_data() or {}
            text = f"{account.get('company', '')} {account.get('server', '')}"
            hints = [{"broker": account.get("company") or "Corretora MT5", "server": account.get("server"), "source": "terminal"}] if not needle or needle in text.casefold() else []
            return {"ok": True, "hints": hints}, 200
        if route == "symbols": return list_symbols(str(query.get("q") or ""))
        if route == "candles": return candles(query)
        if route == "positions": return positions()
        if route == "risk/lot" and method == "POST": return risk_lot(body)
        if route == "order/check" and method == "POST": return order_check(body)
        if route == "order/send" and method == "POST": return order_send(body)
        return error("Endpoint desconhecido", 404)


def load_agent() -> dict[str, str]:
    try:
        data = json.loads(agent_file().read_text(encoding="utf-8"))
        if data.get("url") and data.get("token"):
            return {"url": str(data["url"]).rstrip("/"), "token": str(data["token"])}
    except (OSError, ValueError):
        pass
    return {}


def save_agent(url: str, token: str) -> None:
    target = agent_file(); target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(".tmp")
    temp.write_text(json.dumps({"url": url.rstrip("/"), "token": token}, indent=2), encoding="utf-8")
    os.replace(temp, target)


def pair_agent(url: str, code: str) -> dict[str, str]:
    response = requests.post(
        f"{url.rstrip('/')}/api/mt5/agent/pair",
        json={"code": code, "deviceName": f"{platform.node()} / {platform.system()}"}, timeout=15,
    )
    response.raise_for_status()
    data = response.json()
    save_agent(url, data["agentToken"])
    return {"url": url.rstrip("/"), "token": data["agentToken"]}


def cloud_loop(agent: dict[str, str], stop: threading.Event) -> None:
    headers = {"Authorization": f"Bearer {agent['token']}", "User-Agent": "SignalPro-MT5-Connector/1.2"}
    delay = 1
    while not stop.is_set():
        try:
            response = requests.post(f"{agent['url']}/api/mt5/agent/poll", headers=headers, timeout=35)
            if response.status_code == 401:
                LOG.error("Pareamento recusado. Gere um novo código no painel."); return
            if response.status_code == 204:
                delay = 1; continue
            response.raise_for_status()
            command = response.json().get("command")
            if not command:
                continue
            result, status = execute(
                str(command.get("route") or ""), str(command.get("method") or "GET"),
                command.get("query") or {}, command.get("payload") or {},
            )
            delivered = requests.post(
                f"{agent['url']}/api/mt5/agent/result", headers=headers,
                json={"id": command.get("id"), "status": status, "body": result}, timeout=15,
            )
            delivered.raise_for_status(); delay = 1
        except requests.RequestException as exc:
            LOG.warning("cloud_unavailable retry=%ss error=%s", delay, type(exc).__name__)
            stop.wait(delay); delay = min(delay * 2, 30)
        except Exception:
            LOG.exception("command_failed"); stop.wait(2)


def create_local_app(pair_token: str) -> Flask:
    app = Flask(__name__)

    @app.after_request
    def headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/api/pair")
    def local_pair():
        if request.remote_addr not in {"127.0.0.1", "::1"}:
            result, status = error("Pareamento disponível apenas localmente", 403)
            return jsonify(result), status
        return jsonify({"ok": True, "pair_token": pair_token})

    @app.route("/api/<path:route>", methods=["GET", "POST"])
    def local_api(route: str):
        supplied = request.headers.get("X-Signal-Pro-Pair", "")
        if not secrets.compare_digest(supplied, pair_token):
            return jsonify({"ok": False, "error": "Connector não pareado"}), 401
        result, status = execute(route, request.method, request.args.to_dict(), request.get_json(silent=True) or {})
        return jsonify(result), status

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument("--cloud-url", default=os.getenv("SIGNAL_PRO_CLOUD_URL", "https://signalpro.ativasite.com.br"))
    parser.add_argument("--pair-code", default="")
    parser.add_argument("--local-api", action="store_true", help="Também habilita API somente em 127.0.0.1")
    args = parser.parse_args()
    logging.basicConfig(level=os.getenv("SIGNAL_PRO_LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
    load_idempotency()
    agent = load_agent()
    if args.pair_code:
        agent = pair_agent(args.cloud_url, args.pair_code)
        print("Connector pareado com sucesso. O token do dispositivo foi salvo no perfil do Windows.")
    if not agent:
        parser.error("gere um código no painel e execute novamente com --pair-code 12345678")
    stop = threading.Event()
    worker = threading.Thread(target=cloud_loop, args=(agent, stop), daemon=True, name="signal-pro-cloud")
    worker.start()
    LOG.info("Connector ativo em modo cloud; somente conexões HTTPS de saída")
    if args.local_api:
        pair_token = os.getenv("SIGNAL_PRO_PAIR_TOKEN") or secrets.token_urlsafe(32)
        create_local_app(pair_token).run(host="127.0.0.1", port=int(os.getenv("SIGNAL_PRO_PORT", "8765")), debug=False, threaded=False)
    else:
        try:
            while worker.is_alive(): worker.join(timeout=1)
        except KeyboardInterrupt:
            stop.set(); worker.join(timeout=5)
        finally:
            with MT5_LOCK: mt5.shutdown()


if __name__ == "__main__":
    main()
