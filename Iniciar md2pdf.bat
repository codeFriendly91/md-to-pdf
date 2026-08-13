@echo off
title md2pdf - Markdown a PDF
cd /d "%~dp0"

echo ============================================
echo   md2pdf - Markdown a PDF bonito
echo ============================================
echo.

REM Verificar que Node este instalado
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js.
  echo Instalalo desde https://nodejs.org y volve a intentar.
  echo.
  pause
  exit /b 1
)

REM Instalar dependencias la primera vez
if not exist "node_modules" (
  echo Instalando dependencias por unica vez, esperá un momento...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo [ERROR] Fallo la instalacion de dependencias.
    pause
    exit /b 1
  )
  echo.
)

echo Iniciando... el navegador se abre solo en unos segundos.
echo.

REM Arrancar el servidor (busca puerto libre y abre el navegador solo).
REM Mantiene esta ventana abierta; cerrala para detener el programa.
node server.js

pause
