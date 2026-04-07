# Viblack

![Viblack Title](docs/images/title.png)

Codex CLI를 실행 런타임으로 사용하는 AI 워크스페이스입니다.  
DM과 채널 중심 메신저 인터페이스로 여러 AI 멤버를 구성하고, 채널별 워크스페이스 안에서 협업 작업을 진행할 수 있습니다.

## 핵심 기능
- 역할별 AI 멤버를 추가하고 DM으로 직접 작업을 요청할 수 있습니다.
- 채널을 만들고 여러 멤버를 초대해 멘션 기반 협업 흐름을 만들 수 있습니다.
- 각 채널은 전용 워크스페이스 경로를 가지며, 채널 작업은 해당 디렉토리를 기준으로 실행됩니다.
- 활성 채널끼리는 같은 워크스페이스를 공유할 수 없습니다.
- Codex 모델 선택 기능을 지원하며, `~/.codex/models_cache.json`에서 사용 가능한 모델 목록을 읽어옵니다.
- 디버그 모드를 켜면 채널 메시지 안의 액션 블록(`CHANNEL_ACTION_BEGIN ... CHANNEL_ACTION_END`)을 그대로 확인할 수 있습니다.
- 새 멤버 생성 시 역할 정보를 바탕으로 시스템 프롬프트 초안 생성을 지원합니다.

## 핵심 개념
- `Agent`
  재사용 가능한 AI 멤버입니다. 이름, 역할, 시스템 프롬프트를 가집니다.
- `DM`
  사용자와 특정 멤버 사이의 1:1 작업 공간입니다.
- `Channel`
  여러 멤버가 함께 일하는 협업 공간입니다. 멤션과 응답 체인을 통해 작업이 이어집니다.
- `Workspace`
  채널 전용 작업 디렉토리입니다. 채널 생성 시 반드시 지정해야 하며, 읽기/쓰기 가능한 절대경로여야 합니다.

## 빠른 시작

### 사전 조건
- Node.js 22+
- Codex CLI 설치 및 로그인 완료
- 터미널에서 `codex --version` 실행 가능

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
1. 앱을 실행하면 내장 백엔드와 Codex 런타임 상태를 확인하고 기본 멤버 `Helper`를 로드합니다.
2. 새 멤버를 추가할 때 이름, 역할, 시스템 프롬프트를 직접 입력하거나 시스템 프롬프트 생성을 사용할 수 있습니다.
3. DM에서는 특정 멤버와 1:1로 대화를 이어가며 작업을 진행합니다.
4. 채널을 만들 때 설명과 함께 전용 워크스페이스를 지정합니다.
5. 채널에 멤버를 추가한 뒤 메시지와 멘션으로 협업을 시작합니다.
6. 채널 멤버는 다른 멤버를 다시 멘션해 작업을 넘기거나, 결과를 보고하고, 필요하면 산출물 경로를 함께 전달할 수 있습니다.

## 개발 및 테스트

### 주요 명령
```bash
npm run check
npm run build
npm run start
npm run test:e2e
npm run verify
```

- `npm run check`: TypeScript 타입 검사
- `npm run build`: `dist/` 빌드
- `npm run start`: 빌드 후 Electron 앱 실행
- `npm run test:e2e`: Playwright 기반 E2E 실행
- `npm run verify`: `check + build + test:e2e` 전체 회귀 실행

### 테스트 참고
- UI 시나리오는 Electron Playwright로 검증합니다.
- API 중심 시나리오는 backend-only test harness로 검증해 불필요한 창 실행을 줄였습니다.
- 실제 Codex를 쓰는 일부 E2E는 opt-in이며 기본 `verify`에서는 skip 됩니다.
- GUI 접근 권한이 부족한 환경에서는 Electron/Playwright 실행 시 `Process failed to launch`, `spawn EPERM`, `kill EPERM`가 날 수 있습니다. 이런 경우 권한이 있는 터미널에서 다시 실행하세요.

### 유용한 환경 변수
- `VIBLACK_DB_PATH`: 기본 SQLite 경로 override
- `VIBLACK_CODEX_PATH`: 사용할 Codex 실행 파일 경로 override
- `VIBLACK_CODEX_RUNTIME`: Codex 런타임 선호값 (`app-server`, `exec`)
- `VIBLACK_MODELS_CACHE_PATH`: 모델 캐시 파일 경로 override
