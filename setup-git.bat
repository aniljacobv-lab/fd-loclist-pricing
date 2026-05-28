@echo off
REM =====================================================================
REM  setup-git.bat  --  one-time GitHub setup for the FD Pricing Workbench.
REM
REM  BEFORE RUNNING:
REM    1. Create an empty (no README, no .gitignore) repo on github.com.
REM       e.g. https://github.com/your-username/fd-loclist-pricing
REM    2. Make sure Git is installed and `git --version` works.
REM
REM  USAGE:
REM    setup-git.bat https://github.com/your-username/fd-loclist-pricing.git
REM =====================================================================
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo.
  echo Usage: setup-git.bat ^<github-repo-url^>
  echo Example: setup-git.bat https://github.com/your-username/fd-loclist-pricing.git
  echo.
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo Git is not installed or not on PATH. Install from https://git-scm.com/download/win
  exit /b 1
)

if exist ".git" (
  echo This folder is already a git repo. If you want to switch remotes:
  echo    git remote set-url origin %~1
  echo Or push existing commits:           git push -u origin main
  exit /b 1
)

echo Initializing git repo...
git init
git branch -M main

echo Staging files...
git add -A

echo Creating initial commit...
git -c user.email="anil@familydollar.local" -c user.name="Anil" commit -m "Initial commit: FD Pricing Workbench POC"
if errorlevel 1 (
  echo Commit failed. Configure your git identity first:
  echo    git config --global user.email "you@example.com"
  echo    git config --global user.name "Your Name"
  exit /b 1
)

echo Adding remote and pushing...
git remote add origin "%~1"
git push -u origin main
if errorlevel 1 (
  echo.
  echo Push failed. Common causes:
  echo   * GitHub credentials not set ^(use a Personal Access Token^)
  echo   * Repo isn't empty on GitHub
  echo Fix and re-run:  git push -u origin main
  exit /b 1
)

echo.
echo ========================================================
echo Done! Repo is on GitHub.
echo Next: go to https://dashboard.render.com/select-repo,
echo pick this repo, and Render will use render.yaml to deploy.
echo From now on, run push.bat "your message" to redeploy.
echo ========================================================
