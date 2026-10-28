@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Downloads NASA POWER and NSIDC data and rebuilds web\data (about 20-30 minutes, internet needed).
if not exist ".venv\Scripts\python.exe" (
  echo Run install_analysis.bat first. / Эхлээд install_analysis.bat-ыг ажиллуулна уу.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -m trend_detective build %*
echo.
echo Open TrendDetective.html to see the results. / Үр дүнг харахын тулд TrendDetective.html-ийг нээнэ үү.
pause
