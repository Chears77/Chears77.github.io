@echo off
chcp 65001 >nul
title 文章列表一键更新
cd /d "%~dp0"
echo.
echo ==============================================
echo   正在校验标题/日期并更新文章列表，请稍候...
echo ==============================================
echo.
node generate-index.js
if errorlevel 1 (
    echo.
    echo [失败] 运行出错：请确认电脑已安装 Node.js 后重试
) else (
    echo.
    echo [完成] 目录页、所有文章左侧列表均已同步！
)
echo.
pause
