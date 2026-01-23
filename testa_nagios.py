
import requests
import getpass
import json

NAGIOS_URL = "http://nagiosmpls.mp.rs.gov.br/nagios/cgi-bin/statusjson.cgi"

print("\n=== Teste de Host no Nagios ===")
usuario = input("Usuário: ").strip()
senha = getpass.getpass("Senha: ").strip()

host = input("Hostname Nagios para testar: ").strip()

url = f"{NAGIOS_URL}?query=host&hostname={host}"

print(f"\nConsultando: {url}\n")

try:
    r = requests.get(url, auth=(usuario, senha), timeout=10)
    print("Status HTTP:", r.status_code)

    # Verificar se a resposta é JSON ou HTML da página de login
    content_type = r.headers.get("Content-Type", "")
    print("Content-Type:", content_type)

    if "html" in content_type.lower():
        print("\n❌ ERRO: O Nagios devolveu HTML em vez de JSON.")
        print("Provável problema de autenticação (cookie, usuário ou permissão).")
        print("\nTrecho da resposta:\n")
        print(r.text[:500])
        exit()

    data = r.json()
    print("\nJSON recebido do Nagios:\n")
    print(json.dumps(data, indent=4))

    state = data.get("data", {}).get("hoststatus", {}).get("current_state", None)

    if state is None:
        print("\n⚠ O Nagios não retornou current_state para esse hostname.")
        print("Provavelmente o hostname não existe no Nagios.")
    else:
        print(f"\nEstado encontrado: {state}")

except Exception as e:
    print("\n❌ EXCEÇÃO OCORREU:")
    print(e)
