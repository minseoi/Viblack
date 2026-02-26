# Viblack 작업 로그 (요약본)

## 백업
- 상세 원본 백업: `codexdocs/work_log.backup.20260223.md` (생성일: 2026-02-23)

## 2026-02-20 ~ 2026-02-23 핵심 진행

### 1) 초기 구축 (MVP)
- Electron + TypeScript + Express + SQLite 구조로 앱/로컬 API 기본 골격 구축.
- Codex CLI 연동 기본 흐름 구현:
  - 첫 호출 `exec`, 후속 호출 `resume` 기반 세션 유지.
  - 에이전트별 직렬 실행 잠금으로 동시 실행 충돌 방지.
- 기본 DM UI(Helper) 및 메시지 송수신 흐름 구현.

### 2) 런타임 안정화 (Codex/프로세스/Windows 이슈)
- Codex 탐지 실패 시 모달 팝업 제거, 상단 경고 배너 방식으로 전환.
- Windows `spawn EINVAL/ENOENT`, 인자 파싱 오류(`unexpected argument`) 대응:
  - `.cmd` 실행 경로 보강, shell 경유 처리.
  - 프롬프트 전달을 CLI 인자에서 `stdin` 방식으로 전환.
- 응답 파싱 안정화:
  - 파일 출력 기반 응답 캡처(`exec -o` 경로 활용) + stdout/stderr 파서 보강.
- 앱 종료 시 Codex child/server 정리 로직 추가로 잔류 프로세스 문제 완화.

### 3) UI/UX 개선 (DM 중심)
- 사이드바를 채널/멤버 헤더형 구조로 개편, 섹션 접기/펼치기 지원.
- 멤버 CRUD(추가/수정/삭제), 멤버별 DM 클리어 기능 추가.
- 네이티브 `confirm/alert` 제거, 커스텀 모달로 통일.
- 메시지 영역 고정/스크롤/하단 입력창 레이아웃 이슈 연속 수정.
- 멤버 상태(응답 생성 중/새 응답) 표시 개선 및 전환 중 응답 반영 버그 보완.
- 채팅 Markdown 렌더링 지원 추가.

### 4) 채널 UI/운영 기능 확장
- 채널 생성/수정/삭제 UI 추가.
- 채널 멤버 조회/추가/제거 UI 및 메뉴 흐름 추가.
- 검색/스크롤 리스트, 다중 선택 추가, 메뉴 레이어 이슈 수정.
- 상단 2줄 헤더(제목/서브텍스트) 및 긴 설명 시 레이아웃 안정성 보강.

### 5) 문서/리소스 정비
- 앱 아이콘 리소스 경로 구성 및 플랫폼별 아이콘 적용.
- README 타이틀 이미지 반영.
- 기획/로그 문서 경로를 `codexdocs/`로 통일하고 `AGENTS.md` 규칙 반영.

### 6) 시스템 프롬프트 자동 생성
- 멤버 모달에서 역할 기반 시스템 프롬프트 자동 생성 API/버튼 추가.
- 생성 중 입력/저장/닫기 잠금과 disabled 시각 피드백 강화.

### 7) 테스트 체계 도입
- Playwright Electron E2E 환경 도입(`playwright.config.ts`, `tests/e2e/*.spec.ts`).
- 기본 스모크 테스트 추가 및 이후 기능 변경에 맞춰 E2E 보강.
- Windows 환경에서 일반 권한 실행 시 `spawn EPERM` 발생 가능, 권한 상승 재실행으로 통과 확인.

### 8) 채널 멘션 실행 규칙 구현 (최근)
- `@name`, `@{name}` 멘션 파싱/하이라이트 추가.
- 채널 메시지에서 멘션 대상 에이전트 실행 라우팅 반영.
- 에이전트 응답 내 재멘션 체인 실행 버그 수정:
  - depth/execution 제한, 큐/실행 dedupe로 루프 안전장치 적용.
- 관련 E2E 시나리오 추가로 재멘션 트리거 검증.

## 검증 요약
- 반복적으로 `npm run check`, `npm run build` 통과 상태 유지.
- E2E는 권한 이슈를 제외하면 통과 경로 확보 (`npm run test:e2e`).

