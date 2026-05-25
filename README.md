# Token Tracker (토큰 트래커)

AI 토큰 사용량을 세션 단위로 추적하고 관리하는 CLI 도구입니다. OpenAI와 Anthropic API 호출 시 발생하는 input/output 토큰을 자동으로 계산하여 SQLite에 저장하고, 웹 대시보드에서 시각화합니다.

## 문제 상황

AI 코딩 어시스턴트(OpenAI, Anthropic)를 사용할 때마다 토큰이 소모되지만, 대부분의 개발자는 다음과 같은 문제를 겪습니다.

- 하루에 얼마나 많은 토큰을 사용했는지 알 수 없음
- 특정 작업(예: 리팩터링, 코드 리뷰)에 얼마나 사용했는지 구분 불가
- 월별 예산을 초과하기 직전까지 모름
- 여러 모델(gpt-4o, claude-sonnet-4)을 혼용할 때 각각의 사용량 파악이 어려움

Token Tracker는 이 모든 것을 자동으로 기록하고 보여줍니다.

## 주요 기능

- **PowerShell 전역 단축 도구 (`token`)** - 매개변수 없이 `token`만 실행하면 1~4번 숫자로 즉각 로그인, 대시보드 열기, 로그아웃을 수행할 수 있는 인터랙티브 대화형 메뉴 제공.
- **1초 자동 설정 패키지 (`setup.bat`)** - 더블클릭 한 번으로 프로젝트 종속성 설치 및 PowerShell 전역 명령어 주입, 윈도우 한글 인코딩 깨짐(UTF-8)을 원천 차단하는 최적화 자동 셋업 제공.
- **OpenAI API 어댑터 프록시 서버 (Auto-tracking)** - 대시보드 서버(`serve`)가 일반 `/v1/chat/completions` 트래픽을 가로채서 ChatGPT Plus 구독 Responses API 규격으로 투명하게 실시간 자동 변환/릴레이 및 역변환 수행.
- **실시간 글래스모피즘 웹 대시보드** - 3개 탭(Stats, Sessions, Q&A Log)으로 구성된 초현대적인 다크 테마 UI로, SSE(Server-Sent Events)를 통해 대화 발생 즉시 실시간 동기화 및 자동 갱신.
- **지능형 스트리밍 에뮬레이션 (Streaming Emulation)** - 스트리밍(`stream: true`) 요청 감지 시, 비-스트리밍 구독제 응답을 10~25ms 단위의 동적 타이핑 에뮬레이션 청크로 실시간 Emulate-feed하여 IDE 타이핑 모션 100% 보존.
- **세션 관리** - 작업별로 라벨을 붙여 토큰 사용량을 기록 (예: --label "refactor auth")
- **자동 토큰 계산** - tiktoken을 사용해 프롬프트 길이를 정확한 토큰 수로 변환
- **OpenAI + Anthropic 지원** - 두 API 모두 호출 시 자동 기록
- **로컬 SQLite 저장** - 모든 데이터는 ~/.token-tracker/tokens.db에 안전하게 보관
- **HTML 리포트** - Chart.js 기반 차트가 포함된 보고서 생성
- **CLI 출력 포맷** - 사람이 읽기 쉬운 테이블 형식 + JSON 출력 지원

## 아키텍처 개요

Token Tracker의 데이터 흐름은 다음과 같습니다.

```
사용자 입력 (CLI 명령어)
    │
    ▼
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│  cli.js     │────▶│  config.js   │────▶│ ~/.token-      │
│ (명령어 해석) │     │ (설정 관리)   │     │ tracker/       │
└──────┬──────┘     └──────────────┘     │ config.json    │
       │                                 └────────────────┘
       │
       ├──────────────────────────────────┐
       ▼                                  ▼
┌──────────────┐                  ┌──────────────┐
│ recorder.js  │                  │  oauth.js    │
│ (API 호출 +  │                  │ (OAuth PKCE  │
│  자동 기록)   │                  │  로그인)      │
└──────┬───────┘                  └──────────────┘
       │
       ▼
┌──────────────┐     ┌────────────────┐
│ tokenizer.js │────▶│    db.js       │
│ (tiktoken    │     │ (SQLite 저장소) │
│  토큰 계산)   │     │                │
└──────────────┘     └───────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌──────────┐  ┌──────────┐  ┌──────────────┐
       │ serve.js │  │report.js │  │ formatter.js │
       │ (웹 서버) │  │(HTML     │  │ (CLI 출력)    │
       │          │  │ 리포트)  │  │              │
       └────┬─────┘  └──────────┘  └──────────────┘
            ▼
       ┌──────────────┐
       │dashboard.html│
       │ (3-tab UI)   │
       └──────────────┘
```

### 각 모듈 설명

