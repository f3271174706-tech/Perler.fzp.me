$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw "未找到 Node.js，请安装 Node.js 18 或更高版本后重试。" }

Write-Host "智能拼豆板已启动：http://127.0.0.1:4173/"
Write-Host "本机管理员测试密钥：test-admin-key"
Write-Host "按 Ctrl+C 停止服务。"
$env:PERLER_PORT = "4173"
$env:PERLER_DATA_DIR = Join-Path $projectDirectory ".perler-data"
& $nodeCommand.Source (Join-Path $projectDirectory "server.mjs")
