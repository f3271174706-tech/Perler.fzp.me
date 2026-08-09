$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) { $pythonCommand = Get-Command py -ErrorAction SilentlyContinue }
if (-not $pythonCommand) { throw "未找到 Python，请安装 Python 3 后重试。" }

Write-Host "智能拼豆板已启动：http://127.0.0.1:4173/"
Write-Host "按 Ctrl+C 停止服务。"
& $pythonCommand.Source -m http.server 4173 --bind 127.0.0.1 --directory $projectDirectory