- **cli.js** - 모든 CLI 명령어의 진입점. commander.js 기반으로 명령어를 파싱하고 적절한 핸들러로 라우팅합니다.
- **config.js** - ~/.token-tracker/config.json 파일을 읽고 씁니다. API 키, 기본 모델, 설정값을 관리합니다.
- **db.js** - SQLite3 데이터베이스와의 모든 상호작용을 담당합니다. 세션(sessions), 토큰 항목(token_entries), 메타데이터(meta) 테이블로 구성됩니다.
- **recorder.js** - OpenAI/Anthropic API를 호출하고 응답을 받아 토큰 사용량을 자동으로 기록합니다.
- **tokenizer.js** - tiktoken 라이브러리를 사용해 프롬프트와 응답 텍스트의 토큰 수를 정확히 계산합니다. 모델별로 다른 인코딩 방식을 적용합니다.
- **oauth.js** - ChatGPT Plus 구독자를 위한 OAuth PKCE 로그인 플로우를 구현합니다. 브라우저 기반 인증을 통해 세션 토큰을 획득합니다.
- **serve.js** - Express 기반 웹 서버. 대시보드 HTML과 REST API 엔드포인트를 제공합니다.
- **dashboard.html** - 3개 탭(Stats, Sessions, Q&A Log)으로 구성된 싱글 페이지 웹 대시보드입니다. Chart.js로 차트를 그리고, fetch API로 서버 데이터를 가져옵니다.
- **report.js** - Chart.js 기반 HTML 리포트를 생성합니다. 날짜 범위 필터링을 지원합니다.
- **formatter.js** - CLI 출력을 보기 좋게 포맷팅합니다. 테이블 형식과 JSON 형식을 지원합니다.

## 설치 방법

### 1. 원클릭 자동 설치 (Windows 권장 🚀)
프로젝트 폴더 내에 포함된 **`setup.bat`** 파일을 마우스로 **더블클릭**하거나 실행하기만 하면 모든 설정이 끝납니다.
* **자동 수행 작업**:
  1. 프로젝트 실행을 위한 npm 패키지 종속성 자동 설치 (`npm install`)
  2. 현재 폴더의 동적 절대 경로를 추적하여 PowerShell 프로필(`$PROFILE`)에 전역 **`token`** 명령어 자동 주입 및 갱신
  3. 윈도우 PowerShell의 고질적인 한글 인코딩 깨짐을 방지하기 위한 전역 UTF-8 모드(`chcp 65001`) 자동 등록

설치 후 새로운 PowerShell 창을 열고 아래와 같이 입력하면, 초현대적인 대화형 메뉴가 시작됩니다!
```powershell
token
```

### 2. 소스에서 수동 실행
```bash
git clone https://github.com/bucheoncityboy/token-tracker.git
cd token-tracker
npm install
node src/cli.js --help
```

## 로그인 방식

Token Tracker는 OpenAI에 연결하는 두 가지 방식을 지원합니다. 각각 용도가 다릅니다.

### API 키 방식 (sk-...)

```bash
token-tracker openai login --key "sk-proj-xxxxxxxxxxxx"
```

OpenAI API를 직접 호출하여 토큰을 기록합니다. 사용량은 OpenAI 대시보드에 반영되며, 종량제(pay-as-you-go)로 과금됩니다.

**언제 사용하나요?**
- OpenAI API 키가 있고 직접 API를 호출하는 경우
- 토큰 사용량을 정확히 측정하고 싶은 경우
- 개발용, CI/CD 파이프라인, 자동화 스크립트

**토큰 계산 방식**: tiktoken을 사용해 프롬프트와 응답의 토큰 수를 실제로 계산합니다. 입력과 출력이 모두 정확히 집계됩니다.

### ChatGPT Plus OAuth 방식 (구독 로그인)

```bash
token-tracker openai login --subscription
```

ChatGPT Plus 구독 계정으로 OAuth PKCE(Proof Key for Code Exchange) 인증을 수행합니다. 브라우저가 열리고 OpenAI 로그인 페이지가 표시되며, 로그인 완료 후 세션 토큰이 로컬에 저장됩니다.

**언제 사용하나요?**
- ChatGPT Plus 구독자이고 추가 API 비용을 내지 않고 싶은 경우
- 웹 브라우저 기반 ChatGPT 사용량을 추적하고 싶은 경우
- API 키 발급이 제한된 환경

**주의사항**: OAuth 방식은 API 키 방식보다 속도가 느리고, 세션 토큰이 만료되면 재로그인이 필요할 수 있습니다.

### 우선순위

API 키는 다음 순서로 결정됩니다.

1. `--api-key` 플래그 (명령줄 직접 입력)
2. `OPENAI_API_KEY` 환경 변수
3. 설정 파일 (~/.token-tracker/config.json)에 저장된 키

