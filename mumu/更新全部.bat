@echo off
chcp 65001 >nul
setlocal
set "ROOT=%~dp0"
set "PY=C:\Users\admin\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

echo ============================================
echo   Alisa 成长纪念册 · 一键更新全部专题
echo ============================================
echo.

echo [1/5] 更新荣誉墙 ...
call "%ROOT%2rongyuqiang\推送到网站.bat" nopause
echo.

echo [2/5] 更新相册画廊 ...
call "%ROOT%3gallery\推送到网站.bat" nopause
echo.

echo [3/5] 更新成长时间轴 ...
call "%ROOT%1timeline\更新时间轴.bat" nopause
echo.

echo [4/5] 更新成长日记 ...
call "%ROOT%4diaries\更新日记.bat" nopause
echo.

echo [5/5] 刷新首页数据缓存 ...
"%PY%" "%ROOT%刷新首页缓存.py"
echo.

echo ============================================
echo   全部更新完成！刷新浏览器（Ctrl+Shift+R）即可看到最新内容。
echo ============================================
pause
