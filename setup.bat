@echo off
title 🪨 Token Tracker - 1초 자동 패키지 셋업
echo ==================================================
echo   🪨  Token Tracker - 1초 자동 패키지 셋업
echo ==================================================
echo.
echo 1. 프로젝트 종속성 패키지 설치 진행 중...
call npm install
echo.
echo 2. PowerShell 전역 명령어(token) 프로필 등록 중...
node "%~dp0src\setup-profile.js"
echo.
echo ==================================================
echo ✓ 패키지 및 전역 명령어 셋업이 완료되었습니다!
echo.
echo [!] 새로운 PowerShell 창을 열고 그냥 'token'을 치시면 대화형 메뉴가 나타납니다.
echo ==================================================
echo.
pause
