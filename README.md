# Viblack

![Viblack Title](docs/images/title.png)

Electron + TypeScript 기반의 로컬 MVP 협업 앱입니다.  
프론트에서 메시지를 보내면 백엔드가 `codex exec`/`codex exec resume`를 호출해 Helper 에이전트를 실행합니다.

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

## 참고
- 이 MVP는 로컬 단일 사용자 기준입니다.
- 멀티유저/배포 환경은 v1에서 API 기반 런타임으로 교체를 권장합니다.