### 로그인 상태 확인

```bash
token-tracker openai status
```

저장된 API 키나 OAuth 세션이 유효한지 확인합니다.

### 로그아웃

```bash
token-tracker openai logout
```

저장된 모든 인증 정보를 삭제합니다.

## 사용법

### 1. 초기화

Token Tracker를 처음 사용하기 전에 데이터베이스를 초기화합니다.

```bash
token-tracker init
```

~/.token-tracker/ 디렉토리와 tokens.db 파일이 생성됩니다.

### 2. 세션 관리

세션은 작업 단위로 토큰 사용량을 그룹화합니다. 예를 들어 "인증 시스템 리팩터링" 세션을 시작하면, 그동안의 모든 API 호출이 해당 세션에 귀속됩니다.

```bash
# 세션 시작 (라벨과 모델 지정)
token-tracker session start --label "refactor auth" --model gpt-4o

# 세션 종료
token-tracker session end

# 전체 세션 목록 보기
token-tracker ls

# 필터링된 세션 목록
token-tracker ls --since 7d                                    # 최근 7일
token-tracker ls --model gpt-4o                                # 특정 모델만
token-tracker ls --since 7d --model gpt-4o --json              # JSON 출력
```

### 3. 토큰 기록

#### API 호출로 자동 기록 (권장)

recorder가 OpenAI나 Anthropic API를 호출하면서 자동으로 토큰을 계산하고 저장합니다.

```bash
# OpenAI 모델 (gpt-4o, gpt-4o-mini 등)
token-tracker call --prompt "Explain the singleton pattern in Python" --model gpt-4o

# Anthropic 모델 (claude-sonnet-4, claude-opus-4 등)
token-tracker call --prompt "Summarize this PR" --model claude-sonnet-4 --api-type anthropic

# 출력 길이 제한 (max-tokens)
token-tracker call --prompt "Write an essay" --model gpt-4o --max-tokens 2000

# 온도 조절
token-tracker call --prompt "Creative writing" --model gpt-4o --temperature 0.9
```

#### 직접 기록

파이프나 JSON 파일을 통해 수동으로 토큰 수를 기록할 수도 있습니다.

```bash
# JSON 파이프
echo '{"input":50,"output":150}' | token-tracker record

# 또는 표준 입력 리디렉션
cat token_data.json | token-tracker record
```

### 4. 사용량 확인

```bash
# 현재 세션 상태
token-tracker status

# 전체 통계
token-tracker stats
```

status 명령어는 현재 활성 세션의 토큰 사용량, 실행 시간, 모델 정보를 보여줍니다.

### 5. 리포트 생성

HTML 리포트에는 Chart.js 기반의 차트가 포함됩니다. 전체 사용량 추이, 모델별 분포, 일별 사용량 등을 한눈에 볼 수 있습니다.

```bash
# 전체 기간 리포트
token-tracker report --html

# 최근 30일 리포트
token-tracker report --html --since 30d

# 특정 시작일 지정
token-tracker report --html --since 2026-01-01
```

리포트 파일은 현재 디렉토리에 token-tracker-report.html 이름으로 생성됩니다.

### 6. 웹 대시보드

실시간으로 데이터를 확인할 수 있는 웹 대시보드를 실행합니다.

```bash
# 기본 포트(3000)로 실행
token-tracker serve

# 커스텀 포트
token-tracker serve --port 4000
```

* **실시간 동기화**: 브라우저에서 `http://localhost:3000`으로 접속하면, 다크 테마 기반의 모던 대시보드가 열립니다. API 호출이나 세션에 변화가 생기면 백그라운드 SSE(Server-Sent Events)를 통해 대시보드 화면이 실시간으로 부드럽게 자동 갱신됩니다.

---

### 7. OpenAI API 자동 변환/추적 어댑터 프록시 (Auto-tracking)

대시보드 서버(`serve`)가 켜져 있는 동안, 외부 AI 코딩 어시스턴트(VS Code 익스텐션, Codex, 커스텀 에이전트 등)에서 발생하는 모든 실제 대화와 토큰 소모량을 **수동 기록 없이 100% 무자각으로 실시간 감시 및 SQLite DB에 자동 저장**할 수 있습니다.

#### ⚙️ 연동 설정 방법
사용하시는 AI 에이전트(Codex 등) 혹은 외부 클라이언트의 **OpenAI API Base URL**을 아래와 같이 수정하기만 하면 즉시 무자각 트래킹 모드가 가동됩니다.
* **기존**: `https://api.openai.com/v1`
* **변경**: `http://localhost:3000/v1`