## 2026-02-23 로그 관리 작업
- `work_log.md`를 상세 기록본에서 핵심 요약본으로 재작성해 용량 축소.
- 기존 상세본은 백업 파일로 분리 보관.
- `npm run verify` 통과(Windows Playwright `spawn EPERM` 이슈로 권한 상승 재실행).
- 프로그램 설명 문구를 `README.md` 상단에 반영.
- `package.json`의 `description`은 메타데이터 특성에 맞게 간결 문구로 유지.
### 54) 커밋 준비: 채널 멘션 체인 실행 업데이트
- 서버 멘션 라우팅에서 실행/depth 가드를 포함한 연쇄 재멘션 처리 지원.
- E2E 및 fake-codex 픽스처 업데이트 반영.

### 55) 버그 조사: 채널 재멘션 UX 이슈
- 사용자 이슈:
  - 첫 번째 에이전트 응답이 체인 에이전트 완료 전에 저장되지만, 렌더러는 POST 완료 후에만 갱신됨.
- 조치 계획:
  - POST 진행 중 채널 메시지 폴링 구현
  - E2E 회귀 테스트로 첫 응답이 연쇄 응답 전에 표시되는지 확인

### 56) 기능 구현: 렌더러 인플라이트 채널 폴링
- 조치:
  - `POST /api/channels/:id/messages` 진행 중 중간 연쇄 응답을 요청 완료 전에 렌더링
  - fake-codex를 지연 연쇄 응답 지원으로 업데이트
  - E2E 검증 확장: 첫 응답이 연쇄 완료 전에 표시되는지 확인
- 검증:
  - `npm run verify` 통과 (check/build/e2e 모두 통과)
  - E2E에서 연쇄 재멘션 시 첫 응답자가 지연된 두 번째 응답자보다 먼저 표시됨을 검증

### 57) 버그 수정: 채널 사용자 메시지 중복 렌더링 회귀
- 사용자 이슈:
  - 채널에서 사용자 메시지가 두 번 렌더링됨.
- 원인:
  - SSE/API 저장 메시지가 로컬 pending 버블을 교체하지 않고 추가로 렌더링됨.
- 조치:
  - 채널 범위 낙관적 메시지 추적/조정 추가
  - SSE/API 저장 메시지가 로컬 pending 버블을 교체하도록 수정
- 검증:
  - `npm run verify` 통과

### 58) 버그 조사: 채널 멘션 체인 바운스 재멘션 미실행
- 사용자 이슈:
  - `A -> B` 실행은 되지만 `B -> A` 재멘션이 실행되지 않음.
- 조사:
  - 백엔드 큐/dedupe 조건 검토
  - 바운스 재멘션을 위한 타겟 E2E 재현 준비

### 59) 버그 수정: 멘션 체인 큐 수정으로 바운스 재멘션 허용
- 조치:
  - 이전에 실행된 에이전트의 재큐 허용 (기존 체인 depth/실행 제한 내)
  - fake-codex + Playwright E2E 시나리오 추가: `A -> B -> A` 바운스 재멘션 회귀 커버리지
- 검증:
  - `npm run verify` 통과 (check/build/e2e 통과)
  - 일반 권한 실행: Windows Playwright `spawn EPERM` 발생
  - 권한 상승 실행: 검증 성공

### 60) 버그 조사: 채널 멘션 중복 렌더링 이슈
- 사용자 이슈:
  - `POST /api/channels/:id/messages` 진행 중 멘션 실행 시, SSE delta가 오래된 낙관적 로컬 버블과 저장된 사용자 메시지를 병합해 일시적으로 중복 표시됨.

### 61) 버그 수정: 채널 멘션 중복 표시 렌더러 수정
- 조치:
  - SSE delta 병합 시 오래된 로컬 낙관적 채널 버블(음수 로컬 ID) 제외
  - 저장된 메시지와 병합 후 활성 pending 항목만 재적용
- 검증:
  - Playwright 회귀 테스트 추가: 지연된 멘션 실행 중 사용자 채널 메시지가 단일 렌더링 유지되는지 검증(일시적 중복 버블 없음)
  - 자동화 검증: `npm run verify` 통과 (check/build/e2e 통과)

### 62) 버그 조사: E2E DM 단계 strict locator 실패
- 사용자 이슈:
  - 테스트 자동화가 실패함.
