@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
set "PY=C:/Users/admin/.workbuddy/binaries/python/versions/3.13.12/python.exe"

echo ==========================================================
echo   工程建设法规知识库 —— 一键更新（安全版）
echo   作用：把 0新录入 的 md 自动归位 + 校验 + 重建检索数据
echo   注意：本脚本不重写 app.js / app.css，不会破坏 AI 问答功能
echo ==========================================================

echo [1/3] 自动归位：将 0新录入 的文件按 level 移入 01~12 层级文件夹 ...
"%PY%" "new_law.py" place --all --go
if errorlevel 1 (echo 归位脚本报错，请查看上方提示。 & pause & exit /b 1)

echo [2/3] 校验法规库（level 匹配 / 重复检测）...
"%PY%" "check.py"
if errorlevel 1 (
  echo.
  echo 校验发现问题，请查看上方提示。
  echo 按任意键继续重建，或关闭此窗口取消。
  pause
)

echo [3/3] 重建检索数据（data/manifest.json, data/search.json, laws/*.md）...
"%PY%" "..\build_data.py"
if errorlevel 1 (echo 数据重建失败 ^& pause ^& exit /b 1)

echo [+1] 更新法规清单台账（法规清单.xlsx）...
"%PY%" "gen_xlsx.py"
if errorlevel 1 (echo 法规清单更新失败 ^& pause ^& exit /b 1)

echo.
echo 完成！本地刷新 index.html 即可看到新法规。
echo （如要同步到 GitHub 网页，请手动复制 3第二版 到 gongchengfagui 并 push）
echo.
pause
