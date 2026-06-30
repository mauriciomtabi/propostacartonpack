@echo off
chcp 65001 >nul
echo.
echo  Iniciando Proxy CORS para Carton Pack...
echo.
python "%~dp0proxy.py"
pause
