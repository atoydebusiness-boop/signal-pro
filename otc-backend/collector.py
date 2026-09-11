"""Signal Pro OTC collector.

Read-only market-data adapter. It never calls buy/sell/order methods.
Credentials are entered locally and are used only by PyQuotex to authenticate
with Quotex; this script never sends or stores them in Signal Pro/GitHub.
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
HOSTS = [
    h.strip()
    for h in os.getenv(
        "QUOTEX_HOSTS",
        "qxbroker.com,quotex.com,qxbroker.io,quotex.io,qxbroker.sqldb.tc",
    ).split(",")
    if h.strip()
]


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
    print("O login e usado localmente pelo PyQuotex para autenticar na Quotex.")
    print("O Signal Pro nao recebe nem armazena seu email/senha.")
    email = input("Email da Quotex: ").strip()
    password = getpass.getpass("Senha da Quotex (nao aparece na tela): ")
    if not email or not password:
        raise SystemExit("Email/senha nao informados. Encerrando sem conectar.")
    return email, password


async def close_client(client):
    if not client:
        return
    try:
        await client.close()
    except Exception:
        pass


async def connect_read_only(email, password):
    print("\n[Signal Pro] diagnostico de conexao DEMO (somente dados)")
    print("[Signal Pro] Nenhuma ordem sera enviada.\n")

    failures = []
    for host in HOSTS:
        client = None
        print(f"[TESTE] {host} ...", end=" ", flush=True)
        try:
            client = Quotex(email=email, password=password, lang="pt", host=host)
            # PyQuotex 1.1.x accepts the demo flag on connect in the current API.
            try:
                result = await asyncio.wait_for(client.connect(is_demo=True), timeout=20)
            except TypeError:
                # Compatibility with releases where demo is selected through account_is_demo.
                client.account_is_demo = 1
                result = await asyncio.wait_for(client.connect(), timeout=20)

            ok = result[0] if isinstance(result, tuple) else bool(result)
            reason = result[1] if isinstance(result, tuple) and len(result) > 1 else str(result)
            if ok:
                print("OK - conectado")
                return client, host

            print(f"FALHOU - {reason}")
            failures.append((host, reason))
        except asyncio.TimeoutError:
            print("FALHOU - timeout")
            failures.append((host, "timeout"))
        except Exception as exc:
            reason = str(exc) or exc.__class__.__name__
            print(f"FALHOU - {reason}")
            failures.append((host, reason))
        await close_client(client)

    print("\n[Signal Pro] Nenhum host suportado conectou.")
    print("[Signal Pro] Diagnostico:")
    for host, reason in failures:
        print(f"  - {host}: {reason}")
    print("[Signal Pro] Nao vamos tentar contornar bloqueios/Cloudflare automaticamente.")
    return None, None


async def main():
    if not SECRET:
        raise SystemExit("Configure OTC_INGEST_SECRET localmente antes de executar.")

    email, password = local_credentials()
    client = None
    try:
        client, host = await connect_read_only(email, password)
        if client is None:
            raise SystemExit(2)

        print(f"\n[Signal Pro] usando {host}. Buscando M1 de {ASSET}...")
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
        await close_client(client)


if __name__ == "__main__":
    asyncio.run(main())
