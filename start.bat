@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo =========================================
echo   TTMRank - TapTap Rankings Aggregator
echo =========================================
echo.

if exist "app\start.py" (
    python app\start.py
) else (
    echo [1/2] Fetching latest data...
    python app\fetcher.py
    if errorlevel 1 (
        echo Failed to fetch data. Please ensure Python is installed.
        pause
        exit /b 1
    )
    echo.
    echo [2/2] Starting server...
    python app\server.py
)