- 조사:
  - `npm run verify` 재현 시 DM 단계에서 `#messages .msg-agent .msg-content`가 2개로 매칭되어 strict mode 위반 발생
  - `src/backend/codex.ts`의 스트리밍 콜백이 완료 이벤트 텍스트까지 중간 메시지로 전달되고, 최종 응답 저장과 중복되는 경로 확인

### 63) 버그 수정: Codex 완료 이벤트 스트리밍 필터링
- 조치:
  - `src/backend/codex.ts`에 terminal 이벤트 판별(`completed`, `.done`, `response.done`) 로직 추가
  - `onStream` 콜백은 중간 이벤트(`delta`, `progress`, `question/ask`, 비종료 message/output_text`)만 전달하도록 수정
  - 완료 이벤트 텍스트는 최종 응답 저장 경로만 사용해 중복 메시지 append 방지
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과 (check/build/e2e 통과)

### 64) 버그 조사: Enter 전송 후 입력창 마지막 글자 잔류
- 사용자 이슈:
  - Enter로 전송 시 입력창에 마지막 한 글자가 남음.
- 조사:
  - `renderer`의 Enter keydown 전송 경로를 확인했고, IME 조합 입력 중 Enter 처리 누락 가능성이 높음.

### 65) 버그 수정: Enter 전송 시 IME 조합 입력 잔류 방지
- 조치:
  - `src/renderer/renderer.ts` Enter keydown 처리에 IME 조합 상태 가드 추가(`isComposing` 또는 `keyCode===229` 시 전송 차단)
  - 조합 중 Enter는 조합 확정만 수행하고, 조합 종료 후 Enter에서만 전송되도록 정리
  - E2E 보강: `tests/e2e/electron.smoke.spec.ts`에 Enter 전송 후 입력창 값이 비워지는지 회귀 검증 추가
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과 (check/build/e2e 통과)

### 66) 버그 수정: 빈 최종 응답 시 파싱 실패 문구 노출 제거
- 사용자 이슈:
  - 대화 응답으로 `응답 텍스트를 파싱하지 못했습니다.` 문구가 노출됨.
- 원인:
  - `runCodex` 최종 파싱 결과가 비어 있을 때 내부 fallback 문구를 그대로 성공 응답으로 반환.
- 조치:
  - `src/backend/codex.ts` 성공 응답 fallback 문구 제거(빈 문자열 반환)
  - `src/backend/server.ts`에서 스트리밍 응답이 있으면 이를 최종 응답으로 재사용
  - 스트리밍 마지막 텍스트와 최종 텍스트가 동일/비어 있으면 최종 메시지 중복 append를 생략
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과 (check/build/e2e 통과)

### 67) 버그 조사: A DM 응답 대기 중 B DM 전송 차단
- 사용자 이슈:
  - A 멤버에게 DM 전송 후 응답 대기 중에는 B 멤버에게 DM 전송이 안 됨.
- 원인:
  - 렌더러 전송 가드가 전역 플래그(`isSendingMessage`)라 에이전트 단위 병렬 전송이 막힘.

### 68) 버그 수정: DM 전송 가드를 에이전트 단위로 분리
- 조치:
  - `src/renderer/renderer.ts` 전역 전송 락 제거, 채널 전송은 별도 플래그(`isSendingChannelMessage`)로 유지
  - DM 전송은 `inflightAgentIds` 기반으로 동일 에이전트만 중복 차단하고, 다른 에이전트 전송은 허용
  - E2E 보강: `tests/e2e/electron.smoke.spec.ts`에 `A(지연 응답) 전송 중 B 즉시 DM 전송` 회귀 시나리오 추가
- 검증:
  - `npm run verify` 최초 재실행에서 새 시나리오 순서 이슈로 E2E 실패 재현 후, 전송 순서(동시 전송 검증 -> Enter 전송 검증) 조정
  - `npm run verify` 재실행 통과 (check/build/e2e 통과)

### 69) 기능 구현 진행: 멤버 시스템 프롬프트 템플릿 주입
- 사용자 요청:
  - 에이전트 실행 시 공통 "멤버 정의용 시스템 프롬프트"를 사용하고,
  - 그 내부에 사용자가 작성한 멤버 프롬프트를 삽입하는 구조 필요.
- 착수:
  - `server.ts`에서 최종 실행용 시스템 프롬프트 조합 함수 추가 예정.
  - DM/채널 실행 경로 모두 동일 템플릿 적용 예정.
  - E2E + fake-codex로 실제 주입 여부 검증 케이스 추가 예정.
- 진행 업데이트:
  - `src/backend/server.ts`에 `buildMemberExecutionSystemPrompt(agent, context)` 추가.
  - DM/채널의 `runCodex` 호출에서 원본 `agent.systemPrompt` 대신 조합된 실행용 시스템 프롬프트 주입으로 변경.
  - 조합 프롬프트에 `[USER_DEFINED_MEMBER_PROMPT_BEGIN/END]` 블록을 두어 사용자 프롬프트를 명시적으로 삽입.
  - `tests/e2e/fixtures/fake-codex.js`에 삽입 검증 분기(`FORCE_ASSERT_MEMBER_PROMPT`) 추가.
  - `tests/e2e/electron.smoke.spec.ts`에 멤버 프롬프트 토큰이 실제 주입되는지 검증 단계 추가.
- 검증 이슈:
  - `npm run verify`에서 `check`/`build`는 통과했으나, `test:e2e`는 앱 런치 단계에서 실패.
  - 증상: Playwright `Error: Process failed to launch!`
  - 재현: `npm run start`, `electron --version` 모두 Electron 프로세스가 즉시 `SIGABRT` 종료.
  - 진단: `~/Library/Logs/DiagnosticReports/Electron-2026-02-26-143352.ips`에서 `abort() called`, AppKit 초기화(`NSApplication sharedApplication`) 구간 크래시 확인.
  - 결론: 현재 세션 환경의 GUI/Electron 런타임 제약으로 보이며, 코드 변경 자체의 타입/빌드 실패는 아님.

### 69) 테스트 안정화: DM 스모크 구간 strict locator 보정
- 조치:
  - `tests/e2e/electron.smoke.spec.ts`의 DM 스모크 사용자 메시지 검증을 텍스트 필터(`hasText`) + count 단정으로 변경
  - 다중 사용자 메시지 존재 시 strict mode 위반으로 인한 불안정 실패 제거

### 70) 테스트 안정화: DM/채널 agent 응답 단정 strict 충돌 보정
- 조치:
  - `tests/e2e/electron.smoke.spec.ts`의 agent 응답 검증을 일반 locator + `toContainText`에서 `hasText` 필터 + count 단정으로 변경
  - 다중 agent 메시지 존재 시 strict mode 위반으로 깨지는 케이스 제거

### 70) 기능 구현 착수: 멤버 시스템 프롬프트 v2 구조화
- 사용자 요청 반영: 멤버 공통 시스템 프롬프트를 섹션형(정체성/실행/검증/안전/출력)으로 고도화 예정.
- 적용 범위: `src/backend/server.ts`의 멤버 실행 프롬프트 조합 로직(DM/채널 공통).
- 테스트 계획: E2E + fake-codex에 템플릿 구조 주입 검증 케이스 추가.
### 71) 기능 구현: 멤버 시스템 프롬프트 v2 적용
- `buildMemberExecutionSystemPrompt`를 섹션형 템플릿으로 개편:
  - `[IDENTITY]`, `[CONTEXT]`, `[EXECUTION_RULES]`, `[VALIDATION_RULES]`, `[SAFETY_GATES]`, `[OUTPUT_FORMAT]`
  - 사용자 프롬프트 슬롯 `[USER_DEFINED_MEMBER_PROMPT_BEGIN/END]` 유지
- 사용자 프롬프트가 비어 있는 예외를 대비해 `(none)` fallback 추가.

### 72) E2E 보강: 템플릿 섹션 주입 검증
- `tests/e2e/fixtures/fake-codex.js`에 `FORCE_ASSERT_MEMBER_TEMPLATE` 검증 분기 추가.
- `tests/e2e/electron.smoke.spec.ts`에 DM 단계에서 템플릿 섹션 주입 확인 시나리오 추가.
### 73) 검증 실행 결과
- `npm run check`: 통과
- `npm run build`: 통과
- `npm run verify`: 실패
  - 실패 지점: Playwright Electron E2E 런치 단계
  - 에러: `Process failed to launch!` (`tests/e2e/electron.smoke.spec.ts` 실행 시작 직후)

### 74) 스트리밍 계약 정렬: agent_message 이벤트 기준 전환
- 사용자 요청 반영:
  - Codex 실행 인자를 `codex exec --full-auto --skip-git-repo-check --json <prompt>` 형태로 사용하고,
  - 스트리밍 중간 메시지는 `type=agent_message`일 때만 멤버 메시지로 반영하도록 정렬.
- `src/backend/server.ts` 조치:
  - DM/채널 `onStream` append 조건을 `event.rawType` 기반 `agent_message` 판별로 변경.
- `src/renderer/renderer.ts` 조치:
  - DM 전송 중 주기적 메시지 동기화(polling) 추가로, 요청 완료 전 중간 메시지 노출되도록 보강.
- `tests/e2e/fixtures/fake-codex.js` 조치:
  - stdin 의존 경로를 유지하되, 기본은 CLI 인자에서 프롬프트를 파싱하도록 업데이트.
  - `agent_message` 강제 스트림 및 최종 응답 제어 토큰(`FORCE_STREAM_AGENT_MESSAGE`, `FORCE_FINAL_REPLY`) 추가.
- `tests/e2e/electron.smoke.spec.ts` 조치:
  - DM에서 중간 `agent_message`가 최종 응답보다 먼저 렌더링되는 회귀 검증 시나리오 추가.

### 75) 회귀 보정: 최종 응답 선택 우선순위 수정
- 검증 중 발견:
  - `agent_message` 중간 텍스트가 `response.completed` 최종 텍스트보다 긴 경우,
  - `runCodex`가 중간 텍스트를 최종 reply로 채택해 최종 메시지 append가 누락됨.
- 원인:
  - `src/backend/codex.ts`에서 non-delta 텍스트를 단일 `fullParts`로만 합쳐 가장 긴 문자열을 선택하던 로직.
- 조치:
  - terminal 이벤트(`completed/.done/response.done`) 텍스트를 별도 버퍼(`terminalParts`)로 분리.
  - 최종 reply 병합 순서를 `terminal > full > delta > stdout fallback`으로 재정렬.

### 76) 최종 검증 결과
- `npm run check`: 통과
- `npm run build`: 통과
- `npm run verify`: 통과
  - Playwright E2E 1건 통과 (`tests/e2e/electron.smoke.spec.ts`)

### 77) 실코덱스(E2E) 검증 경로 추가
- 사용자 요청 반영:
  - 테스트 시 fake-codex 외에 실제 `codex` 실행 경로도 검증할 수 있도록 별도 E2E 스모크 추가.
- 추가 파일:
  - `tests/e2e/electron.real-codex.spec.ts`
- 실행 조건:
  - `VIBLACK_E2E_REAL_CODEX=1` 일 때만 실행되도록 `test.skip` 가드 적용.
  - Electron 환경변수에 `VIBLACK_CODEX_PATH=codex`를 주입해 실제 CLI를 사용.

### 78) 버그 수정: "Codex 응답이 비어 있습니다" 오탐 제거
- 사용자 이슈:
  - 실제 codex 실행 시 응답이 없다고 표시되며, 실패 원인이 가려짐.
- 원인 1 (`src/backend/codex.ts`):
  - `turn.failed`류 이벤트가 발생해도 종료코드가 0인 케이스에서 성공으로 처리될 가능성 존재.
- 조치 1:
  - 스트림 이벤트 중 `*.failed`/`turn.failed`를 실패 이벤트로 수집.
  - 실패 이벤트 발생 시 종료코드 0이어도 `ok=false`로 승격하고 에러 텍스트를 반환.
- 원인 2 (`src/backend/server.ts`):
  - `codexResult.ok=true`이지만 실질 답변(최종/스트림)이 비어 있을 때 agent fallback 문구를 성공 응답처럼 저장.
- 조치 2:
  - DM/채널 공통으로 "실제 렌더 가능한 답변 존재 여부"를 `executionOk`로 재평가.
  - 비어 있으면 `Codex 실행 실패: empty response from codex`로 시스템 메시지 처리.

### 79) 검증 결과
- 기본 회귀:
  - `npm run verify` 통과 (fake-codex 기반 스모크 1건 통과, real-codex spec은 기본 skip)
- 실코덱스 회귀:
  - `VIBLACK_E2E_REAL_CODEX=1 npx playwright test tests/e2e/electron.real-codex.spec.ts` 통과

### 80) 원인 진단: 실제 codex 무응답/빈 응답 이슈
- 사용자 이슈:
  - codex 명령 실행 시 "응답을 못 찾는" 상태가 발생.
- 재현/근거:
  - `codex exec --full-auto --skip-git-repo-check --json "응답 테스트"` 실행 시,
  - `Reconnecting... 1/5` ~ `5/5` 후 `turn.failed` 이벤트로 종료.
  - 에러 메시지: `stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)`
- 결론:
  - 주원인은 응답 파싱 누락이 아니라 Codex 상위 API 연결 실패(네트워크/세션/환경)이며,
  - 앱은 이 실패를 비정상적으로 성공 경로로 흘려 "빈 응답"으로 보이게 만드는 경로가 일부 존재.

### 81) 원인 확정: 실코덱스 이벤트 스키마 불일치
- 사용자 제보 로그 확인:
  - 정상 출력이 `item.completed` 이벤트 내부 `item.type=agent_message`, `item.text=...` 형태로 도착.
- 기존 파서 한계 (`src/backend/codex.ts`):
  - 텍스트 추출 키에서 `item` 중첩 객체를 탐색하지 않아 `item.text`를 놓침.
  - terminal 판별이 `*completed` 전체를 종료로 취급해 `item.completed`를 실질 응답 후보에서 배제.
- 결과:
  - 실제 응답이 존재해도 앱에서는 빈 응답처럼 보일 수 있음.

### 82) 수정: item.completed(agent_message) 파싱 지원
- `src/backend/codex.ts`:
  - 텍스트 추출에 `item/items/error` 중첩 키 탐색 추가.
  - terminal 이벤트 판별을 `turn.completed`, `response.completed`, `*.done` 중심으로 축소.
  - `item.completed` + `item.type` 존재 시 스트림 타입을 `item.type`으로 재매핑.
  - `message` 타입으로 분류된 텍스트만 최종 답변 후보(`fullParts`)에 반영하여 reasoning 텍스트 오염 방지.

### 83) 회귀 테스트 보강
- `tests/e2e/fixtures/fake-codex.js`:
  - `FORCE_ITEM_COMPLETED_AGENT_MESSAGE:<token>` 입력 시 real-codex 유사 스키마(`item.completed` + `item.type=agent_message`)를 출력하도록 추가.
- `tests/e2e/electron.smoke.spec.ts`:
  - 위 토큰을 사용해 DM 응답이 정상 렌더링되는지 검증 케이스 추가.

### 84) 검증 결과
- `npm run check`: 통과
- `npm run build`: 통과
- `npm run verify`: 통과 (GUI 권한 실행)

### 85) 버그 수정: 채널 작업 중 추가 전송 차단 해제
- 사용자 이슈:
  - 채널에서 한 멤버 응답이 진행 중이면 추가 메시지 전송이 막힘.
- 원인:
  - `src/renderer/renderer.ts`의 채널 전송 경로가 전역 플래그(`isSendingChannelMessage`)로 잠겨,
  - 첫 `POST /api/channels/:id/messages` 완료 전에는 다음 전송을 즉시 차단.
- 조치:
  - 전역 잠금 제거, 동시 전송 허용으로 전환.
  - `inflightChannelRequestCount` 카운터 기반으로 상태 텍스트(`Channel is working...`)만 관리.
  - 요청별 낙관적 사용자 메시지는 기존대로 유지하고, 응답 도착 시 메시지 동기화.

### 86) E2E 회귀 보강: 채널 동시 전송 시나리오
- `tests/e2e/electron.smoke.spec.ts`에 시나리오 추가:
  - 지연 멘션 메시지 전송 직후, 두 번째 일반 메시지를 즉시 전송.
  - 첫 작업 완료 전 두 사용자 메시지가 모두 렌더링되는지 검증.
  - 이후 지연된 멘션 에이전트 응답까지 정상 도착하는지 검증.

### 87) 검증 결과
- `npm run check`: 통과
- `npm run build`: 통과
- `npm run verify`: 통과 (GUI 권한 실행)
