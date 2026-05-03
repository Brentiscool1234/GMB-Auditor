@echo off
title GMB Auditor
color 0A

echo.
echo  ============================================
echo   GMB Auditor
echo  ============================================
echo.

:: Check .env exists
if not exist .env (
    echo  [ERROR] No .env file found.
    echo  Run install.bat first to set up your API key.
    echo.
    pause
    exit /b 1
)

echo  Starting app...
echo  Open http://localhost:3000 in your browser.
echo  Press Ctrl+C to stop.
echo.

:: Open browser after a short delay (in background)
start "" cmd /c "timeout /t 3 >nul && start http://localhost:3000"

npm run dev
