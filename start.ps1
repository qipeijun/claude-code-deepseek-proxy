<#
.SYNOPSIS
  claude-code-deepseek-proxy 一键启动脚本
  平台: Windows PowerShell 5.1+ / PowerShell Core 6+

.DESCRIPTION
  使用前可能需要放宽执行策略（以管理员身份运行 PowerShell）：
    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  或临时绕过：
    powershell -ExecutionPolicy Bypass -File start.ps1

.PARAMETER Dev
  开发模式，使用 tsx watch 热重载
.PARAMETER KillPort
  启动前强制释放端口
.PARAMETER Bg
  后台运行，日志写入日志文件
.PARAMETER DryRun
  仅检查环境，不启动
#>
param(
  [switch]$Dev,
  [switch]$KillPort,
  [switch]$Bg,
  [switch]$DryRun,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
$PORT = 8787
$HOST = "127.0.0.1"
$LOG_DIR = "./logs"

# ── 帮助 ──
if ($Help) {
  Get-Help $PSCommandPath -Detailed
  exit 0
}

# ── 颜色函数 ──
function Write-CheckOK   { Write-Host "  ✓ $args" -ForegroundColor Green }
function Write-CheckWarn { Write-Host "  ⚠ $args" -ForegroundColor Yellow }
function Write-CheckErr  { Write-Host "  ✗ $args" -ForegroundColor Red }
function Write-Info      { Write-Host $args -ForegroundColor Cyan }

# ── 检查执行策略（仅 Windows PowerShell 需要，PowerShell Core 不受限）──
if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $policy = Get-ExecutionPolicy -Scope CurrentUser -ErrorAction SilentlyContinue
  if ($policy -eq 'Restricted' -or $policy -eq 'AllSigned') {
    Write-CheckWarn "当前 PowerShell 执行策略为 $policy，可能无法运行脚本"
    Write-Host "  以管理员身份运行并执行: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned"
    Write-Host "  或: powershell -ExecutionPolicy Bypass -File start.ps1"
    Write-Host ""
  }
}

# ── 查找端口占用 ──
function Get-PortProcess {
  param([int]$Port)

  # netstat -ano 在 Win7+ 均可用，输出格式: TCP  0.0.0.0:8787  0.0.0.0:0  LISTENING  PID
  $lines = netstat -ano 2>$null | Select-String ":$Port " | Select-String "LISTENING"
  if (-not $lines) { return $null }

  # 提取最后一列（PID），兼容不同列宽
  $firstLine = $lines[0].Line.Trim()
  $parts = $firstLine -split '\s+'
  $pidStr = $parts[-1]

  $pid = 0
  if ([int]::TryParse($pidStr, [ref]$pid) -and $pid -gt 0) {
    return $pid
  }
  return $null
}

# ── 释放端口 ──
function Clear-Port {
  param([int]$Port)

  $pid = Get-PortProcess -Port $Port
  if (-not $pid) {
    Write-CheckOK "端口 $Port 空闲"
    return $true
  }

  Write-CheckWarn "端口 $Port 被进程 $pid 占用，正在释放..."

  # /F 强制终止，可能需管理员权限
  $result = taskkill /PID $pid /F 2>&1
  Start-Sleep -Milliseconds 500

  $still = Get-PortProcess -Port $Port
  if ($still) {
    $errMsg = if ($result -match "拒绝访问") { "权限不足，请以管理员身份运行" } else { $result }
    Write-CheckErr "端口 $Port 释放失败: $errMsg"
    return $false
  }

  Write-CheckOK "端口 $Port 已释放"
  return $true
}

# ── 预检 ──
Write-Info "── 环境检查 ──"

# Node.js
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-CheckErr "未找到 Node.js，请先安装 Node.js >= 22"
  exit 1
}
$nodeVersion = (node -v) -replace 'v', ''
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 22) {
  Write-CheckErr "Node.js 版本过低：$(node -v)，要求 >= 22"
  exit 1
}
Write-CheckOK "Node.js $(node -v)"

