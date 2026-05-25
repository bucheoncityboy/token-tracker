[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " 🪨  Token Tracker - Open Real-time Dashboard" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Check if port 3000 is actively listening (avoids TIME_WAIT false positives)
$portActive = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    # Short timeout to avoid blocking
    $connect = $tcp.BeginConnect("127.0.0.1", 3000, $null, $null)
    $wait = $connect.AsyncWaitHandle.WaitOne(500, $false)
    if ($wait -and $tcp.Connected) {
        $portActive = $true
        $tcp.EndConnect($connect)
    }
    $tcp.Close()
} catch {
    $portActive = $false
}

if ($portActive) {
    Write-Host "Dashboard server is already running. Opening browser..." -ForegroundColor Green
} else {
    Write-Host "Starting real-time dashboard server in background..." -ForegroundColor Yellow
    # Dynamically resolve the absolute path of node.exe for WMI compatibility
    $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $nodePath) {
        $nodePath = (where.exe node 2>$null | Select-Object -First 1)
    }
    if (-not $nodePath) {
        $nodePath = "node" # fallback
    }

    # Start node server as a completely detached background process via WMI (survives Job Object teardown)
    $command = "`"$nodePath`" `"$PSScriptRoot\src\cli.js`" serve --port 3000"
    $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ 
        CommandLine = $command
        CurrentDirectory = $PSScriptRoot 
    }
    Start-Sleep -Milliseconds 1500
}

# Auto-open browser
Start-Process "http://localhost:3000"
Write-Host "✓ Real-time dashboard displayed in browser!" -ForegroundColor Green
Write-Host "  (Server URL: http://localhost:3000)" -ForegroundColor Cyan
