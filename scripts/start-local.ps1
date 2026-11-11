[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$backendDir = Join-Path $repoRoot "backend"
$webDir = Join-Path $repoRoot "web"
$dataDir = Join-Path $repoRoot ".local\project-workbench-debug"
$goBuildCache = Join-Path $repoRoot ".local\cache\go-build"
$goModuleCache = Join-Path $repoRoot ".local\cache\go-mod"

foreach ($commandName in @("go", "bun")) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
        throw "$commandName not found, please install the runtime required by the project first."
    }
}

foreach ($directory in @($dataDir, $goBuildCache, $goModuleCache)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

$viteBinary = Join-Path $webDir "node_modules\.bin\vite"
if (-not (Test-Path -LiteralPath $viteBinary)) {
    Write-Host "web/node_modules does not exist, executing bun install --frozen-lockfile..." -ForegroundColor Yellow
    Push-Location $webDir
    try {
        & bun install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) {
            throw "bun install failed and could not start the front end."
        }
    } finally {
        Pop-Location
    }
}

function Test-ListeningPort([int]$Port) {
    try {
        return $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1)
    } catch {
        return $false
    }
}

foreach ($port in @(3000, 8080)) {
    if (Test-ListeningPort $port) {
        throw "Port $port is occupied. Please close the occupying process and try again."
    }
}

$powerShellPath = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $powerShellPath) {
    $powerShellPath = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
}
if (-not $powerShellPath) {
    throw "PowerShell is not found and the front-end and back-end independent windows cannot be opened."
}

function ConvertTo-PowerShellLiteral([string]$Value) {
    return "'" + $Value.Replace("'", "''") + "'"
}

$backendDirLiteral = ConvertTo-PowerShellLiteral $backendDir
$webDirLiteral = ConvertTo-PowerShellLiteral $webDir
$dataDirLiteral = ConvertTo-PowerShellLiteral $dataDir

$backendCommand = @"
`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $backendDirLiteral
`$env:CANVAS_BACKEND_ADDR = '127.0.0.1:8080'
`$env:CANVAS_BACKEND_DATA_DIR = $dataDirLiteral
`$env:GOCACHE = $(ConvertTo-PowerShellLiteral $goBuildCache)
`$env:GOMODCACHE = $(ConvertTo-PowerShellLiteral $goModuleCache)
Write-Host 'BeefTV backend:http://127.0.0.1:8080' -ForegroundColor Cyan
go run ./cmd/server
"@

$webCommand = @"`$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $webDirLiteral
`$env:VITE_API_PROXY_TARGET = 'http://127.0.0.1:8080'
Write-Host 'BeefTV前端：http://localhost:3000' -ForegroundColor Cyan
bun run dev
"@

$backendProcess = Start-Process -FilePath $powerShellPath -WindowStyle Normal -WorkingDirectory $backendDir -PassThru -ArgumentList @("-NoLogo", "-NoExit", "-NoProfile", "-Command", $backendCommand)
$webProcess = Start-Process -FilePath $powerShellPath -WindowStyle Normal -WorkingDirectory $webDir -PassThru -ArgumentList @("-NoLogo", "-NoExit", "-NoProfile", "-Command", $webCommand)

Write-Host "已打开前后端开发窗口。" -ForegroundColor Green
Write-Host "后端窗口 PID: $($backendProcess.Id)；前端窗口 PID: $($webProcess.Id)"
Write-Host "访问 http://localhost:3000；分别在两个窗口按 Ctrl+C 停止服务。"
