# TTMRank Deploy Script

$ErrorActionPreference = 'Stop'

function ok($t) { Write-Host $t -ForegroundColor Green }
function info($t) { Write-Host $t -ForegroundColor Cyan }
function warn($t) { Write-Host $t -ForegroundColor Yellow }
function err($t) { Write-Host $t -ForegroundColor Red }

info '========================================'
info '  TTMRank GitHub Pages Deploy'
info '========================================'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    err 'Error: git not found. Please install Git first.'
    exit 1
}

$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
    info ''
    info '[1/4] Installing GitHub CLI...'
    & "$PSScriptRoot\install-gh.ps1"
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $gh) {
        err 'Still cannot find gh after install. Please restart terminal and retry.'
        exit 1
    }
    ok 'GitHub CLI installed'
} else {
    ok 'GitHub CLI already installed'
}

info ''
info '[2/4] Checking GitHub login...'
# Temporarily suppress error termination for external commands
$oldPref = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& gh auth status >$null 2>&1
$exit1 = $LASTEXITCODE
$ErrorActionPreference = $oldPref

if ($exit1 -ne 0) {
    warn 'Need to login GitHub'
    info 'Please follow the browser prompt...'
    $ErrorActionPreference = 'Continue'
    & gh auth login
    & gh auth status >$null 2>&1
    $exit2 = $LASTEXITCODE
    $ErrorActionPreference = $oldPref
    if ($exit2 -ne 0) {
        err 'Login failed'
        exit 1
    }
}
ok 'GitHub logged in'

info ''
info '[3/4] Deploying...'
& "$PSScriptRoot\deploy.ps1"

info ''
info '[4/4] Done'
