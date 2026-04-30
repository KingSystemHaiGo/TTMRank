@echo off
chcp 65001 >nul
cd /d %~dp0

echo ========================================
echo   TTMRank GitHub Pages Deploy
echo ========================================
echo.

:: Check git
git --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] git not found. Please install Git first.
    echo https://git-scm.com/download/win
    pause
    exit /b 1
)

:: Check and set git identity if missing
git config user.email >nul 2>&1
if errorlevel 1 (
    echo [INFO] Git identity not set. Using default...
    git config user.email "deploy@ttmrank.local"
    git config user.name "TTMRank Deploy"
)

:: Check gh CLI
gh --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] GitHub CLI not found.
    echo Please run: install-gh.ps1
    echo Or download manually: https://cli.github.com/
    pause
    exit /b 1
)

:: Check gh login
gh auth status >nul 2>&1
if errorlevel 1 (
    echo [INFO] Not logged in to GitHub. Starting login...
    gh auth login
    gh auth status >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Login failed.
        pause
        exit /b 1
    )
)

:: Get GitHub username
for /f "delims=" %%a in ('gh api user --jq .login 2^>nul') do set GH_USER=%%a
if not defined GH_USER (
    echo [ERROR] Failed to get GitHub username.
    pause
    exit /b 1
)

echo [OK] GitHub user: %GH_USER%

set REPO_NAME=TTMRank
set REPO_URL=https://github.com/%GH_USER%/%REPO_NAME%

echo.
echo Repository will be: %REPO_URL%
pause

:: Git init
echo.
echo [1/4] Initializing Git...
if not exist .git (
    git init
    git branch -M main
)

:: Commit
git add .
git diff --cached --quiet >nul 2>&1
if errorlevel 1 (
    git commit -m "init"
    echo [OK] Committed
) else (
    echo [OK] No changes to commit
)

:: Push
echo.
echo [2/4] Pushing to GitHub...

git remote get-url origin >nul 2>&1
if errorlevel 1 (
    gh repo view "%GH_USER%/%REPO_NAME%" >nul 2>&1
    if errorlevel 1 (
        echo [INFO] Creating new repository...
        gh repo create %REPO_NAME% --public --source=. --remote=origin --push
        if errorlevel 1 (
            echo [WARN] gh repo create failed, trying manual push...
            git remote add origin %REPO_URL%.git
            git push -u origin main
        )
    ) else (
        echo [INFO] Repository exists, adding remote...
        git remote add origin %REPO_URL%.git
        git push -u origin main
    )
) else (
    git push -u origin main
)

if errorlevel 1 (
    echo [ERROR] Push failed!
    echo.
    echo Manual steps:
    echo   1. Create repo at https://github.com/new?name=%REPO_NAME%
    echo   2. git remote add origin %REPO_URL%.git
    echo   3. git push -u origin main
    pause
    exit /b 1
)

echo [OK] Code pushed to %REPO_URL%

:: Configure
echo.
echo [3/4] Configuring repository...
gh api --method PUT "repos/%GH_USER%/%REPO_NAME%/actions/permissions/workflow" -f default_workflow_permissions=write >nul 2>&1
if errorlevel 1 (
    echo [WARN] Actions auto-config failed, please set manually
) else (
    echo [OK] Actions permissions configured
)

gh api --method PUT "repos/%GH_USER%/%REPO_NAME%/pages" -f source=github_actions >nul 2>&1
if errorlevel 1 (
    echo [WARN] Pages auto-config failed, please set manually
) else (
    echo [OK] Pages configured
)

:: Done
echo.
echo ========================================
echo   Done! Code pushed successfully.
echo ========================================
echo.
echo Remaining manual steps ^(about 2 minutes^):
echo.
echo 1. Enable GitHub Pages
echo    %REPO_URL%/settings/pages
echo    Build and deployment -^> Source -^> GitHub Actions
echo.
echo 2. Enable Actions permissions
echo    %REPO_URL%/settings/actions
echo    Workflow permissions -^> Read and write permissions
echo    Check: Allow GitHub Actions to create and approve pull requests
echo    Click Save
echo.
echo 3. Wait for deploy
echo    %REPO_URL%/actions
echo    Wait for "Deploy to GitHub Pages" to turn green
echo.
echo Website: https://%GH_USER%.github.io/%REPO_NAME%/
echo.
pause
