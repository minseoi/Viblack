# Viblack

![Viblack Title](docs/images/title.png)

Viblack은 여러 AI 멤버가 DM과 채널에서 작업을 나눠 수행하도록 돕는 AI 작업 오케스트레이션 데스크톱 앱입니다.  
Electron 데스크톱 앱 안에서 로컬 백엔드와 SQLite 저장소를 사용하며, Codex 로컬 런타임을 연결해 채널별 워크스페이스 안에서 위임, 보고, 결과 공유 흐름을 관리합니다.

## 핵심 기능
- 역할과 시스템 프롬프트를 가진 AI 멤버를 만들고 관리할 수 있습니다.
- 멤버별 DM에서 1:1 작업을 요청하고 이어갈 수 있습니다.
- 채널에 여러 멤버를 초대하고 멘션으로 작업을 시작할 수 있습니다.
- 채널 멤버는 액션 블록을 통해 다른 멤버에게 작업을 위임하거나 결과를 보고할 수 있습니다.
- 각 채널은 전용 워크스페이스 경로를 가지며, 작업은 해당 디렉토리를 기준으로 실행됩니다.
- 활성 채널끼리는 같은 워크스페이스를 공유할 수 없습니다.
- 설정에서 Codex 모델과 디버그 모드를 관리할 수 있습니다.
- 역할 정보를 바탕으로 멤버 시스템 프롬프트 초안 생성을 지원합니다.

## 아키텍처 개요
```text
Electron Renderer
  -> Preload IPC bridge
  -> Local Express backend
       -> SQLite app data
       -> Codex local runtime
       -> Channel workspace directories
```

렌더러는 preload bridge를 통해 로컬 백엔드 주소와 OS 기능에 접근하고, 실제 멤버/채널 실행은 로컬 Express 백엔드가 관리합니다. 백엔드는 SQLite에 앱 상태를 저장하고, Codex 로컬 런타임과 채널별 워크스페이스 디렉토리를 연결합니다.

## 핵심 개념
- `Agent`
  재사용 가능한 AI 멤버입니다. 이름, 역할, 시스템 프롬프트를 가집니다.
- `DM`
  사용자와 특정 멤버 사이의 1:1 작업 공간입니다.
- `Channel`
  여러 멤버가 함께 일하는 협업 공간입니다. 멤션과 응답 체인을 통해 작업이 이어집니다.
- `Workspace`
  채널 작업의 기준이 되는 로컬 디렉토리입니다. 채널 생성/수정 시 지정하며, 존재하는 읽기/쓰기 가능한 절대경로여야 합니다.

## 빠른 시작

### 사전 조건
- Node.js 22+
- 로컬 Codex 명령 사용 가능
- 터미널에서 `codex --version`이 정상 실행됨

