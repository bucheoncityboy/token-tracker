[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " 🪨  Token Tracker - Logout & Close Server" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Run OpenAI logout
node "$PSScriptRoot\src\cli.js" openai logout

# Stop active background dashboard server on port 3000
$connection = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue

if ($connection) {
    Write-Host ""
    Write-Host "Active background dashboard server detected." -ForegroundColor Yellow
    Write-Host "Safely terminating server process (PID: $($connection.OwningProcess[0]))..." -ForegroundColor Yellow
    
    foreach ($conn in $connection) {
        if ($conn.OwningProcess -gt 0) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
    Write-Host "✓ Dashboard server terminated successfully." -ForegroundColor Green
}

Write-Host ""
Write-Host "✓ Logout and cleanup completed successfully!" -ForegroundColor Green
