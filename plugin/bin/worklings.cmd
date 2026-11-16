@echo off
rem The Worklings CLI, bundled with the plugin, for cmd and PowerShell on Windows.
where node >nul 2>nul || (
  echo Worklings needs Node.js 22 or later, and there is no node on this PATH. Install it from https://nodejs.org/, then start Claude Code again. 1>&2
  exit /b 1
)
node "%~dp0..\scripts\worklings.mjs" %*
