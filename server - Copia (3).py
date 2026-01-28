# ============================================================
#  server.py — versão final completa
#  Status baseado exclusivamente no Nagios (statusjson.cgi)
#  Estrutura consolidada + reload automático + API /api/status
# ============================================================

import os
import time
import unicodedata
import requests
import pandas as pd
import getpass
from flask import Flask, jsonify, send_from_directory

# ------------------------------------------------------------
#  CONFIGURAÇÃO DE CAMINHOS
# ------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROMOTORIAS_FILE = os.path.join(BASE_DIR, "Promotorias.xlsx")
HOSTS_FILE       = os.path.join(BASE_DIR, "Host_nagiosmpls.xlsx")
NAGIOS_URL       = "http://nagiosmpls.mp.rs.gov.br/nagios/cgi-bin/statusjson.cgi"

# ------------------------------------------------------------
#  LOGIN MANUAL NO NAGIOS
# ------------------------------------------------------------
print("\n=== Login no Nagios ===")
NAGIOS_USER = input("Usuário: ").strip()
NAGIOS_PASS = getpass.getpass("Senha: ").strip()

session = requests.Session()

app = Flask(__name__, static_folder="static")

# ------------------------------------------------------------
#  FUNÇÕES DE NORMALIZAÇÃO
# ------------------------------------------------------------
def strip_nbsp(s: str) -> str:
    if not isinstance(s, str):
        return ""
    return s.replace("\xa0", " ").strip()

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

# ------------------------------------------------------------
#  CARREGAMENTO DAS PLANILHAS (sem status_local)
# ------------------------------------------------------------
def load_data():
    prom  = pd.read_excel(PROMOTORIAS_FILE, engine="openpyxl")
    hosts = pd.read_excel(HOSTS_FILE,       engine="openpyxl")

    col_mun = find_col(prom,  ["municipio"])
    col_lat = find_col(prom,  ["latitude"])
    col_lng = find_col(prom,  ["longitude"])
    col_host = find_col(hosts, ["host"])

    if not all([col_mun, col_lat, col_lng]):
        raise Exception(f"Colunas não encontradas na planilha Promotorias.xlsx: {prom.columns.tolist()}")

    if not col_host:
        raise Exception(f"Coluna 'Host' não encontrada em Host_nagiosmpls.xlsx: {hosts.columns.tolist()}")

    prom["key"]  = prom[col_mun].astype(str).apply(normalize)
    hosts["key"] = hosts[col_host].astype(str).apply(normalize)

    merged = prom.merge(
        hosts[[col_host, "key"]],
        on="key",
        how="inner"
    )

    lista = []
    for _, row in merged.iterrows():
        lista.append({
            "nome": strip_nbsp(str(row[col_mun])),
            "lat":  float(row[col_lat]),
            "lng":  float(row[col_lng]),
            "host": strip_nbsp(str(row[col_host])),
        })

    return lista


# Carregamento inicial
PROMOTORIAS = load_data()
PROMOTORIAS_MTIME = os.path.getmtime(PROMOTORIAS_FILE)
HOSTS_MTIME       = os.path.getmtime(HOSTS_FILE)

# ------------------------------------------------------------
#  RELOAD AUTOMÁTICO DAS PLANILHAS
# ------------------------------------------------------------
def reload_if_needed():
    global PROMOTORIAS, PROMOTORIAS_MTIME, HOSTS_MTIME

    prom_mtime_now  = os.path.getmtime(PROMOTORIAS_FILE)
    hosts_mtime_now = os.path.getmtime(HOSTS_FILE)

    if prom_mtime_now != PROMOTORIAS_MTIME or hosts_mtime_now != HOSTS_MTIME:
        print("\n🔄 Detectada alteração nas planilhas. Recarregando dados...")
        PROMOTORIAS       = load_data()
        PROMOTORIAS_MTIME = prom_mtime_now
        HOSTS_MTIME       = hosts_mtime_now

    return PROMOTORIAS


# ------------------------------------------------------------
#  CONSULTA AO NAGIOS — JSON REAL
# ------------------------------------------------------------
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
        r   = session.get(url, auth=(NAGIOS_USER, NAGIOS_PASS), timeout=8)
        r.raise_for_status()

        data     = r.json()
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


def detalhes_nagios(host: str) -> dict:
    """
    Coleta detalhes do host conforme JSON oficial.
    """

    try:
        url = f"{NAGIOS_URL}?query=host&hostname={host}"
        r   = session.get(url, auth=(NAGIOS_USER, NAGIOS_PASS), timeout=8)
        r.raise_for_status()

        data     = r.json()
        hostdata = data.get("data", {}).get("host", {}) or {}

        last_time_down = int(hostdata.get("last_time_down", 0) or 0)
        last_time_up   = int(hostdata.get("last_time_up",   0) or 0)

        duration_ms = max(last_time_up - last_time_down, 0)

        return {
            "is_flapping":               bool(hostdata.get("is_flapping", False)),
            "last_time_down":            last_time_down,
            "last_time_up":              last_time_up,
            "last_downtime_duration_ms": duration_ms,
            "plugin_output":             hostdata.get("plugin_output", "") or "",
        }

    except Exception:
        return {
            "is_flapping": False,
            "last_time_down": 0,
            "last_time_up": 0,
            "last_downtime_duration_ms": 0,
            "plugin_output": "",
        }


# ------------------------------------------------------------
#  FUNÇÃO CONSOLIDADA PARA A API
# ------------------------------------------------------------
def get_host_info(host: str) -> dict:
    status = estado_nagios(host)
    det    = detalhes_nagios(host)

    return {
        "status":        status,    # campo principal
        "status_nagios": status,    # alias
        "plugin_output": det["plugin_output"],
        "is_flapping":   det["is_flapping"],
        "last_time_down":            det["last_time_down"],
        "last_time_up":              det["last_time_up"],
        "last_downtime_duration_ms": det["last_downtime_duration_ms"],
    }


# ------------------------------------------------------------
#  API /api/status
# ------------------------------------------------------------
_cache = {"ts": 0.0, "data": None}
CACHE_SECONDS = 10

@app.route("/api/status")
def api_status():
    now = time.time()

    # Cache simples de 10s
    if _cache["data"] is not None and (now - _cache["ts"] < CACHE_SECONDS):
        return jsonify(_cache["data"])

    lista = reload_if_needed()
    out   = []

    for p in lista:
        info = get_host_info(p["host"])

        out.append({
            "nome": p["nome"],
            "lat":  p["lat"],
            "lng":  p["lng"],
            "host": p["host"],
            **info
        })

    _cache["data"] = out
    _cache["ts"]   = now

    return jsonify(out)


# ------------------------------------------------------------
#  ROTAS ESTÁTICAS
# ------------------------------------------------------------
@app.route("/")
def root():
    return send_from_directory("static", "index.html")

@app.route("/<path:path>")
def static_proxy(path):
    return send_from_directory("static", path)


# ------------------------------------------------------------
#  EXECUÇÃO
# ------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8080, debug=False)