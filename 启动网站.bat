@echo off
chcp 936 >nul 2>&1
setlocal EnableDelayedExpansion
title 三角洲行动动画编辑器 - 本地启动器

cd /d "%~dp0"

echo.
echo  ================================================================
echo    三角洲行动动画编辑器  Delta Force Animation Editor
echo    本地一键启动
echo  ================================================================
echo.

REM ---------- 0. 基本环境检查 ----------
where node >nul 2>&1
if errorlevel 1 (
    echo  [X] 没有找到 Node.js。
    echo.
    echo      请先安装 Node.js ^(建议 20 或更高版本^):
    echo        https://nodejs.org/
    echo.
    echo      装完后重新双击本文件即可。
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v 2^>nul') do set "NODEVER=%%v"
echo  [1/5] Node.js !NODEVER!   OK

REM ---------- 1. 依赖检查 / 安装 ----------
if exist "node_modules\vite" (
    echo  [2/5] 依赖已就绪
) else (
    echo  [2/5] 首次运行,正在安装依赖 ^(需要联网,可能要一两分钟^)...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo  [X] 依赖安装失败。请检查网络后重试。
        echo      若公司网络需要代理,可先执行:
        echo        npm config set registry https://registry.npmmirror.com
        echo.
        pause
        exit /b 1
    )
    echo.
    echo  [2/5] 依赖安装完成
)

REM ---------- 2. 自动挑选可用端口(被占用就往后顺延) ----------
set "PORT="
set "MAXPORT=5190"
for /l %%p in (5173,1,%MAXPORT%) do (
    if not defined PORT (
        call :port_free %%p
        if !errorlevel! equ 0 set "PORT=%%p"
    )
)
if not defined PORT (
    echo  [X] 5173-%MAXPORT% 之间的端口全部被占用,无法启动。
    echo      请先关闭一些程序再试。
    echo.
    pause
    exit /b 1
)

if "%PORT%"=="5173" (
    echo  [3/5] 端口 5173 可用
) else (
    echo  [3/5] 端口 5173 被占用,自动改用 %PORT%
)

set "URL=http://localhost:%PORT%/"

REM ---------- 3. 启动开发服务器 ----------
echo  [4/5] 正在启动本地服务器...
echo.
echo  ----------------------------------------------------------------
echo    地址:  %URL%
echo.
echo    浏览器会自动打开;若没打开,手动把上面的地址粘进地址栏。
echo.
echo    停止服务器:在本窗口按 Ctrl+C,或直接关掉本窗口。
echo    提示:本站预览与导出依赖 WebCodecs,请用 Chrome 或 Edge 打开。
echo  ----------------------------------------------------------------
echo.

start "" /b cmd /c "timeout /t 4 /nobreak >nul & start "" "%URL%""

echo  [5/5] 服务运行中,日志如下:
echo.

call npm run dev -- --port %PORT% --strictPort

echo.
echo  服务器已停止。
pause
exit /b 0


REM ==================================================================
REM  子过程:检测端口是否空闲
REM  空闲返回 0,被占用返回 1
REM ==================================================================
:port_free
set "BUSY="
for /f "tokens=*" %%L in ('netstat -ano -p TCP ^| findstr /r /c:":%~1 .*LISTENING"') do set "BUSY=1"
if defined BUSY exit /b 1
exit /b 0
