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

### 13) 이슈 대응: 앱 종료 후 프로세스 잔류
- 사용자 요청:
  - 앱 창을 닫아도 프로세스가 남는 것 같음.
- 조치:
  - `src/backend/codex.ts`
    - 실행 중인 Codex child process 추적(`activeCodexProcesses`) 추가
    - 앱 종료 시 child process 종료 함수 `shutdownCodexProcesses()` 추가
  - `src/backend/server.ts`
    - 서버 종료 시 `closeAllConnections` 기반 강제 종료 타이머 추가
    - 종료 중 예외로 앱 종료가 막히지 않도록 안전 종료 처리
  - `src/main.ts`
    - 종료 경로 단일화: `window-all-closed`/`before-quit` -> `shutdownApp()`
    - `shutdownApp()`에서
      1) Codex child 종료
      2) 백엔드 서버 종료
      3) `app.exit(0)`로 프로세스 종료
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과

### 14) 이슈 대응: Codex 탐지 `spawn EINVAL/ENOENT`
- 사용자 런타임 로그:
  - `spawn EINVAL` / `spawn codex ENOENT` / `spawn ...\\codex ENOENT`
- 원인:
  - Windows에서 `codex.cmd`를 일반 `spawn`으로 실행하면 실패할 수 있음.
  - Electron 런타임 PATH와 터미널 PATH 차이로 `codex`/`...\\npm\\codex` 탐색 실패 가능.
- 조치:
  - `src/backend/codex.ts`
    - `.cmd` 실행 시 `shell` 경유 실행 처리(`needsShellOnWindows`) 추가
    - `spawn` 동기 예외를 모두 안전 처리하도록 보강
    - Windows 후보 경로 우선순위를 `codex` -> `codex.cmd`로 정렬
  - `src/main.ts`
    - Codex 체크/부트 실패 시 앱이 죽지 않도록 `try/catch` 및 부트 fallback 추가
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과

### 15) 이슈 대응: `unexpected argument 'role:'`
- 사용자 런타임 오류:
  - `Codex 실행 실패: error: unexpected argument 'role:' found`
- 원인:
  - Windows `.cmd` 실행 경로에서 긴 프롬프트를 CLI 인자로 전달할 때 인자 파싱이 깨짐.
- 조치:
  - `src/backend/codex.ts`
    - `codex exec`/`resume` 호출 시 프롬프트 인자 전달을 중단
    - 프롬프트는 `-`(stdin 입력 모드)로 전달하도록 변경
    - child stdin으로 prompt write/end 처리 추가
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과

### 16) 이슈 대응: 응답 파싱 실패 + UX 메시지 순서
- 사용자 이슈:
  - `"응답 텍스트를 파싱하지 못했습니다."`가 표시됨.
  - 사용자 메시지를 먼저 보고, 이후 에이전트 응답이 도착하면 보이길 원함.
- 조치:
  - `src/backend/codex.ts`
    - `codex exec`/`resume`에 `--output-last-message <tmpfile>` 옵션 추가
    - 종료 시 임시 파일의 최종 응답을 우선 사용(이벤트 파싱 실패 대비)
    - 임시 파일 정리(unlink) 처리
  - `src/renderer/renderer.ts`
    - 메시지 전송 즉시 사용자 메시지 + `(응답 생성 중...)` 임시 버블 렌더링
    - 응답 완료 시 `refreshMessages()`로 실제 메시지로 교체
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과

### 17) 이슈 대응: `resume`에서 `--output-last-message` 미지원
- 사용자 런타임 오류:
  - `error: unexpected argument '--output-last-message' found`
  - `Usage: codex exec resume ...`
- 원인:
  - 현 Codex CLI에서 `--output-last-message`는 `codex exec`에는 지원되지만 `codex exec resume`에는 미지원.
- 조치:
  - `src/backend/codex.ts`
    - 초기 호출(`exec`)에만 `--output-last-message <file>` 사용
    - 재개 호출(`exec resume`)에서는 옵션 제거
    - 파일 기반 최종 응답 파싱은 초기 호출일 때만 실행되도록 분기
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과

### 18) 이슈 대응: `"응답 텍스트를 파싱하지 못했습니다."` 지속
- 사용자 이슈:
  - 최신 수정 후에도 응답 파싱 실패 문구가 표시됨.
- 원인 추정:
  - Codex JSON 이벤트가 stdout 이외 채널(stderr) 또는 기존 파서가 놓치는 이벤트 형태로 전달될 수 있음.
- 조치:
  - `src/backend/codex.ts` 파서 보강
    - stdout/stderr 모두 JSON 라인 파싱
    - 이벤트 타입 제한 완화(텍스트 파트가 있으면 수집)
    - 최종 응답 선택 로직 강화:
      1) 파일 응답(`exec` 초기 호출)
      2) 가장 긴 full message
      3) delta 조합
      4) stdout 비JSON 텍스트 fallback
    - stderr 비JSON 라인은 오류 메시지로 유지
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과

### 19) 이슈 대응: `resume` 응답 파일 캡처 방식 전환
- 사용자 이슈:
  - 여전히 `"응답 텍스트를 파싱하지 못했습니다."` 발생.
- 원인 추정:
  - `resume --json` 이벤트 파싱만으로는 일부 환경에서 최종 응답이 누락될 수 있음.
- 조치:
  - `src/backend/codex.ts`
    - `resume` 호출에도 응답 파일 출력 사용:
      - `codex exec -o <file> resume ...`
    - 핵심: `-o`를 `resume` 옵션이 아니라 `exec` 상위 옵션 위치로 전달
    - 종료 시 파일 응답을 우선 사용하도록 유지
- 참고:
  - `resume`에 `--output-last-message`를 직접 붙이면 오류가 나므로 사용하지 않음.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과

