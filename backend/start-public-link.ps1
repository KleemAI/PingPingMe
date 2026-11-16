# Gives the backend on this PC a temporary public https:// address (Cloudflare quick tunnel),
# so the phone app works on mobile data or any Wi-Fi. This PC and the backend must stay on.
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$Host.UI.RawUI.WindowTitle = "Business Messaging - public link"

function Pause-Exit { Write-Host ""; Read-Host "Press Enter to close"; exit }

# 1. The backend must be running
Write-Host ""
Write-Host " Checking the backend on http://localhost:4000 ..."
try {
  Invoke-RestMethod -Uri "http://localhost:4000/api/v1/health" -TimeoutSec 8 | Out-Null
  Write-Host " Backend is running." -ForegroundColor Green
} catch {
  Write-Host ""
  Write-Host " [!] The backend is not running." -ForegroundColor Red
  Write-Host "     Double-click start-backend.bat first, wait for 'API ready', then run this again."
  Pause-Exit
}

# 2. Find (or install) cloudflared
function Find-Cloudflared {
  $c = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $candidates = @(
    (Join-Path $PSScriptRoot "tools\cloudflared.exe"),
    (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\cloudflared.exe"),
    "C:\Program Files (x86)\cloudflared\cloudflared.exe",
    "C:\Program Files\cloudflared\cloudflared.exe"
  )
  foreach ($p in $candidates) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}

$cf = Find-Cloudflared
if (-not $cf) {
  Write-Host ""
  Write-Host " Installing Cloudflare Tunnel (cloudflared) - one time only ..."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
    $cf = Find-Cloudflared
  }
  if (-not $cf) {
    Write-Host ""
    Write-Host " [!] Could not install cloudflared automatically." -ForegroundColor Red
    Write-Host "     Download 'cloudflared-windows-amd64.exe' from"
    Write-Host "     https://github.com/cloudflare/cloudflared/releases/latest"
    Write-Host "     rename it to cloudflared.exe and put it in:  backend\tools\"
    Write-Host "     Then run this file again."
    Pause-Exit
  }
}

# 3. Start the tunnel (attached to this window: closing the window stops it)
$logDir = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$errLog = Join-Path $logDir "tunnel.log"
$outLog = Join-Path $logDir "tunnel-out.log"
Remove-Item $errLog, $outLog -ErrorAction SilentlyContinue

Write-Host ""
Write-Host " Opening the public link ..."
$proc = Start-Process -FilePath $cf -ArgumentList @("tunnel", "--no-autoupdate", "--url", "http://localhost:4000") `
  -NoNewWindow -PassThru -RedirectStandardError $errLog -RedirectStandardOutput $outLog

$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if ($proc.HasExited) { break }
  foreach ($f in @($errLog, $outLog)) {
    if (Test-Path $f) {
      $m = Select-String -Path $f -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($m) { $url = $m.Matches[0].Value; break }
    }
  }
}

if (-not $url) {
  Write-Host ""
  Write-Host " [!] The tunnel did not start. Details are in backend\logs\tunnel.log" -ForegroundColor Red
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  Pause-Exit
}

# 4. Wait until the link really reaches the backend
$ok = $false
for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
  try { Invoke-RestMethod -Uri "$url/api/v1/health" -TimeoutSec 8 | Out-Null; $ok = $true } catch { Start-Sleep -Seconds 2 }
}
try { Set-Clipboard -Value $url } catch {}

Write-Host ""
Write-Host " ================================================================" -ForegroundColor Green
Write-Host "   PUBLIC LINK (copied to clipboard):" -ForegroundColor Green
Write-Host ""
Write-Host "   $url" -ForegroundColor Yellow
Write-Host ""
Write-Host "   In the phone app, set  Server address  to this link." -ForegroundColor Green
Write-Host "   Works on mobile data and any Wi-Fi while this window is open." -ForegroundColor Green
Write-Host " ================================================================" -ForegroundColor Green
if (-not $ok) { Write-Host " (The link is still warming up - wait a few seconds before signing in.)" }
Write-Host ""
Write-Host " Keep this window AND the backend window open. Close this window to stop the link."
Write-Host " Note: you get a NEW link every time you run this file."
Set-Content -Path (Join-Path $logDir "public-link.txt") -Value $url

Wait-Process -Id $proc.Id
Write-Host ""
Write-Host " The tunnel stopped." -ForegroundColor Red
Pause-Exit
