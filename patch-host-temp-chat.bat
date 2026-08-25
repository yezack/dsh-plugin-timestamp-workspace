@echo off
chcp 65001 >nul
echo Applying the DSH temp-conversation host patch...
node "%~dp0scripts\patch-host-temp-chat.mjs"
node "%~dp0scripts\patch-host-temp-chat.mjs" --check
echo.
echo Done. Restart DeepSeek Harness Desktop now.
pause