# npm
$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
  Write-CheckErr "未找到 npm"
  exit 1
}
Write-CheckOK "npm $(npm -v)"

# node_modules
if (-not (Test-Path "node_modules")) {
  Write-CheckErr "node_modules 不存在，请先运行 npm install"
  exit 1
}
Write-CheckOK "node_modules 已安装"

# tsx（--no-install 避免触发交互式安装提示）
$tsxResult = npx --no-install tsx --version 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-CheckErr "tsx 不可用，请先运行 npm install"
  exit 1
}
Write-CheckOK "tsx 可用"

# 端口
if ($KillPort) {
  $portOk = Clear-Port -Port $PORT
  if (-not $portOk) { exit 1 }
} else {
  $occupyingPid = Get-PortProcess -Port $PORT
  if ($occupyingPid) {
    Write-CheckErr "端口 $PORT 已被进程 $occupyingPid 占用"
    Write-Host "  使用 -KillPort 自动释放，或手动 taskkill /PID $occupyingPid /F"
    exit 1
  }
  Write-CheckOK "端口 $PORT 空闲"
}

# ── dry-run ──
if ($DryRun) {
  Write-Host ""
  Write-Host "环境检查通过，可以启动。" -ForegroundColor Green
  if ($Bg) { Write-Host "启动模式: 后台运行" } else { Write-Host "启动模式: 前台运行" }
  Write-Host "启动命令: npx tsx src/index.ts --kill-port"
  exit 0
}

# ── 构建 tsx 参数 ──
$tsxArgs = [System.Collections.ArrayList]::new()
if ($Dev) { $tsxArgs.Add("watch") | Out-Null }
$tsxArgs.Add("src/index.ts") | Out-Null
if ($KillPort) { $tsxArgs.Add("--kill-port") | Out-Null }

# ── 后台模式 ──
if ($Bg) {
  New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null
  $logFile = Join-Path $LOG_DIR "proxy.log"
  $pidFile = Join-Path $LOG_DIR "proxy.pid"

  Write-Info "── 后台启动 ──"

  # 为 Start-Process 构建参数：npx tsx [watch] src/index.ts [--kill-port]
  # 注意: Start-Process -ArgumentList 会自动处理含空格的参数引用
  $proc = Start-Process -FilePath "npx" `
    -ArgumentList $tsxArgs `
    -NoNewWindow `
    -PassThru `
    -RedirectStandardOutput $logFile `
    -RedirectStandardError $logFile

  $proc.Id | Out-File -FilePath $pidFile -NoNewline
  Start-Sleep -Seconds 2

  if (-not $proc.HasExited) {
    Write-CheckOK "代理已启动 (PID: $($proc.Id))"
    Write-Host ""
    Write-Host "  管理后台: http://${HOST}:$PORT/admin" -ForegroundColor Cyan
    Write-Host "  日志文件: $logFile"
    Write-Host "  PID 文件: $pidFile"
    Write-Host ""
    Write-Host "  停止服务: taskkill /PID $($proc.Id) /F"
  } else {
    Write-CheckErr "启动失败，请查看日志: $logFile"
    if (Test-Path $logFile) {
      Write-Host "  最近日志:" -ForegroundColor Yellow
      Get-Content $logFile -Tail 10 | ForEach-Object { Write-Host "    $_" }
    }
    exit 1
  }
} else {
  # ── 前台模式 ──
  Write-Info "── 启动服务 ──"
  Write-Host "  代理地址: http://${HOST}:$PORT" -ForegroundColor Green
  Write-Host "  管理后台: http://${HOST}:$PORT/admin" -ForegroundColor Green
  if ($Dev) {
    Write-Host "  模式:     开发模式（文件变更自动重启）"
  }
  Write-Host ""
  Write-Host "  按 Ctrl+C 停止服务" -ForegroundColor Yellow
  Write-Host ""

  # 前台直接调用 npx，Ctrl+C 会正确传播
  npx $tsxArgs
}
