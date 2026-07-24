@echo off
title King Math Craft Server
echo ========================================================
echo   Starting King Math Craft Web Application Server...
echo   URL: http://localhost:8000
echo ========================================================
echo.
uv run --with aiohttp python server.py
pause
