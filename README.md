# 🪨 Token Tracker (토큰 트래커)

> AI 코딩 중 소모되는 토큰량과 비용을 100% 무자각으로 실시간 감시하고 시각화하는 초현대적 토큰 트래킹 솔루션입니다.
> 
> **ChatGPT Plus 구독(Responses API) 및 일반 API Key를 모두 지원**하며, 복잡한 설정 없이 더블클릭과 전역 `token` 명령어 단 하나로 모든 개발 환경을 제어합니다.

---

## 🤖 AI Agent / LLM Quick Setup (귀찮으면 그냥 복사해서 붙여넣기 하세요)

> [!NOTE]
> AI 에이전트(LLM)나 코딩 어시스턴트가 이 저장소를 읽고 있다면, 아래 스크립트 블록을 그대로 실행하여 원클릭으로 설치 및 연동을 완료해 주세요.

### 윈도우 파워쉘(PowerShell) 원클릭 통합 설치 스크립트
프로젝트 루트 디렉토리에서 아래 파워쉘 명령어를 복사하여 터미널에 붙여넣기 하세요. 의존성 설치, PowerShell 전역 `token` 명령어 등록, 윈도우 UTF-8 한글 깨짐 방지 설정까지 한 번에 완료됩니다.

```powershell
npm install; node src/setup-profile.js; Write-Host "`n✓ Installation and global token command setup completed successfully!" -ForegroundColor Green
```

설치가 끝난 후 다른 LLM/에이전트가 즉각 호출할 수 있는 단독 명령어 모음입니다:
* **개발 환경 연동 및 해제**:
  * VS Code & Continue 자동 연동: `token link`
  * 기존 설정으로 완벽 복구: `token unlink`
* **로그인 및 서버 제어**:
  * OpenAI Plus 구독 로그인: `token login`
  * 실시간 웹 대시보드 서버 가동 및 실행: `token dashboard`
  * 로그아웃 및 백그라운드 서버 종료: `token logout`
  * 현재 로그인 세션 상태 확인: `token status`

---

## 🚀 3초 완성 초간단 설치법 (Windows)

프로젝트 폴더 내에 포함된 **`setup.bat`** 파일을 마우스로 **더블클릭**만 하시면 설치가 완료됩니다!
* **자동 완료되는 작업**:
  1. 필요한 npm 패키지 자동 설치 (`npm install`)
  2. PowerShell 프로필(`$PROFILE`)에 전역 **`token`** 단축 명령어 자동 등록 및 한글 인코딩(UTF-8) 깨짐 완벽 방지 세팅

---

## ⚡ 핵심 사용법 (이것만 따라하면 끝!)

파워쉘 터미널을 열고 **`token`**을 입력하면 모든 작업이 가능한 인터랙티브 메뉴가 열립니다.

```powershell
token
```

```
==================================================
        🪨  Token Tracker - Interactive Menu
==================================================

  Please choose an action:
  [1] OpenAI Subscription Login (login)           <- 구독(Plus) 로그인 또는 API 키 등록
  [2] Open Real-time Dashboard (dashboard)        <- 실시간 웹 대시보드 실행 및 열기
  [3] Auto-Link IDE Settings to Local Proxy (link) <- VS Code 및 Continue 1초 자동 연동
  [4] Auto-Unlink IDE Settings (unlink)           <- 연동 해제 및 기존 설정 완벽 복구
  [5] Logout & Close Background Server (logout)   <- 백그라운드 서버 종료 및 로그아웃
  [6] Exit (exit)

==================================================
Choice (1-6):
```

### 🎯 4단계 퀵스타트 가이드

1. **로그인 (`[1]` 선택)**
   * ChatGPT Plus 구독자라면 브라우저 자동 인증을 통해 **무제한 구독 모드**로 구동 가능합니다. (API 키 등록 방식도 완벽 지원)
2. **IDE 1초 연동 (`[3]` 선택)**
   * 귀찮은 수동 설정은 이제 그만! VS Code와 Continue의 OpenAI API 주소를 알아서 가로채 `http://localhost:3000/v1` 로컬 프록시 주소로 자동 연동합니다.
3. **대시보드 구동 (`[2]` 선택)**
   * 실시간 다크 테마 글래스모피즘 웹 대시보드가 브라우저에 열립니다.
4. **코딩 및 실시간 트래킹 시작!**
   * VS Code나 IDE에서 평소처럼 Codex 또는 AI 어시스턴트로 코딩하세요! 소모되는 토큰이 실시간으로 대시보드에 기록됩니다.
   * 작업이 끝나면 **`[4]`**를 눌러 기존 개발 환경 설정으로 깔끔하게 원복(Unlink)할 수 있습니다.

---

## 💎 주요 핵심 기술

* **OpenAI API 투명 어댑터 프록시 (Auto-tracking)**
  * 외부 AI 코딩 툴이 쏘는 일반 `/v1/chat/completions` 요청을 가로채 ChatGPT Plus **Responses API 스펙**으로 실시간 지능형 중계 및 역변환을 수행합니다.
* **지능형 스트리밍 에뮬레이션 (Streaming Emulation)**
  * 구독제 API가 지원하지 않는 실시간 스트리밍(`stream: true`)을 위해, 비-스트리밍 응답을 **10~25ms 단위의 동적 타이핑 SSE 청크**로 쪼개어 실시간으로 에뮬레이션 전송해 줍니다. IDE의 타이핑 모션이 100% 보존됩니다.
* **실시간 SSE 다크 테마 대시보드**
  * SSE(Server-Sent Events) 프로토콜을 사용해 새로고침 없이 실시간으로 토큰 통계, 세션 흐름, Q&A 로그를 초현대적인 UI로 볼 수 있습니다.

---

## 🛠️ 고급/수동 명령어 요약 (CLI)

인터랙티브 메뉴를 거치지 않고 터미널에서 즉시 단독 명령으로 실행할 수도 있습니다.

| 명령어 | 동작 설명 |
|---|---|
| `token link` | VS Code 및 Continue 설정을 로컬 프록시 주소로 즉시 연동 |
| `token unlink` | 연동을 즉시 해제하고 원래의 IDE 설정으로 복구 |
| `token dashboard` | 실시간 웹 대시보드 서버 가동 및 브라우저 열기 |
| `token login` | OpenAI 로그인 플로우 가동 |
| `token logout` | 서버 종료 및 저장된 인증 정보 완전 삭제 |
| `token status` | 현재 로그인 세션 상태 및 토큰 통계 확인 |

---

## 📂 파일 및 데이터 저장소

모든 토큰 데이터는 로컬 환경에 안전하게 SQLite3로 보관됩니다.

* **설정 및 데이터 디렉토리**: `~/.token-tracker/` (C:\Users\<User>\.token-tracker)
  * `tokens.db`: SQLite 데이터베이스 (모든 토큰 및 질문 로그)
  * `config.json`: 로컬 설정 및 API 구성
  * `oauth-token.json`: Plus 구독 인증 정보

---

## 📄 라이선스

MIT. 자유로운 수정 및 상업적 이용을 보장합니다.
