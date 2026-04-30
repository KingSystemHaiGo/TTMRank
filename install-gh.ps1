# Install GitHub CLI (gh) for Windows
# Usage: .\install-gh.ps1

$ErrorActionPreference = 'Stop'

Write-Host '========================================' -ForegroundColor Cyan
Write-Host '  GitHub CLI (gh) Installer' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor Cyan

# Check if already installed
$ghPath = Get-Command gh -ErrorAction SilentlyContinue
if ($ghPath) {
    Write-Host "gh already installed: $($ghPath.Source)" -ForegroundColor Green
    gh --version
    Write-Host ''
    Write-Host 'Run: gh auth login' -ForegroundColor Yellow
    exit 0
}

# Try winget first
$winget = Get-Command winget -ErrorAction SilentlyContinue
if ($winget) {
    Write-Host 'Installing via winget...' -ForegroundColor Blue
    winget install --id GitHub.cli --source winget --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -eq 0) {
        Write-Host 'Done!' -ForegroundColor Green
        Write-Host 'Run: gh auth login' -ForegroundColor Yellow
        exit 0
    }
}

# Fallback: download MSI
Write-Host 'Downloading latest gh...' -ForegroundColor Blue

$apiUrl = 'https://api.github.com/repos/cli/cli/releases/latest'
try {
    $release = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 30
    $asset = $release.assets | Where-Object { $_.name -match 'windows_amd64\.msi$' } | Select-Object -First 1
    if (-not $asset) {
        throw 'MSI not found'
    }
    $downloadUrl = $asset.browser_download_url
    $outFile = "$env:TEMP\gh_install.msi"

    Write-Host "Download: $($asset.name)" -ForegroundColor Blue
    Invoke-WebRequest -Uri $downloadUrl -OutFile $outFile -UseBasicParsing

    Write-Host 'Installing...' -ForegroundColor Blue
    $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i', $outFile, '/quiet', '/norestart' -Wait -PassThru

    if ($process.ExitCode -eq 0) {
        Write-Host ''
        Write-Host '========================================' -ForegroundColor Green
        Write-Host '  Install success!' -ForegroundColor Green
        Write-Host '========================================' -ForegroundColor Green
        Write-Host ''
        Write-Host 'Next step:' -ForegroundColor Yellow
        Write-Host '  gh auth login' -ForegroundColor Yellow
        Write-Host ''
        Write-Host 'Then run deploy.bat' -ForegroundColor Yellow
    } else {
        throw "MSI failed: $($process.ExitCode)"
    }

    Remove-Item $outFile -Force -ErrorAction SilentlyContinue
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host ''
    Write-Host 'Please download manually:' -ForegroundColor Yellow
    Write-Host 'https://cli.github.com/' -ForegroundColor Cyan
}
