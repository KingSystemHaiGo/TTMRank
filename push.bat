@echo off
cd /d %~dp0

git add .
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "update"
) else (
    echo No changes to commit
)

echo Pushing to GitHub...
git push
if errorlevel 1 (
    echo Remote has new commits, pulling first...
    git pull
    git push
    if errorlevel 1 (
        echo Push failed again. Please check your network.
        pause
        exit /b 1
    )
)

echo Done.
pause
