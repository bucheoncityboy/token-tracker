[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " 🪨  Token Tracker - OpenAI Subscription Login" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Please log in to your ChatGPT Plus subscription account when the browser opens." -ForegroundColor Yellow
Write-Host ""

node "$PSScriptRoot\src\cli.js" openai login --subscription
