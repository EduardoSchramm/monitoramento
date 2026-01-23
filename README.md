# Mapa das Promotorias – Pacote v2 (simulação local)

## Como usar
1. Extraia este ZIP para `C:\monitoramento_promotorias` (ou outra pasta à sua escolha).
2. No PowerShell:
```
py -3 -m venv venv
./venv/Scripts/activate
pip install -r requirements.txt
python server.py
```
3. Abra o navegador em: http://localhost:8080/

## Dados reais
Substitua `Promotorias.xlsx` e `Host_nagiosmpls.xlsx` pelos arquivos oficiais. O servidor lê as planilhas na inicialização.

## Autenticação do Nagios (opcional)
Se necessário, defina variáveis de ambiente antes de iniciar o servidor:
```
$env:NAGIOS_USER="usuario"
$env:NAGIOS_PASS="senha"
# ou use cookie de sessão
$env:NAGIOS_COOKIE="nagios_session=..."
```
