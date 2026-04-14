@echo off
setlocal
set PYTHONUTF8=1
title Pipeline Orchestrator Combined Launcher

echo 🚀 Starting Pipeline Orchestrator...

echo [1/2] Starting Backend (Port 8000)...
start /B "PO_Backend" cmd /c "cd /d "%~dp0backend" && .venv\Scripts\uvicorn.exe main:app --host 0.0.0.0 --port 8000"

echo [2/2] Starting Frontend (Port 3002)...
start /B "PO_Frontend" cmd /c "cd /d "%~dp0frontend" && npx next dev --port 3002"

echo.
echo ✅ Project started successfully.
echo Frontend: http://localhost:3002
echo Backend:  http://localhost:8000
echo.
echo Please do not close this window to keep the background processes running.
echo To stop, close this terminal window.

pause