#### ⚙️ 동작 메커니즘 & 투명 스펙 변환 (Adapter Spec Translation)
1. **트래픽 감지 및 릴레이**: 외부 툴이 `http://localhost:3000/v1/chat/completions`로 쏘는 트래픽을 가로채서, 현재 `token`에 로그인되어 있는 OpenAI 인증 유형(구독제 또는 API Key)에 맞춰 헤더를 지능적으로 보강하고 실제 OpenAI 서버로 안전하게 중계(Relay)합니다.
2. **구독제 무제한 토큰 투명 변환**:
   * 만약 사용자가 **ChatGPT Plus 구독(`subscription`)** 모드로 로그인해 둔 경우, 프록시 서버가 외부 툴의 일반 API 스펙 요청을 구독용 **Responses API 스펙**(`{ input: ... }`)으로 중간에서 투명하게 자동 변환하여 OpenAI에 요청을 날립니다.
   * OpenAI로부터 돌아온 응답 역시 일반 API 스펙(`choices[0].message.content`)으로 역변환하여 외부 툴로 내려줍니다.
   * **결과**: 외부 툴의 소스 코드를 단 한 줄도 수정하지 않고도 오직 Base URL 변경만으로 **구독제 무제한 토큰의 혜택을 그대로 누릴 수 있습니다!**
3. **지능형 스트리밍 에뮬레이션 (Streaming Emulation)**:
   * 외부 툴이 실시간 타이핑 효과를 위해 `"stream": true`를 요구하는 경우, 프록시는 일괄(Non-stream) 구독제 답변을 긁어온 즉시 **10~25ms 단위의 동적 타이핑 에뮬레이션 청크(SSE Event Stream)**로 쪼개어 실시간으로 Emulate-feed 해줍니다.
   * **결과**: IDE 상의 실시간 타이핑 애니메이션 모션이 100% 끊김 없이 유려하게 보존됩니다.

---

### 8. 도움말

```bash
token-tracker --help
token-tracker <command> --help
```

### 전체 명령어 요약

| 명령어 | 설명 |
|---------|------|
| `init` | 데이터베이스 및 설정 초기화 |
| `session start` | 새 세션 시작 |
| `session end` | 현재 세션 종료 |
| `call` | API 호출 + 자동 토큰 기록 |
| `record` | 수동 토큰 기록 (stdin) |
| `ls` | 세션 목록 출력 |
| `status` | 현재 세션 상태 확인 |
| `report --html` | HTML 리포트 생성 |
| `serve` | 웹 대시보드 실행 |
| `openai login` | OpenAI 로그인 |
| `openai logout` | 로그아웃 |
| `openai status` | 로그인 상태 확인 |

## 파일 구조

```
token-tracker/
├── src/                    # 소스 코드
│   ├── cli.js              # CLI 진입점, 명령어 정의 (commander.js)
│   ├── db.js               # SQLite 데이터베이스 관리
│   ├── recorder.js         # API 호출 및 자동 토큰 기록
│   ├── tokenizer.js        # tiktoken 기반 토큰 계산
│   ├── config.js           # 설정 파일 관리
│   ├── oauth.js            # OAuth PKCE 로그인 (ChatGPT Plus)
│   ├── serve.js            # 웹 대시보드 서버 (Express)
│   ├── dashboard.html      # 대시보드 UI (Chart.js, 3-tab layout)
│   ├── report.js           # HTML 리포트 생성기
│   └── formatter.js        # CLI 출력 포맷팅
├── package.json
├── README.md
└── LICENSE
```

## 환경 변수

| 변수 | 설명 |
|------|------|
| `OPENAI_API_KEY` | OpenAI API 키 (sk-... 형식) |
| `OPENAI_BASE_URL` | OpenAI API 엔드포인트 (기본값: https://api.openai.com) |

## 데이터 저장소

모든 데이터는 ~/.token-tracker/ 디렉토리에 저장됩니다.

```
~/.token-tracker/
├── tokens.db           # SQLite 데이터베이스
├── config.json         # 설정 파일 (API 키, 기본 모델 등)
└── oauth-token.json    # OAuth 세션 토큰 (ChatGPT Plus 로그인 시)
```

### 데이터베이스 구조 (tokens.db)

- **sessions** 테이블: 세션 ID, 라벨, 모델, 시작/종료 시간, 상태
- **token_entries** 테이블: 각 API 호출의 input/output 토큰 수, 타임스탬프, 연결된 세션 ID
- **meta** 테이블: 버전 정보, 설정 키-값 쌍

데이터베이스 파일을 직접 삭제하거나 초기화하려면 `token-tracker init` 명령어를 다시 실행하세요. (기존 데이터는 모두 삭제됩니다.)

## 라이선스

MIT

누구나 자유롭게 사용, 수정, 배포할 수 있습니다. 자세한 내용은 LICENSE 파일을 참고하세요.
