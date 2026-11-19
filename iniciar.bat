@echo off
rem Arranca la web del traductor secreto en http://localhost:5173
cd /d "%~dp0"
start "" http://localhost:5173
python -m http.server 5173 --bind 127.0.0.1
