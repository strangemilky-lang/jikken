@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo ==================================================
echo  Strip Hero - Single HTML Build Tool
echo ==================================================
echo.

where node >nul 2>&1
if not errorlevel 1 goto :node_ready

if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
if exist "%USERPROFILE%\.volta\bin\node.exe" set "PATH=%USERPROFILE%\.volta\bin;%PATH%"

where node >nul 2>&1
if errorlevel 1 goto :no_node

:node_ready
if exist "node_modules" goto :run_build
echo [1/2] Installing dependencies...
call npm install
if errorlevel 1 goto :err_install

:run_build
echo [2/2] Building single HTML file...
call npm run build:html
if errorlevel 1 goto :err_build

echo.
echo ==================================================
echo  Build succeeded!
echo  Output: %~dp0standalone\strip-hero.html
echo  Double-click strip-hero.html to play offline.
echo ==================================================
echo.
pause
exit /b 0

:no_node
echo [ERROR] Node.js was not found on this PC.
echo.
echo To rebuild from source code, install Node.js LTS from:
echo   https://nodejs.org/
echo After installing, restart your PC or terminal and run this bat again.
echo.
if exist "standalone\strip-hero.html" goto :already_exists
pause
exit /b 1

:already_exists
echo [INFO] A pre-built standalone HTML is already ready to play:
echo   %~dp0standalone\strip-hero.html
echo You can double-click it directly without Node.js!
echo.
pause
exit /b 0

:err_install
echo.
echo [ERROR] npm install failed. Check your internet connection.
echo.
pause
exit /b 1

:err_build
echo.
echo [ERROR] HTML build failed. See the error log above.
echo.
pause
exit /b 1
