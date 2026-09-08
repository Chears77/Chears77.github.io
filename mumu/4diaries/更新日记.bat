@echo off
chcp 65001 >nul
setlocal
set "PY=C:\Users\admin\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
if not exist "%PY%" set "PY=python"
"%PY%" "%~dp0..\gen_diary.py"
if "%~1"=="" pause
