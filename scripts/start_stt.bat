@echo off
title VAlumni - faster-whisper Speech-to-Text Service
cd /d "%~dp0\..\stt_service"

set PYTHON_EXE="C:\Users\Benedict Hornilla\AppData\Local\Programs\Python\Python312\python.exe"

if not exist %PYTHON_EXE% (
    set PYTHON_EXE=python
)

echo ========================================================
echo  Launching VAlumni faster-whisper (Large-v3-Turbo)
echo  Endpoint: http://127.0.0.1:8000
echo ========================================================

%PYTHON_EXE% app.py
pause
