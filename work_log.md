# Viblack 작업 로그

## 2026-02-20

### 1) 초기 설정
- 로컬 폴더 `C:\Users\user\Desktop\Vibe`를 Git 레포로 초기화.
- 원격 저장소 연결:
  - `origin`: `https://github.com/minseoi/Viblack.git`
- 프로젝트명은 사용자 요청에 따라 `Viblack`로 확정.

### 2) 요구사항 확정
- 프론트: TypeScript + Electron
- 백엔드: TypeScript
- DB: SQLite
- OS 호환: Windows / macOS
- Codex CLI:
  - 로컬에 설치되어 있다고 가정
  - 앱 시작 시 동작 여부 체크
  - 동작 불가 시 알림 팝업 표시
- 초기 에이전트: 1명 (`Helper`)

### 3) 사전 검증
- `codex exec --help` / `codex exec resume --help` 확인 완료.
- 세션 유지 플로우 확인:
  - 첫 호출: `codex exec --json ...`
  - 이후 호출: `codex exec resume <session_id> --json ...`
- JSONL 이벤트에서 `thread.started.thread_id`를 저장해 컨텍스트를 이어가는 방식으로 구현 예정.

### 4) 현재 이슈
- `npm install` 실행 시 `EACCES` 에러로 실패한 이력 존재.
- 다음 단계에서 의존성 설치를 다시 시도하고, 필요 시 권한 상승으로 재시도 예정.

### 5) 의존성 설치 결과
- 권한 상승으로 재시도 후 설치 완료:
  - runtime: `express`
  - dev: `typescript`, `electron`, `@types/node`, `@types/express`
- `node_modules`는 버전관리에서 제외하도록 `.gitignore` 추가.

### 6) MVP 코드 골격 구현
- 공통
  - `package.json` 프로젝트명 `viblack`로 변경.
  - 스크립트 추가: `build`, `check`, `start`.
  - `tsconfig.json` 추가.
- 백엔드 (`TypeScript + Express + SQLite`)
  - `src/backend/db.ts`: SQLite 스키마/초기 데이터(Helper 1명) 구성.
  - `src/backend/codex.ts`: `codex --version` 체크, `codex exec`/`resume` 실행 래퍼 구현.
  - `src/backend/server.ts`: API 구성
    - `GET /api/system/codex-status`
    - `GET /api/agents`
    - `GET /api/agents/:agentId/messages`
    - `POST /api/agents/:agentId/messages`
  - 에이전트별 직렬 실행 잠금(동일 session 병렬 충돌 방지) 반영.
- Electron
  - `src/main.ts`: 백엔드 서버 부팅 + 앱 시작 시 Codex CLI 확인.
  - Codex 미동작 시 `dialog.showErrorBox` 팝업 표시.
  - `src/preload.ts`: 렌더러에 안전하게 초기 상태 전달.
- 프론트 (TS + Electron renderer)
  - `src/renderer/index.html`, `src/renderer/renderer.ts` 추가.
  - Helper 단일 에이전트 대화 UI 구현.
  - Enter 전송/Shift+Enter 줄바꿈 동작.

### 7) 검증 결과
- `npm run check` 통과.
- `npm run build` 통과.

### 8) 추가 정리
- `package-lock.json` 이름을 `viblack`으로 동기화(`npm install` 재실행).
- 실행/구조 안내를 위해 `README.md` 추가.

### 9) 커밋 로그
- `1e7b22c`: `chore_init_viblack_repo_and_planning_docs`
- `ae19861`: `feat_add_electron_typescript_mvp_scaffold`

### 10) 실행 확인
- `npm run start` 1차 실행:
  - 빌드(`tsc`)는 성공
  - Electron 프로세스 비정상 종료 코드: `-1073741819`
- `npm run start` 권한 상승 재실행:
  - 빌드 성공
  - Electron 실행 명령은 정상 종료 코드(`0`) 확인
- 공통 참고:
  - `node:sqlite` 실험 기능 경고 출력(동작 자체는 진행)

### 11) 이슈 대응: Codex 팝업 + 입력 포커스
- 사용자 이슈:
  - Codex 확인 팝업이 표시됨.
  - 팝업 종료 후 입력창 포커스가 기대와 다름.
- 원인:
  - 초기 구현에서 Codex 체크 실패를 모달 팝업(`showErrorBox`, `alert`)으로 처리.
  - 시작 시 강제 포커스 로직이 있었음.
- 조치:
  - 모달 팝업 제거, 렌더러 상단 비차단 경고 배너로 전환.
  - Codex 실행 파일 탐색 fallback 추가(Windows/macOS 경로).
  - 시작 시 자동 포커스 제거(사용자 요청 반영).
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과

### 12) 실행 재확인 (사용자 요청)
- 일반 권한 `npm run start`:
  - 빌드 성공 후 Electron이 OS 권한 오류로 종료
  - 오류 키워드: `os_crypt_win`, `platform_channel`, `Access denied (0x5)`
- 권한 상승 `npm run start`:
  - 명령은 타임아웃(프로세스 지속 실행)
  - `tasklist` 확인 결과 `electron.exe` 3개 프로세스 실행 중
  - 판단: 앱 런치 성공
