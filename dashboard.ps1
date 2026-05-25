[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " 🪨  Token Tracker - Open Real-time Dashboard" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Check if port 3000 is active
$connection = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue

if ($connection) {
    Write-Host "Dashboard server is already running. Opening browser..." -ForegroundColor Green
} else {
    Write-Host "Starting real-time dashboard server in background..." -ForegroundColor Yellow
    # Start node server as hidden background process
    Start-Process node -ArgumentList "\`"$PSScriptRoot\src\cli.js\`" serve --port 3000" -WindowStyle Hidden
    Start-Sleep -Milliseconds 1500
}

# Auto-open browser
Start-Process "http://localhost:3000"
Write-Host "✓ Real-time dashboard displayed in browser!" -ForegroundColor Green
Write-Host "  (Server URL: http://localhost:3000)" -ForegroundColor Cyan
