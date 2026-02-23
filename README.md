# Viblack

![Viblack Title](docs/images/title.png)

Codex CLI 기반의 AI 워크스페이스입니다. 메신저 인터페이스로 에이전트들을 멤버로 구성하며, 채널 기반의 협업을 통해 복합적인 워크플로우 자동화를 구현하는 것이 목표입니다.

## MVP 스택
- Frontend: Electron Renderer (TypeScript)
- Backend: Express (TypeScript)
- DB: SQLite (`node:sqlite`)
- Agent Runtime: Codex CLI

## 사전 조건
- Node.js 22+
- Codex CLI 설치 및 로그인 완료
- 터미널에서 `codex --version` 동작

## 실행
```bash
npm install
npm run start
```

## 작업 완료 후 회귀 테스트 절차
아래 명령 1개로 타입체크, 빌드, Playwright E2E 전체 시나리오를 연속 실행합니다.

```bash
npm run verify
```

`test:e2e`는 테스트 실행 시 `VIBLACK_DB_PATH`를 테스트 전용 경로로 주입하므로,
테스트 중 생성한 채널/멤버/메시지가 평소 사용하는 로컬 DB에 누적되지 않습니다.

운영 규칙:
- 피쳐를 추가/변경할 때마다 해당 피쳐를 검증하는 Playwright 테스트를 같이 업데이트합니다.
- 작업 완료 판단은 `npm run verify` 통과를 기준으로 합니다.

## 동작 플로우
1. 앱 시작 시 `codex --version` 체크
2. 실패하면 상단 경고 배너로 안내 표시
3. 성공하면 Helper 1명으로 채팅 시작
4. 첫 요청: `codex exec --json ...`
5. 이후 요청: `codex exec resume <session_id> --json ...`
6. `session_id`는 SQLite `agents.session_id`에 저장

## API (로컬 백엔드)
- `GET /api/health`
- `GET /api/system/codex-status`
- `GET /api/agents`
- `GET /api/agents/:agentId/messages`
- `POST /api/agents/:agentId/messages` (`{ content }`)

## 파일 구조
```text
src/
  main.ts                 # Electron main process
  preload.ts              # Renderer bridge
  backend/
    server.ts             # Express API
    codex.ts              # Codex CLI 실행/상태 체크
    db.ts                 # SQLite 모델/초기 데이터
  renderer/
    index.html
    renderer.ts
```

## E2E 테스트 범위
- 멤버: 추가(자동 프롬프트 생성), 중복 이름 검증, 수정, DM 전송, DM 클리어, 삭제
- 채널: 추가, 수정, 멤버 다중 추가/제거, 무멘션 메시지, 멘션 메시지, 삭제

## 참고
- 이 MVP는 로컬 단일 사용자 기준입니다.
- 멀티유저/배포 환경은 v1에서 API 기반 런타임으로 교체를 권장합니다.
