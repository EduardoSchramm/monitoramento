
# server.py (login manual + reload automático)

import os
import time
import unicodedata
import requests
import pandas as pd
import getpass
from flask import Flask, jsonify, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

PROMOTORIAS_FILE = os.path.join(BASE_DIR, 'Promotorias.xlsx')
HOSTS_FILE = os.path.join(BASE_DIR, 'Host_nagiosmpls.xlsx')

NAGIOS_URL = 'http://nagiosmpls.mp.rs.gov.br/nagios/cgi-bin/statusjson.cgi'


# ============================================================
# LOGIN MANUAL NO NAGIOS
# ============================================================

print("\n=== Login no Nagios ===")
NAGIOS_USER = input("Usuário: ").strip()
NAGIOS_PASS = getpass.getpass("Senha: ").strip()
NAGIOS_COOKIE = None  # Sempre ignorado

session = requests.Session()

app = Flask(__name__, static_folder='static')


# ============================================================
# FUNÇÕES DE NORMALIZAÇÃO
# ============================================================

def strip_nbsp(s: str) -> str:
    if not isinstance(s, str):
        return ''
    return s.replace('\xa0', ' ').strip()

def normalize(s: str) -> str:
    s = strip_nbsp(s)
    s = s.lower().replace('_', ' ')
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(ch for ch in s if not unicodedata.combining(ch))
    return ' '.join(s.split())

def find_col(df: pd.DataFrame, keywords):
    cols = list(df.columns)
    norm = {c: normalize(str(c)) for c in cols}
    for c, n in norm.items():
        for kw in keywords:
            if kw in n:
                return c
    return None


# ============================================================
# CARREGAMENTO DAS PLANILHAS
# ============================================================

def load_data():
    prom = pd.read_excel(PROMOTORIAS_FILE, engine='openpyxl')
    hosts = pd.read_excel(HOSTS_FILE, engine='openpyxl')

    col_mun = find_col(prom, ['municipio'])
    col_lat = find_col(prom, ['latitude'])
    col_lng = find_col(prom, ['longitude'])
    col_sts = find_col(prom, ['status'])

    if not all([col_mun, col_lat, col_lng]):
        raise Exception(f'Colunas não encontradas em Promotorias.xlsx. Colunas: {prom.columns.tolist()}')

    col_host = find_col(hosts, ['host'])
    if not col_host:
        raise Exception(f"Coluna 'Host' não encontrada em Host_nagiosmpls.xlsx. Colunas: {hosts.columns.tolist()}")

    prom['key'] = prom[col_mun].astype(str).apply(normalize)
    hosts['key'] = hosts[col_host].astype(str).apply(normalize)

    merged = prom.merge(hosts[[col_host, 'key']], on='key', how='inner')

    lista = []
    for _, row in merged.iterrows():
        lista.append({
            'nome': strip_nbsp(str(row[col_mun])),
            'lat': float(row[col_lat]),
            'lng': float(row[col_lng]),
            'status_local': strip_nbsp(str(row[col_sts])) if col_sts else 'UP',
            'host': strip_nbsp(str(row[col_host]))
        })

    return lista


# Carregamento inicial
PROMOTORIAS = load_data()

# Controle de mtime para reload automático
PROMOTORIAS_MTIME = os.path.getmtime(PROMOTORIAS_FILE)
HOSTS_MTIME = os.path.getmtime(HOSTS_FILE)


def reload_if_needed():
    global PROMOTORIAS, PROMOTORIAS_MTIME, HOSTS_MTIME

    prom_mtime_now = os.path.getmtime(PROMOTORIAS_FILE)
    hosts_mtime_now = os.path.getmtime(HOSTS_FILE)

    if prom_mtime_now != PROMOTORIAS_MTIME or hosts_mtime_now != HOSTS_MTIME:
        print("\n🔄 Detectada alteração nas planilhas. Recarregando dados...")
        PROMOTORIAS = load_data()
        PROMOTORIAS_MTIME = prom_mtime_now
        HOSTS_MTIME = hosts_mtime_now

    return PROMOTORIAS


# ============================================================
# CONSULTA AO NAGIOS
# ============================================================



def map_status(code: int) -> str:
    """
    Mapeamento solicitado:
      2 -> UP
      4 -> DOWN
      0 -> UNKNOW
      demais -> WARNING
    """
    if code == 2:
        return "UP"
    if code == 4:
        return "DOWN"
    if code == 0:
        return "UNKNOW"
    return "WARNING"


