Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  Starting King Math Craft Web Application Server..." -ForegroundColor Green
Write-Host "  URL: http://localhost:8000" -ForegroundColor Yellow
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""
uv run --with aiohttp python server.py
