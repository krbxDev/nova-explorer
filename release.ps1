# KRB Explorer - Release Script
# Usage: .\release.ps1 -Notes "description of changes"
# Bumps patch version, builds, signs, removes old releases, creates new release.

param(
    [Parameter(Mandatory=$true)]
    [string]$Notes
)

$ErrorActionPreference = "Stop"
# Set GH_TOKEN in your environment before running, e.g.:
#   $env:GH_TOKEN = "ghp_..."
if (-not $env:GH_TOKEN) { Write-Error "GH_TOKEN environment variable is not set."; exit 1 }
$GH_TOKEN = $env:GH_TOKEN
$GH       = "$env:LOCALAPPDATA\gh-cli\bin\gh.exe"
$KEY      = "C:\Users\kiero\.tauri\nova-explorer.key"
$KEY_PASS = "novaexplorer"
$REPO     = "krbxDev/krb-explorer"

$env:CARGO_HTTP_CHECK_REVOKE = "false"
$env:GH_TOKEN = $GH_TOKEN

# Read + bump version
$conf = Get-Content "src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$ver  = $conf.version
$parts = $ver -split '\.'
$parts[2] = [string]([int]$parts[2] + 1)
$newVer = $parts -join '.'
Write-Host "Bumping $ver to $newVer" -ForegroundColor Cyan

(Get-Content "src-tauri\tauri.conf.json") -replace "`"version`": `"$ver`"", "`"version`": `"$newVer`"" |
    Set-Content "src-tauri\tauri.conf.json"

# Build
Write-Host "Building..." -ForegroundColor Cyan
cargo tauri build
if (-not $?) { Write-Error "Build failed"; exit 1 }

$installer = "src-tauri\target\release\bundle\nsis\KRB Explorer_${newVer}_x64-setup.exe"
if (-not (Test-Path $installer)) { Write-Error "Installer not found: $installer"; exit 1 }

# Sign
Write-Host "Signing..." -ForegroundColor Cyan
$sigLines = cargo tauri signer sign --private-key-path $KEY --password $KEY_PASS $installer 2>&1
$sig = ($sigLines | Where-Object { $_ -match "^dW" } | Select-Object -First 1)
if (-not $sig) { Write-Error "Could not extract signature"; exit 1 }

# Update latest.json
Write-Host "Updating latest.json..." -ForegroundColor Cyan
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$latestObj = [ordered]@{
    version   = $newVer
    notes     = $Notes
    pub_date  = $pubDate
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $sig
            url       = "https://github.com/$REPO/releases/download/v$newVer/KRB.Explorer_${newVer}_x64-setup.exe"
        }
    }
}
$latestObj | ConvertTo-Json -Depth 5 | Out-File -FilePath "latest.json" -Encoding utf8 -NoNewline

# Commit and push
Write-Host "Committing..." -ForegroundColor Cyan
git remote set-url origin "https://${GH_TOKEN}@github.com/${REPO}.git"
git add src-tauri/tauri.conf.json latest.json
git commit -m "v$newVer - release"
git push origin master

# Delete all existing releases
Write-Host "Removing old releases..." -ForegroundColor Cyan
$existingTags = & $GH release list --repo $REPO --limit 50 --json tagName --jq '.[].tagName' 2>$null
foreach ($tag in $existingTags) {
    Write-Host "  Deleting $tag"
    & $GH release delete $tag --repo $REPO --yes --cleanup-tag 2>$null
}

# Create new release
Write-Host "Creating release v$newVer..." -ForegroundColor Cyan
$releaseArgs = @("release", "create", "v$newVer", $installer, "--title", "v$newVer", "--notes", $Notes, "--repo", $REPO)
$url = & $GH @releaseArgs

Write-Host ""
Write-Host "Released: $url" -ForegroundColor Green
