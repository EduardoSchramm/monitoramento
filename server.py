
# ============================================================
# server.py — versão final completa (atualizada)
# Status baseado exclusivamente no Nagios (statusjson.cgi)
# Estrutura consolidada + reload automático + API /api/status
# ============================================================
import os
import time
import unicodedata
import requests
import pandas as pd
import getpass
from flask import Flask, jsonify, send_from_directory

# -------------------------------
# CONFIGURAÇÃO DE CAMINHOS
# -------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROMOTORIAS_FILE = os.path.join(BASE_DIR, "Promotorias.xlsx")
HOSTS_FILE = os.path.join(BASE_DIR, "Host_nagiosmpls.xlsx")
NAGIOS_URL = "http://nagiosmpls.mp.rs.gov.br/nagios/cgi-bin/statusjson.cgi"

# -------------------------------
# LOGIN MANUAL NO NAGIOS
# -------------------------------
print("=== Login no Nagios ===")
NAGIOS_USER = input("Usuário: ").strip()
NAGIOS_PASS = getpass.getpass("Senha: ").strip()
session = requests.Session()
app = Flask(__name__, static_folder="static")

# -------------------------------
# FUNÇÕES DE NORMALIZAÇÃO
# -------------------------------

def strip_nbsp(s: str) -> str:
    if not isinstance(s, str):
        return ""
    return s.replace(" ", " ").strip()


def normalize(s: str) -> str:
    s = strip_nbsp(s)
    s = s.lower().replace("_", " ")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return " ".join(s.split())


def find_col(df: pd.DataFrame, keywords):
    cols = list(df.columns)
    norm = {c: normalize(str(c)) for c in cols}
    for c, n in norm.items():
        for kw in keywords:
            if kw in n:
                return c
    return None

# -------------------------------
# CARREGAMENTO DAS PLANILHAS (ajustado)
# -------------------------------

def load_data():
    prom = pd.read_excel(PROMOTORIAS_FILE, engine="openpyxl")
    hosts = pd.read_excel(HOSTS_FILE, engine="openpyxl")

    col_mun = find_col(prom, ["municipio"])  # município de referência
    col_lat = find_col(prom, ["latitude"])   # latitude oficial
    col_lng = find_col(prom, ["longitude"])  # longitude oficial
    col_host = find_col(hosts, ["host"])     # host monitorado no Nagios

    if not all([col_mun, col_lat, col_lng]):
        raise Exception(f"Colunas não encontradas na planilha Promotorias.xlsx: {prom.columns.tolist()}")
    if not col_host:
        raise Exception(f"Coluna 'Host' não encontrada em Host_nagiosmpls.xlsx: {hosts.columns.tolist()}")

    # Chaves normalizadas — mas lat/lng SEMPRE vindos da planilha de Promotorias
    prom["key_mun"] = prom[col_mun].astype(str).apply(normalize)
    # Se a planilha de hosts possuir alguma coluna que identifique município, detectar; senão, usar o próprio host como chave
    col_municipio_hosts = find_col(hosts, ["municipio"])  # opcional
    if col_municipio_hosts:
        hosts["key_mun"] = hosts[col_municipio_hosts].astype(str).apply(normalize)
    else:
        # fallback: usar o próprio host normalizado como pseudo-chave (não afeta lat/lng, só tentativa de parear)
        hosts["key_mun"] = hosts[col_host].astype(str).apply(normalize)

    # LEFT JOIN preservando todas as promotorias e APENAS acrescentando o host quando houver correspondência
    merged = prom.merge(
        hosts[[col_host, "key_mun"]],
        on="key_mun",
        how="left",
        validate="m:1"  # cada município mapeia no máximo 1 host
    )

    # Monta lista final priorizando lat/lng e município da planilha Promotorias.xlsx
    lista = []
    for _, row in merged.iterrows():
        host_val = strip_nbsp(str(row[col_host])) if pd.notna(row[col_host]) else None
        if not host_val:
            # pula registros sem host mapeado para o Nagios
            continue
        try:
            lat = float(row[col_lat])
            lng = float(row[col_lng])
        except Exception:
            # se lat/lng inválidos, pula
            continue
        lista.append({
            "nome": strip_nbsp(str(row[col_mun])),  # município
            "lat": lat,                              # PRIORIDADE: Promotorias.xlsx
            "lng": lng,                              # PRIORIDADE: Promotorias.xlsx
            "host": host_val                         # host do Nagios
        })
    return lista

# Carregamento inicial
PROMOTORIAS = load_data()
PROMOTORIAS_MTIME = os.path.getmtime(PROMOTORIAS_FILE)
HOSTS_MTIME = os.path.getmtime(HOSTS_FILE)

# -------------------------------
# RELOAD AUTOMÁTICO DAS PLANILHAS
# -------------------------------

def reload_if_needed():
    global PROMOTORIAS, PROMOTORIAS_MTIME, HOSTS_MTIME
    prom_mtime_now = os.path.getmtime(PROMOTORIAS_FILE)
    hosts_mtime_now = os.path.getmtime(HOSTS_FILE)
    if prom_mtime_now != PROMOTORIAS_MTIME or hosts_mtime_now != HOSTS_MTIME:
        print("Detectada alteração nas planilhas. Recarregando dados...")
        PROMOTORIAS = load_data()
        PROMOTORIAS_MTIME = prom_mtime_now
        HOSTS_MTIME = hosts_mtime_now
    return PROMOTORIAS

