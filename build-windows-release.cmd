@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not available in PATH.
  echo Install Node.js 22 and run this command again.
  exit /b 1
)

where dotnet >nul 2>&1
if errorlevel 1 (
  echo ERROR: The .NET 8 SDK is not installed or is not available in PATH.
  echo Install the .NET 8 SDK and run this command again.
  exit /b 1
)

echo Installing locked dependencies...
call npm.cmd ci
if errorlevel 1 exit /b %errorlevel%

echo Building and verifying Freaky IPTV for Windows...
call npm.cmd run release:win
if errorlevel 1 exit /b %errorlevel%

echo.
echo Release completed. Files are in: %~dp0release
endlocal
