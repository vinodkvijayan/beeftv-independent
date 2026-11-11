#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("cpu", "cuda")]
    [string]$Device,
    [Parameter(Mandatory = $true)]
    [string]$PythonPath,
    [Parameter(Mandatory = $true)]
    [string]$RuntimeDir,
    [Parameter(Mandatory = $true)]
    [string]$SourceDir,
    [Parameter(Mandatory = $true)]
    [string]$WorkDir,
    [string]$ToolDir = (Join-Path $PSScriptRoot "..\tools\depth-capture")
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT" -or [Environment]::Is64BitProcess -ne $true) {
    throw "Deep-running packet probes require a 64-bit Windows process"
}

$python = (Resolve-Path -LiteralPath $PythonPath).Path
$runtime = (Resolve-Path -LiteralPath $RuntimeDir).Path
$source = (Resolve-Path -LiteralPath $SourceDir).Path
$tool = (Resolve-Path -LiteralPath $ToolDir).Path
$checkpoint = Join-Path $runtime "checkpoints\video_depth_anything_vits.pth"
$modelHash = "13379300b739e659f076a59d52e9801bd8d38c541a7e71f73bbca4dcfb013609"
if (-not (Test-Path -LiteralPath (Join-Path $source "video_depth_anything\video_depth.py"))) {
    throw "Missing fixed version of Video Depth Anything source code"
}
if (-not (Test-Path -LiteralPath $checkpoint)) {
    throw "Missing installed Small model weights; probe will not download model"
}
if ((Get-FileHash -LiteralPath $checkpoint -Algorithm SHA256).Hash.ToLowerInvariant() -ne $modelHash) {
    throw "Small model weights SHA-256 mismatch; probe does not perform corrupted weights"
}

New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
$env:BEEFTV_VDA_SOURCE = $source
$env:PYTHONPATH = $tool
$env:PYTHONIOENCODING = "utf-8"
& $python -m depth_capture.probe --device $Device --runtime-dir $runtime --work-dir $WorkDir
if ($LASTEXITCODE -ne 0) {
    throw "Deep run package $Device real inference probe failed, exit code $LASTEXITCODE"
}
