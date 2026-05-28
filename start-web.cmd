@echo off
REM Start the React dev server. The API must be running first (start-api.cmd).
cd /d "%~dp0web"

if not exist node_modules (
  echo Installing web dependencies...
  call npm install || goto :error
)

echo Starting web app on http://localhost:5173  (Ctrl+C to stop)
echo (Make sure the API is running in another window - run start-api.cmd)
call npm run dev
goto :eof

:error
echo.
echo npm install failed. Make sure Node.js 18+ is installed and on your PATH.
pause
