@echo off
rem Starts WireDraft from source. Uses resources\runtime\node.exe if present, else the installed Node.
cd /d "%~dp0"
set NODE=node
if exist "%~dp0resources\runtime\node.exe" set NODE="%~dp0resources\runtime\node.exe"
%NODE% app\server.js %*
