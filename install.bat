@echo off
title GMB Auditor — Installer
color 0A

echo.
echo  ============================================
echo   GMB Auditor — Windows Installer
echo  ============================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo  Download it from https://nodejs.org then re-run this installer.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% found
echo.

:: Install dependencies
echo  Installing dependencies (this may take a minute)...
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo  [ERROR] npm install failed. Check the output above.
    pause
    exit /b 1
)
echo.
echo  [OK] Dependencies installed

:: Set up .env
echo.
if exist .env (
    echo  [SKIP] .env file already exists — skipping API key setup.
    echo         Edit .env manually if you need to change your key.
) else (
    echo  You need an Anthropic API key to generate reports.
    echo  Get one free at https://console.anthropic.com
    echo.
    set /p API_KEY=" Enter your Anthropic API key: "
    echo ANTHROPIC_API_KEY=%API_KEY%> .env
    echo.
    echo  [OK] .env file created
)

:: Done
echo.
echo  ============================================
echo   Installation complete!
echo  ============================================
echo.
echo  To start the app, run:
echo.
echo     npm run dev
echo.
echo  Then open http://localhost:3000 in your browser.
echo.
pause
