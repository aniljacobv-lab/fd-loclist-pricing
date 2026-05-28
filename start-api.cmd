@echo off
REM Start the API in mock mode (or Oracle, if you've edited api\.env).
cd /d "%~dp0api"

if not exist node_modules (
  echo Installing API dependencies...
  call npm install || goto :error
)

if not exist .env (
  echo Creating .env from .env.example ...
  copy /Y .env.example .env >nul
)

echo Starting API on http://localhost:3001  (Ctrl+C to stop)
call npm run dev
goto :eof

:error
echo.
echo npm install failed. Make sure Node.js 18+ is installed and on your PATH.
pause