### 20) UI 수정: 패널별 독립 스크롤
- 사용자 요청:
  - 전체 페이지가 함께 스크롤되는 문제 수정
  - 좌측 패널과 중간 대화 패널의 스크롤 분리
  - 상단바/입력창 고정, 대화창만 스크롤
- 조치 (`src/renderer/index.html`):
  - `html, body` 높이 고정 + `body` 전체 스크롤 비활성화
  - `.app` overflow 차단
  - `.sidebar`에 `overflow-y: auto` 적용 (좌측 독립 스크롤)
  - `.main` 그리드 행을 `auto auto 1fr auto`로 명시
  - `.main`에 `min-height: 0`, `overflow: hidden` 적용
  - `.messages-wrap`에 `overflow-y: auto`, `min-height: 0` 적용
- 결과:
  - 스크롤은 대화 리스트 영역에서만 발생
  - 상단바/경고배너/입력창은 고정 레이아웃 유지
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과

### 21) UI 수정: 사이드바를 "헤더가 있는 목록" 구조로 개편
- 사용자 요청:
  - 좌측 사이드바를 `채널`, `멤버` 헤더 기반 목록 형태로 변경
  - 헤더 hover 시 하이라이트 + 우측 `+` 표시
  - 추후 `+` 클릭으로 채널/멤버 추가 기능 연결 예정
- 조치 (`src/renderer/index.html`):
  - 기존 단일 카드형(Helper 카드) 제거
  - 섹션 구조 추가:
    - `채널` 섹션 (`# general`)
    - `멤버` 섹션 (`Helper`)
  - 헤더 스타일/상호작용 추가:
    - hover 하이라이트
    - `+` 버튼은 기본 숨김, hover/focus 시 노출
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과

### 22) UI 수정: 사이드바 섹션 접기/펼치기 + 기본 채널 없음
- 사용자 요청:
  - `채널`/`멤버` 섹션을 접었다 펼칠 수 있어야 함
  - 채널은 기본적으로 0개 상태여야 함
- 조치:
  - `src/renderer/index.html`
    - 섹션 헤더를 `section-toggle` + `header-add` 구조로 분리
    - 토글용 caret(▾) 추가
    - `collapsed` 상태 스타일 추가(목록 숨김 + caret 회전)
    - 채널 목록 기본값을 `채널이 없습니다.`(empty 상태)로 변경
  - `src/renderer/renderer.ts`
    - `initSidebarSections()` 추가
    - `section-toggle` 클릭 시 섹션 접기/펼치기 + `aria-expanded` 동기화
    - `header-add` 클릭 이벤트 분리(추후 기능 연결 placeholder)
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과

### 23) 기능 추가: 멤버 CRUD (추가/수정/삭제)
- 사용자 요청:
  - 멤버 추가는 `멤버` 헤더의 `+` 버튼 사용
  - 멤버 항목 hover 시 하이라이트 + 우측 햄버거 메뉴 노출
  - 햄버거 메뉴에서 `수정`/`제거`
  - 추가/수정 입력은 팝업에서 처리, 저장 시 팝업 닫힘
- 백엔드 조치:
  - `src/backend/db.ts`
    - `createAgent(name, role, systemPrompt)` 추가
    - `updateAgent(agentId, ...)` 추가
    - `deleteAgent(agentId)` 추가 (메시지/에이전트 동시 삭제)
    - 에이전트 ID 자동 생성 로직 추가(이름 기반 slug + 중복 회피)
  - `src/backend/server.ts`
    - API 추가:
      - `POST /api/agents`
      - `PATCH /api/agents/:agentId`
      - `DELETE /api/agents/:agentId`
    - 입력 검증(`name`, `role`, `systemPrompt` 필수) 추가
- 프론트 조치:
  - `src/renderer/index.html`
    - 멤버 리스트를 동적 렌더링 구조로 변경 (`#member-list`)
    - hover 시 보이는 햄버거 버튼 스타일 추가
    - 멤버 메뉴(`수정`, `제거`) UI 추가
    - 멤버 추가/수정용 모달 폼(`dialog`) 추가
  - `src/renderer/renderer.ts`
    - 멤버 목록 로딩/렌더링/선택 상태 관리
    - 멤버 `추가/수정/삭제` API 연동
    - 헤더 `+` 버튼 -> 추가 모달 오픈
    - 햄버거 메뉴 -> 수정/삭제 동작 연결
    - 멤버가 없을 때 composer 비활성화 처리
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과

### 24) UI 수정: 대화 0건일 때 메시지 영역 축소 방지
- 사용자 이슈:
  - 대화가 없으면 대화창 높이가 줄어 레이아웃이 깨짐.
- 조치:
  - `src/renderer/index.html`
    - `.messages-wrap`를 `display: flex`로 변경
    - `#messages`에 `flex: 1`, `min-height: 100%` 적용
    - 빈 상태 문구 스타일 `.msg-empty` 추가
  - `src/renderer/renderer.ts`
    - 메시지 0건일 때 `"대화를 시작해 보세요."` 빈 상태 아이템 렌더링
- 결과:
  - 메시지 유무와 무관하게 대화 영역 높이가 유지되어 상/하단 레이아웃이 안정적으로 고정됨.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과

### 25) UX 수정: 임시 "응답 생성 중" 메시지 제거
- 사용자 요청:
  - 응답 대기 중 임시 문구를 표시하지 않고, 실제 응답이 도착했을 때만 표시.
- 조치:
  - `src/renderer/renderer.ts`
    - `sendMessage()`에서 임시 에이전트 버블(`(응답 생성 중...)`) 생성/렌더링 로직 제거
    - 사용자 메시지만 즉시 렌더링 후, 응답 도착 시 `refreshMessages()`로 실제 에이전트 메시지 표시
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