여기서 Codex는 OpenAI의 코딩 에이전트 로컬 클라이언트를 의미합니다. 설치와 인증 방식은 사용하는 Codex 버전에 따라 달라질 수 있으므로 OpenAI의 [Codex CLI 시작 가이드](https://help.openai.com/en/articles/11096431)와 [ChatGPT로 Codex CLI 로그인하기](https://help.openai.com/en/articles/11381614-api-codex-cli-and-sign-in-with-chatgpt)를 참고하세요.

### 실행
```bash
npm install
npm run start
```

앱을 처음 열면 기본 멤버 `Helper`가 준비된 상태로 시작합니다.

채널을 만들 때는 다음 조건을 만족하는 워크스페이스를 지정해야 합니다.
- 이미 존재하는 디렉토리
- 절대경로
- 읽기/쓰기 가능
- 다른 활성 채널과 중복되지 않는 경로

필요하면 앱 왼쪽 하단의 환경 설정에서 모델 선택과 디버그 모드를 조정할 수 있습니다.

## 사용 흐름
1. 앱을 실행하면 로컬 백엔드와 Codex 사용 가능 상태를 확인하고 기본 멤버 `Helper`를 로드합니다.
2. 새 멤버를 추가할 때 이름, 역할, 시스템 프롬프트를 직접 입력하거나 시스템 프롬프트 생성을 사용할 수 있습니다.
3. DM에서는 특정 멤버와 1:1로 작업을 진행합니다.
4. 채널을 만들 때 설명과 함께 전용 워크스페이스를 지정합니다.
5. 채널에 멤버를 추가한 뒤 메시지와 멘션으로 협업을 시작합니다.
6. 채널 멤버는 액션 블록을 통해 다른 멤버에게 위임하거나, 결과를 보고하거나, 사용자에게 추가 질문을 요청할 수 있습니다.

## 프롬프트 템플릿

프롬프트 템플릿은 `src/backend/prompt-templates/` 아래에 있고, 앱 시작 시 backend가 한 번 로드합니다. 템플릿 파일을 수정한 뒤에는 앱을 다시 실행해야 반영됩니다.

- `default-member-system-prompt.md`
  새 멤버 생성 모달을 열었을 때 기본값으로 채워지는 시스템 프롬프트입니다. 사용자가 직접 수정하지 않고 저장하면 이 템플릿이 멤버의 초기 `systemPrompt`가 됩니다.
- `member-execution-system-prompt.md`
  DM과 채널에서 멤버 실행 요청을 만들 때 공통으로 쓰는 실행용 시스템 프롬프트 골격입니다. 멤버 이름, 역할, 실행 컨텍스트, 사용자가 저장한 멤버별 시스템 프롬프트가 여기에 주입됩니다.
- `member-execution-channel-rules.md`
  채널 실행일 때만 `member-execution-system-prompt.md` 안에 추가되는 채널 전용 규칙입니다. 멘션 위임, `CHANNEL_ACTION` 형식, artifact 보고, 채널 워크스페이스 제한 같은 협업 규칙이 여기에 들어갑니다.
- `system-prompt-generation-user.md`
  멤버 생성/수정 모달에서 `시스템 프롬프트 자동 생성`을 눌렀을 때 Codex에 보내는 user prompt 템플릿입니다. 멤버 이름과 역할이 치환되어 초안 생성 요청에 사용됩니다.
- `system-prompt-generation-system.md`
  같은 자동 생성 흐름에서 함께 전달되는 system prompt 템플릿입니다. Codex가 설명 없이 최종 시스템 프롬프트 본문만 반환하도록 제한하는 역할을 합니다.

## 개발 및 테스트

### 주요 명령
```bash
npm run check
npm run build
npm run start
npm run test:e2e
npm run verify
npm run eval:prompt
```

- `npm run check`: TypeScript 타입 검사
- `npm run build`: `dist/` 빌드
- `npm run start`: 빌드 후 Electron 앱 실행
- `npm run test:e2e`: Playwright 기반 E2E 실행
- `npm run verify`: `check + build + test:e2e` 전체 회귀 실행
- `npm run eval:prompt`: prompt regression/evaluator 시나리오 실행

### 테스트 참고
- UI 시나리오는 Electron Playwright로 검증합니다.
- API 중심 시나리오는 backend-only test harness로 검증해 불필요한 창 실행을 줄였습니다.
- 실제 Codex를 쓰는 일부 E2E는 opt-in이며 기본 `verify`에서는 skip 됩니다.
- GUI 접근 권한이 부족한 환경에서는 Electron/Playwright 실행 시 `Process failed to launch`, `spawn EPERM`, `kill EPERM`가 날 수 있습니다. 이런 경우 권한이 있는 터미널에서 다시 실행하세요.

### 유용한 환경 변수
- `VIBLACK_DB_PATH`: 기본 SQLite 경로 override
- `VIBLACK_CODEX_PATH`: 사용할 `codex` 실행 파일 경로 override
- `VIBLACK_CODEX_RUNTIME`: Codex 실행 경로 선호값 (`app-server`, `exec`)
- `VIBLACK_MODELS_CACHE_PATH`: 모델 캐시 파일 경로 override

## 기여
이슈 제보와 PR은 환영합니다. 변경 전에는 [AGENTS.md](AGENTS.md)의 작업 규칙을 확인하고, 기능 변경에는 관련 Playwright E2E와 `npm run verify` 결과를 함께 남겨주세요.

## 라이선스
`package.json` 기준 라이선스는 ISC입니다.