def estado_nagios(host: str) -> str:
    """
    Consulta o Nagios corretamente no caminho:
         data["data"]["host"]["status"]
    E aplica o mapeamento acima.
    """

    try:
        url = f"{NAGIOS_URL}?query=host&hostname={host}"

        r = session.get(url, auth=(NAGIOS_USER, NAGIOS_PASS), timeout=8)
        r.raise_for_status()

        data = r.json()

        # CAMINHO CORRETO NA RESPOSTA DO NAGIOS
        hostdata = data.get("data", {}).get("host")

        if not hostdata:
            return "UNKNOWN"

        raw = hostdata.get("status")

        if raw is None:
            return "UNKNOWN"

        code = int(raw)
        return map_status(code)

    except Exception as e:
        # Se qualquer erro ocorrer, retorne UNKNOWN
        return "UNKNOWN"

       


def detalhes_nagios(host: str) -> dict:
    """
    Consulta o mesmo endpoint do Nagios e retorna detalhes adicionais do host:
    - is_flapping (bool)
    - last_time_down (ms epoch)
    - last_time_up (ms epoch)
    - last_downtime_duration_ms (ms) = max(last_time_up - last_time_down, 0)
    - plugin_output (str)
    """
    try:
        url = f"{NAGIOS_URL}?query=host&hostname={host}"
        r = session.get(url, auth=(NAGIOS_USER, NAGIOS_PASS), timeout=8)
        r.raise_for_status()
        data = r.json()
        hostdata = data.get("data", {}).get("host", {}) or {}

        is_flapping = bool(hostdata.get("is_flapping", False))
        last_time_down = int(hostdata.get("last_time_down", 0) or 0)
        last_time_up = int(hostdata.get("last_time_up", 0) or 0)
        plugin_output = hostdata.get("plugin_output", "") or ""

        # duração do último período de indisponibilidade
        # (se o host já voltou, last_time_up > last_time_down)
        duration_ms = last_time_up - last_time_down
        if duration_ms < 0:
            duration_ms = 0

        return {
            "is_flapping": is_flapping,
            "last_time_down": last_time_down,
            "last_time_up": last_time_up,
            "last_downtime_duration_ms": duration_ms,
            "plugin_output": plugin_output
        }
    except Exception:
        # Falhou a coleta dos detalhes — devolve valores neutros
        return {
            "is_flapping": False,
            "last_time_down": 0,
            "last_time_up": 0,
            "last_downtime_duration_ms": 0,
            "plugin_output": ""
        }

#STATE_MAP = {
#    0: 'OK',
#    1: 'WARNING',
#    2: 'CRITICAL',
#    3: 'UNKNOWN'
#}

#def estado_nagios(host: str) -> str:
#    try:
#        url = f"{NAGIOS_URL}?query=host&hostname={host}"
#        r = session.get(url, auth=(NAGIOS_USER, NAGIOS_PASS), timeout=6)
#        r.raise_for_status()

#        data = r.json()
#        state = int(data.get('data', {}).get('hoststatus', {}).get('current_state', 3))

#        return STATE_MAP.get(state, 'UNKNOWN')#

#    except Exception:
#        return 'UNKNOWN'


# ============================================================
# API
# ============================================================

_cache = {'ts': 0.0, 'data': None}
CACHE_SECONDS = 10


@app.route('/api/status')
def api_status():
    now = time.time()

    # Cache de 10 segundos
    if _cache['data'] is not None and (now - _cache['ts'] < CACHE_SECONDS):
        return jsonify(_cache['data'])

    lista = reload_if_needed()

    out = []
    for p in lista:
        st = estado_nagios(p['host'])
        out.append({
            'nome': p['nome'],
            'lat': p['lat'],
            'lng': p['lng'],
            'host': p['host'],
            'status_local': p['status_local'],
            'status_nagios': st,
            # ---- novos campos ----
            'is_flapping': det['is_flapping'],
            'last_time_down': det['last_time_down'],
            'last_time_up': det['last_time_up'],
            'last_downtime_duration_ms': det['last_downtime_duration_ms'],
            'plugin_output': det['plugin_output'],
 
        })

    _cache['data'] = out
    _cache['ts'] = now

    return jsonify(out)


# ============================================================
# ROTAS ESTÁTICAS
# ============================================================

@app.route('/')
def root():
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def static_proxy(path):
    return send_from_directory('static', path)


# ============================================================
# RUN
# ============================================================

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=8080, debug=False)
