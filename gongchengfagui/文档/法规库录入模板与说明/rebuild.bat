@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
set "PY=C:/Users/admin/.workbuddy/binaries/python/versions/3.13.12/python.exe"
set "GEN=..\law-knowledge-base"

echo [1/5] 自动归位：将 0新录入 的文件按 level 移入 1~12 文件夹 ...
"%PY%" "new_law.py" place --all

echo [2/5] 校验法规库（level匹配 / 重复检测）...
"%PY%" "check.py"
if errorlevel 1 (echo. & echo 校验发现问题，请查看上方提示。 & echo 按任意键继续构建，或关闭此窗口取消 & pause)

echo [3/5] 构建检索索引 index_builder.py ...
"%PY%" "%GEN%\index_builder.py"
if errorlevel 1 (echo 索引构建失败 ^& pause ^& exit /b 1)

echo [4/5] 生成阅读站 gen_website.py ...
"%PY%" "%GEN%\scripts\gen_website.py"
if errorlevel 1 (echo 阅读站生成失败 ^& pause ^& exit /b 1)

echo [5/5] 生成导航门户 gen_nav.py ...
"%PY%" "%GEN%\scripts\gen_nav.py"
if errorlevel 1 (echo 导航门户生成失败 ^& pause ^& exit /b 1)

echo [+1] 更新法规清单 法规清单.xlsx ...
"%PY%" "gen_xlsx.py"
if errorlevel 1 (echo 法规清单更新失败 ^& pause ^& exit /b 1)

echo.
echo 完成！浏览器刷新 index-read.html / index.html 查看网页；法规清单.xlsx 已同步更新。
pause
