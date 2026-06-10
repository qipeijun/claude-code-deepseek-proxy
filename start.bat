@echo off
setlocal enabledelayedexpansion
REM ──────────────────────────────────────────────
REM claude-code-deepseek-proxy 一键启动
REM 平台: Windows CMD
REM 用法: 双击运行 或 start.bat [--dev] [--kill-port]
REM ──────────────────────────────────────────────

set PORT=8787
set HOST=127.0.0.1
set MODE=start
set KILL_PORT=0

REM ── 参数解析 ──
:parse
if "%~1"=="" goto check
if "%~1"=="--dev"        set MODE=dev
if "%~1"=="--kill-port"  set KILL_PORT=1
if "%~1"=="-h"           goto help
if "%~1"=="--help"       goto help
shift
goto parse

:help
echo 用法: start.bat [--dev] [--kill-port]
echo.
echo   --dev        开发模式（tsx watch 热重载）
echo   --kill-port  启动前释放端口 %PORT%
echo   -h, --help    帮助
exit /b 0

:check
echo ── 环境检查 ──

REM Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   [错误] 未找到 Node.js，请先安装 Node.js >= 22
    goto end
)
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODE_MAJOR=%%a
REM 去掉 v 前缀
if !NODE_MAJOR! LSS 22 (
    echo   [错误] Node.js 版本过低：要求 >= 22
    echo   建议: nvm install 22 ^&^& nvm use 22
    goto end
)
echo   [OK] Node.js 已安装

REM npm
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   [错误] 未找到 npm
    goto end
)
echo   [OK] npm 已安装

REM node_modules
if not exist "node_modules\" (
    echo   [错误] node_modules 不存在，请先运行 npm install
    goto end
)
echo   [OK] node_modules 已安装

REM tsx
npx --no-install tsx --version >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   [错误] tsx 不可用，请先运行 npm install
    goto end
)
echo   [OK] tsx 可用

REM 端口检查（仅检查，不做复杂解析）
netstat -ano 2>nul | findstr ":%PORT% " | findstr "LISTENING" >nul
if %ERRORLEVEL% EQU 0 (
    if !KILL_PORT! EQU 1 (
        echo   [WARN] 端口 %PORT% 被占用，正在尝试释放...
        for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
            taskkill /PID %%a /F >nul 2>nul
        )
        timeout /t 1 /nobreak >nul
        netstat -ano 2>nul | findstr ":%PORT% " | findstr "LISTENING" >nul
        if %ERRORLEVEL% EQU 0 (
            echo   [错误] 端口释放失败，可能需要管理员权限
            goto end
        )
        echo   [OK] 端口已释放
    ) else (
        echo   [错误] 端口 %PORT% 已被占用
        echo   使用 --kill-port 自动释放
        goto end
    )
) else (
    echo   [OK] 端口 %PORT% 空闲
)

echo.
echo ── 启动服务 ──
echo   代理地址: http://%HOST%:%PORT%
echo   管理后台: http://%HOST%:%PORT%/admin
if "!MODE!"=="dev" (
    echo   模式:     开发模式（文件变更自动重启）
)
echo.
echo   按 Ctrl+C 停止服务
echo.

REM ── 启动 ──
if "!MODE!"=="dev" (
    set TSX_MODE=watch
) else (
    set TSX_MODE=
)

if !KILL_PORT! EQU 1 (
    npx tsx !TSX_MODE! src/index.ts --kill-port
) else (
    npx tsx !TSX_MODE! src/index.ts
)

:end
pause
