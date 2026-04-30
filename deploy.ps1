# TTMRank GitHub Pages Deploy (PowerShell)
# Usage: cd to project root, run .\deploy.ps1

$ErrorActionPreference = 'Stop'

function Write-Color($Text, $Color = 'White') {
    Write-Host $Text -ForegroundColor $Color
}

Write-Color '========================================' Cyan
Write-Color '  TTMRank GitHub Pages Deploy' Cyan
Write-Color '========================================' Cyan

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Color 'Error: git not found. Please install Git first.' Red
    exit 1
}

# Check gh
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
    Write-Color 'GitHub CLI (gh) not found' Yellow
    Write-Color 'Please run: .\install-gh.ps1' Yellow
    Write-Color 'Then run: gh auth login' Yellow
    exit 1
}

# Check gh login
$oldPref = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& gh auth status >$null 2>&1
$exitAuth = $LASTEXITCODE
$ErrorActionPreference = $oldPref
if ($exitAuth -ne 0) {
    Write-Color 'Please login first: gh auth login' Yellow
    exit 1
}

# Get GitHub username
$GH_USER = (& gh api user --jq '.login').Trim()
if (-not $GH_USER) {
    Write-Color 'Failed to get GitHub username' Red
    exit 1
}

Write-Color "GitHub user: $GH_USER" Green

$REPO_NAME = 'TTMRank'
$REPO_URL = "https://github.com/$GH_USER/$REPO_NAME"

Write-Color ''
Write-Color "Repository: $REPO_URL" Blue
Read-Host 'Press Enter to continue, or Ctrl+C to cancel'

# Git init
Write-Color ''
Write-Color '[1/4] Initializing Git...' Blue
if (-not (Test-Path .git)) {
    git init
    git branch -M main
}

# Commit
git add .
$ErrorActionPreference = 'Continue'
git diff --cached --quiet 2>&1
$hasChanges = $LASTEXITCODE
$ErrorActionPreference = $oldPref
if ($hasChanges -ne 0) {
    git commit -m 'init'
} else {
    Write-Color 'No changes to commit' Green
}

# Create/push
Write-Color ''
Write-Color '[2/4] Pushing to GitHub...' Blue

$hasRemote = $false
try {
    git remote get-url origin | Out-Null
    $hasRemote = $true
} catch {}

$pushSuccess = $false

if (-not $hasRemote) {
    $ErrorActionPreference = 'Continue'
    & gh repo view "$GH_USER/$REPO_NAME" >$null 2>&1
    $exitView = $LASTEXITCODE
    $ErrorActionPreference = $oldPref

    if ($exitView -eq 0) {
        Write-Color 'Repository exists, adding remote...' Blue
        git remote add origin "$REPO_URL.git"
        git push -u origin main
        if ($LASTEXITCODE -eq 0) { $pushSuccess = $true }
    } else {
        Write-Color 'Creating new repository...' Blue
        $ErrorActionPreference = 'Continue'
        & gh repo create $REPO_NAME --public --source=. --remote=origin --push
        $exitCreate = $LASTEXITCODE
        $ErrorActionPreference = $oldPref
        if ($exitCreate -eq 0) {
            $pushSuccess = $true
        } else {
            Write-Color 'gh repo create failed, trying manual push...' Yellow
            git remote add origin "$REPO_URL.git"
            git push -u origin main
            if ($LASTEXITCODE -eq 0) { $pushSuccess = $true }
        }
    }
} else {
    git push -u origin main
    if ($LASTEXITCODE -eq 0) { $pushSuccess = $true }
}

if (-not $pushSuccess) {
    Write-Color 'Push failed. Please check network or create the repository manually.' Red
    Write-Color "Manual steps:" Yellow
    Write-Color "  1. Create repo at https://github.com/new?name=$REPO_NAME" Yellow
    Write-Color "  2. Run: git remote add origin https://github.com/$GH_USER/$REPO_NAME.git" Yellow
    Write-Color "  3. Run: git push -u origin main" Yellow
    exit 1
}

Write-Color ''
Write-Color "Code pushed to $REPO_URL" Green

# Configure repo
Write-Color ''
Write-Color '[3/4] Configuring repository...' Blue

$ErrorActionPreference = 'Continue'
& gh api --method PUT "repos/$GH_USER/$REPO_NAME/actions/permissions/workflow" -f default_workflow_permissions=write >$null 2>&1
$exitActions = $LASTEXITCODE
$ErrorActionPreference = $oldPref
if ($exitActions -eq 0) {
    Write-Color 'Actions permissions configured' Green
} else {
    Write-Color 'Actions auto-config failed, please set manually' Yellow
}

$ErrorActionPreference = 'Continue'
& gh api --method PUT "repos/$GH_USER/$REPO_NAME/pages" -f source='github_actions' >$null 2>&1
$exitPages = $LASTEXITCODE
$ErrorActionPreference = $oldPref
if ($exitPages -eq 0) {
    Write-Color 'Pages configured' Green
} else {
    Write-Color 'Pages auto-config failed, please set manually' Yellow
}

# Final instructions
Write-Color ''
Write-Color '========================================' Green
Write-Color '  Code pushed successfully!' Green
Write-Color '========================================' Green
Write-Color ''
Write-Color 'Remaining manual steps (about 2 min):' Blue
Write-Color ''
Write-Color '1. Enable GitHub Pages' White
Write-Color "   Open: $REPO_URL/settings/pages" Cyan
Write-Color '   Build and deployment -> Source -> select GitHub Actions' Yellow
Write-Color ''
Write-Color '2. Enable Actions permissions' White
Write-Color "   Open: $REPO_URL/settings/actions" Cyan
Write-Color '   Workflow permissions -> select Read and write permissions' Yellow
Write-Color '   Check Allow GitHub Actions to create and approve pull requests' Yellow
Write-Color '   Click Save' Yellow
Write-Color ''
Write-Color '3. Wait for first deploy' White
Write-Color "   Open: $REPO_URL/actions" Cyan
Write-Color '   Wait for Deploy to GitHub Pages to turn green' Yellow
Write-Color ''
Write-Color "Website: https://$GH_USER.github.io/$REPO_NAME/" Green
Write-Color ''
Write-Color 'Data refreshes automatically every hour.' White
Write-Color "To refresh now: $REPO_URL/actions/workflows/refresh.yml -> Run workflow" Cyan
Write-Color ''
