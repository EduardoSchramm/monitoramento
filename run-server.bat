@echo off
cd /d %~dp0
py -3 -m venv venv
call venv\Scripts\activate
pip install -r requirements.txt
server.py
pause
