"""Signal Pro OTC collector.

Read-only market-data adapter. It never calls buy/sell/order methods.
Authentication is entered locally at runtime and is never written by this script.
"""
import asyncio
import getpass
import json
import os
import time
import urllib.request

from pyquotex.stable_api import Quotex

ASSET = os.getenv("OTC_TEST_ASSET", "EURUSD_otc")
BACKEND = os.getenv("OTC_BACKEND_URL", os.getenv("SIGNAL_PRO_OTC_BACKEND", "http://127.0.0.1:8787")).rstrip("/")
SECRET = os.getenv("OTC_INGEST_SECRET", "")
HOST = os.getenv("QUOTEX_HOST", "qxbroker.com")


def post_candles(asset, candles):
    payload = json.dumps({"asset": asset, "candles": candles}).encode()
    req = urllib.request.Request(
        BACKEND + "/candles",
        data=payload,
        headers={"content-type": "application/json", "x-signal-pro-secret": SECRET},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def normalize_closed(candles):
    current_minute = int(time.time() // 60) * 60
    out = []
    for raw in candles or []:
        try:
            ts = int(float(raw.get("time", 0)))
            if ts > 10**12:
                ts //= 1000
            ts = (ts // 60) * 60
            if ts >= current_minute:
                continue
            out.append({
                "time": ts,
                "open": float(raw["open"]),
                "high": float(raw["high"]),
                "low": float(raw["low"]),
                "close": float(raw["close"]),
            })
        except (KeyError, TypeError, ValueError):
            continue
    unique = {c["time"]: c for c in out}
    return [unique[k] for k in sorted(unique)][-200:]


def local_credentials():
    print("\n=== Signal Pro OTC - autenticacao local ===")
    print("Os dados abaixo ficam somente neste processo e nao sao enviados ao Signal Pro.")
    email = input("Email da Quotex: ").strip()
    password = getpass.getpass("Senha da Quotex (nao aparece na tela): ")
    if not email or not password:
        raise SystemExit("Email/senha nao informados. Encerrando sem conectar.")
    return email, password


async def main():
    if not SECRET:
        raise SystemExit("Configure OTC_INGEST_SECRET localmente antes de executar.")

    email, password = local_credentials()
    print(f"[Signal Pro] conectando em {HOST} somente para dados...")
    client = Quotex(email=email, password=password, lang="pt", host=HOST)
    try:
        result = await client.connect()
        if isinstance(result, tuple) and not result[0]:
            raise RuntimeError(f"falha na conexao: {result[1]}")
        print(f"[Signal Pro] conectado. Buscando M1 de {ASSET}...")
        candles = await client.get_candles(
            asset=ASSET,
            end_from_time=time.time(),
            offset=60 * 200,
            period=60,
        )
        closed = normalize_closed(candles)
        print(f"[Signal Pro] recebidas={len(candles or [])} fechadas_validas={len(closed)}")
        if len(closed) < 60:
            raise RuntimeError("historico insuficiente para o motor de sinais")
        response = await asyncio.to_thread(post_candles, ASSET, closed)
        print("[Signal Pro] backend:", json.dumps(response, ensure_ascii=False))
        print("[Signal Pro] TESTE OK. Nenhuma ordem foi enviada.")
    finally:
        password = None
        try:
            await client.close()
        except Exception:
            pass


if __name__ == "__main__":
    asyncio.run(main())
