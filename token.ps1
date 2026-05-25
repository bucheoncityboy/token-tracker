param (
    [Parameter(Position=0)]
    [string]$Action
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Show-InteractiveMenu {
    Clear-Host
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "        🪨  Token Tracker - Interactive Menu" -ForegroundColor Cyan
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Please choose an action:" -ForegroundColor Yellow
    Write-Host "  [1] OpenAI Subscription Login (login)" -ForegroundColor White
    Write-Host "  [2] Open Real-time Dashboard (dashboard)" -ForegroundColor White
    Write-Host "  [3] Logout & Close Background Server (logout)" -ForegroundColor White
    Write-Host "  [4] Exit (exit)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Cyan
    
    $choice = Read-Host "Choice (1-4)"
    
    switch ($choice) {
        "1" {
            Write-Host ""
            & "$PSScriptRoot\login.ps1"
        }
        "2" {
            Write-Host ""
            & "$PSScriptRoot\dashboard.ps1"
        }
        "3" {
            Write-Host ""
            & "$PSScriptRoot\logout.ps1"
        }
        "4" {
            Write-Host ""
            Write-Host "Exiting Token Tracker." -ForegroundColor Gray
            exit
        }
        default {
            Write-Host ""
            Write-Host "✗ Invalid choice. Please select a number between 1 and 4." -ForegroundColor Red
            Start-Sleep -Seconds 1.5
            Show-InteractiveMenu
        }
    }
}

# 인자가 제공되지 않은 경우 인터랙티브 메뉴 실행
if ([string]::IsNullOrEmpty($Action)) {
    Show-InteractiveMenu
    exit
}

# 인자가 입력된 경우 기존 방식처럼 다이렉트 실행
switch ($Action.ToLower()) {
    "login" {
        & "$PSScriptRoot\login.ps1"
    }
    "dashboard" {
        & "$PSScriptRoot\dashboard.ps1"
    }
    "logout" {
        & "$PSScriptRoot\logout.ps1"
    }
    default {
        # Transparently proxy all other CLI commands (call, status, ls, etc.) to the core Node.js engine
        $allArgs = @($Action) + $args
        & node "$PSScriptRoot\src\cli.js" $allArgs
    }
}