# -------------------------------
# CONSULTA AO NAGIOS — JSON REAL
# -------------------------------

def estado_nagios(host: str) -> str:
    """
    Retorna UP, DOWN, WARNING, UNKNOWN
    seguindo os códigos do Nagios:
    2 = UP
    4 = DOWN
    0 = UNKNOWN
    outros = WARNING
    """
    try:
        url = f"{NAGIOS_URL}?query=host&hostname={host}"
        r = session.get(url, auth=(NAGIOS_USER, NAGIOS_PASS), timeout=8)
        r.raise_for_status()
        data = r.json()
        hostdata = data.get("data", {}).get("host")
        if not hostdata:
            return "UNKNOWN"
        raw_code = int(hostdata.get("status", -1))
        if raw_code == 2:
            return "UP"
        if raw_code == 4:
            return "DOWN"
        if raw_code == 0:
            return "UNKNOWN"
        return "WARNING"
    except Exception:
        return "UNKNOWN"


def _format_duration_dhms(seconds: int) -> str:
    # Formata como: 2d 03h 15m 42s (omitindo dias se 0)
    if seconds < 0:
        seconds = 0
    d, rem = divmod(seconds, 86400)
    h, rem = divmod(rem, 3600)
    m, s = divmod(rem, 60)
    parts = []
    if d:
        parts.append(f"{d}d")
    parts.append(f"{h:02d}h")
    parts.append(f"{m:02d}m")
    parts.append(f"{s:02d}s")
    return " ".join(parts)


def detalhes_nagios(host: str) -> dict:
    """
    Coleta detalhes do host conforme JSON oficial.
    duration_ms: agora calculado como max(now - last_time_down, 0)
    e também retorna last_downtime_duration_human no formato d h m s
    """
    try:
        url = f"{NAGIOS_URL}?query=host&hostname={host}"
        r = session.get(url, auth=(NAGIOS_USER, NAGIOS_PASS), timeout=8)
        r.raise_for_status()
        data = r.json()
        hostdata = data.get("data", {}).get("host", {}) or {}
        last_time_down = int(hostdata.get("last_time_down", 0) or 0)
        last_time_up = int(hostdata.get("last_time_up", 0) or 0)

        # <<< ALTERAÇÃO PEDIDA >>>
        # Em vez de: duration_ms = max(last_time_up - last_time_down, 0)
        # Usar o mtime (tempo atual) - last_time_down para refletir duração corrente.
        now_sec = int(time.time())
        duration_sec = max(now_sec - last_time_down, 0)
        duration_ms = duration_sec  # mantendo o mesmo nome de campo (valores em segundos)
        duration_human = _format_duration_dhms(duration_sec)

        return {
            "is_flapping": bool(hostdata.get("is_flapping", False)),
            "last_time_down": last_time_down,
            "last_time_up": last_time_up,
            "last_downtime_duration_ms": duration_ms,
            "last_downtime_duration_human": duration_human,
            "plugin_output": hostdata.get("plugin_output", "") or "",
        }
    except Exception:
        return {
            "is_flapping": False,
            "last_time_down": 0,
            "last_time_up": 0,
            "last_downtime_duration_ms": 0,
            "last_downtime_duration_human": "00h 00m 00s",
            "plugin_output": "",
        }

# -------------------------------
# FUNÇÃO CONSOLIDADA PARA A API
# -------------------------------

def get_host_info(host: str) -> dict:
    status = estado_nagios(host)
    det = detalhes_nagios(host)
    return {
        "status": status,  # campo principal
        "status_nagios": status,  # alias
        "plugin_output": det["plugin_output"],
        "is_flapping": det["is_flapping"],
        "last_time_down": det["last_time_down"],
        "last_time_up": det["last_time_up"],
        "last_downtime_duration_ms": det["last_downtime_duration_ms"],
        "last_downtime_duration_human": det["last_downtime_duration_human"],
    }

# -------------------------------
# API /api/status
# -------------------------------
_cache = {"ts": 0.0, "data": None}
CACHE_SECONDS = 10

@app.route("/api/status")
def api_status():
    now = time.time()
    # Cache simples de 10s
    if _cache["data"] is not None and (now - _cache["ts"] < CACHE_SECONDS):
        return jsonify(_cache["data"])

    lista = reload_if_needed()
    out = []
    for p in lista:
        info = get_host_info(p["host"])
        out.append({
            "nome": p["nome"],
            "lat": p["lat"],
            "lng": p["lng"],
            "host": p["host"],
            **info
        })

    _cache["data"] = out
    _cache["ts"] = now
    return jsonify(out)

# -------------------------------
# ROTAS ESTÁTICAS
# -------------------------------
@app.route("/")
def root():
    return send_from_directory("static", "index.html")

@app.route("/<path:path>")
def static_proxy(path):
    return send_from_directory("static", path)

# -------------------------------
# EXECUÇÃO
# -------------------------------
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8080, debug=False)
