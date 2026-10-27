@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
rem Creates a private Python environment in .venv and installs the analysis packages.
set "PY=python"
where py >nul 2>nul
if %errorlevel%==0 set "PY=py -3"
%PY% --version >nul 2>nul
if errorlevel 1 goto nopython
%PY% -m venv .venv
if errorlevel 1 goto nopython
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto fail
echo.
echo Done. Run run_analysis.bat to rebuild the data in web\data.
echo Дууслаа. web\data-г шинээр тооцохын тулд run_analysis.bat-ыг ажиллуулна уу.
pause
exit /b 0
:nopython
echo Python 3.10 or newer was not found. Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH") and run this file again.
echo Python 3.10+ олдсонгүй. https://www.python.org/downloads/ -оос суулгаад ("Add python.exe to PATH"-ийг чагтлаад) энэ файлыг дахин ажиллуулна уу.
pause
exit /b 1
:fail
echo Installing packages failed; see the messages above. / Багц суулгаж чадсангүй; дээрх мэдээллийг харна уу.
pause
exit /b 1
