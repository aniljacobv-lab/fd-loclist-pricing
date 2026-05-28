@echo off
REM =====================================================================
REM  push.bat  --  stage, commit, push. Triggers a Render auto-redeploy.
REM
REM  USAGE:
REM    push.bat "what you changed"
REM    push.bat                       (uses a timestamp as the message)
REM =====================================================================
setlocal
cd /d "%~dp0"

set "MSG=%~1"
if "%MSG%"=="" set "MSG=Update %DATE% %TIME%"

git add -A
git diff --cached --quiet
if not errorlevel 1 (
  echo Nothing to commit.
  exit /b 0
)

git commit -m "%MSG%"
if errorlevel 1 (
  echo Commit failed.
  exit /b %errorlevel%
)

git push
if errorlevel 1 (
  echo Push failed. You may need to:  git pull --rebase  and try again.
  exit /b %errorlevel%
)

echo.
echo Pushed: "%MSG%"
echo Render should pick this up and redeploy in 2-3 minutes.
