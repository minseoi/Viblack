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

## 2026-04-06 진행 로그

### 71) 버그 조사: 채널 저장 중복명 오류 노출 위치 및 삭제 후 이름 재사용 불가
- 사용자 이슈:
  - 채널 저장 시 `채널 저장 실패: channel name already exists` 경고창이 떠서 채널 모달 바깥 UX를 깨뜨림.
  - 채널을 삭제(아카이브)한 뒤에도 같은 이름으로 새 채널 생성이 막힘.
- 조사:
  - 백엔드 `channelRepository.assertUniqueChannelName`가 아카이브 여부와 무관하게 전체 `channels` 테이블에서 이름 충돌을 검사함.
  - 렌더러 `saveChannel()`는 채널 저장 실패를 전부 `showWarning(...)`로 처리해, 채널명 충돌도 전역 경고 모달로 노출함.
- 조치 예정:
  - 활성 채널(`archived_at IS NULL`)끼리만 이름 충돌로 간주하도록 수정.
  - 채널명 충돌은 채널 모달 내부 인라인 오류로만 표시하고 경고 모달은 띄우지 않도록 정리.
  - Playwright E2E에 삭제 후 동일 이름 재생성 및 중복 인라인 오류 시나리오 추가.

### 72) 버그 수정 진행: 채널 중복명 UX/아카이브 재사용 규칙 정리
- 백엔드:
  - `ChannelRepository`/`ViblackDb`의 채널명 중복 검사를 활성 채널 기준으로 제한.
  - SQLite에 활성 채널명 전용 partial unique index 추가(`archived_at IS NULL` 조건).
- 렌더러:
  - 채널 저장 시 중복명은 `#channel-name-input` 아래 인라인 에러로만 표시하도록 변경.
  - 채널 모달을 다시 열거나 이름을 수정하면 인라인 에러를 즉시 초기화하도록 정리.
- 테스트:
  - `electron.smoke.spec.ts`에 채널 중복명 인라인 오류 및 삭제 후 동일 이름 재생성 UI 시나리오 추가.
  - `electron.channel-metadata.spec.ts`에 아카이브된 채널명 재사용 API 회귀 시나리오 추가.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과
  - 결과: Playwright 16 passed, real-codex 계열 2 skipped

### 73) UI 조사: 멤버 아바타 배경색 일관성 이슈
- 사용자 이슈:
  - 멤버 프로필 이미지(아바타) 배경색이 멤버마다 달라 보여 일관성이 없음.
- 조사:
  - 멤버별 색상 차이 자체가 문제는 아니고, 같은 멤버가 컨텍스트별로 다른 seed를 사용해 다른 색으로 보일 수 있는 구조가 핵심 이슈였음.
  - 멤버 목록/헤더/typing avatar는 주로 `agent.id`를 seed로 쓰지만, DM 메시지 avatar는 `senderId`가 없을 때 `senderLabel`로 fallback 되어 같은 멤버도 다른 색이 될 수 있음.
- 조치:
  - `agent` variant의 해시 기반 고유색은 유지.
  - 메시지 avatar seed 계산을 분리해 `senderId -> agentId -> activeAgentId/name` 순으로 같은 멤버 identity를 우선 사용하도록 수정.
  - Playwright 스모크에 같은 멤버의 목록 avatar와 DM/채널 메시지 avatar 색상 일치 회귀를 추가.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과
  - 결과: Playwright 16 passed, real-codex 계열 2 skipped

### 71) UX 개편 진행: 슬랙 스타일 메시지 레이아웃 착수
- 사용자 요청:
  - 메신저 창을 슬랙처럼 프로필 아바타 + 메시지 중심 레이아웃으로 개편
  - 작업 중 작성자(에이전트) 표시 추가
  - 전체 UX를 슬랙과 유사한 방향으로 정리
- 진행 중:
  - `src/renderer/index.html`, `src/renderer/renderer.ts`, `src/renderer/channel-state.ts` 구조 검토 완료
  - 채널 실행 상태 API(`/api/channels/:channelId/executions`)를 활용해 채널 작성 중 표시를 노출하는 방향으로 설계
  - 메시지 카드형 버블 중심 UI를 좌측 아바타 + 메타 정보 행 기반 UI로 재구성 예정
- 중간 구현:
  - 메인 헤더/DM/채널 메시지/멤버 목록에 공통 아바타 렌더링 헬퍼 추가
  - 채널 실행 job 기준 active typing agent ID 추적으로 `작성 중` 인디케이터 추가
  - Playwright 스모크 테스트에 아바타/typing indicator 회귀 검증 추가
  - `npm run check` 통과
- 마무리:
  - 렌더러 메시지 DOM을 좌측 아바타 + 발신자/시간 메타 행 구조로 재편
  - DM/채널 헤더에 컨텍스트 아바타 추가, 입력창을 슬랙형 composer 카드로 개편
  - DM 완료 후 typing indicator가 남는 경로를 `inflightAgentIds` 정리 직후 상태 동기화로 수정
  - `npm run build` 통과
  - `npm run verify` 통과

### 72) UX 조정 진행: 메시지 hover 하이라이트 제거
- 사용자 요청:
  - 대화 버블 hover 시 하이라이트 제거
  - 이름 옆 `HANDOFF`, `LIVE`, `RESULT` 배지 의미 확인
- 진행 중:
  - 메시지 row hover 스타일 제거 예정
  - Playwright 스모크에 hover 전후 style 불변 확인 추가 예정
- 완료:
  - `src/renderer/index.html`의 `.msg:hover` 강조 스타일 제거
  - `tests/e2e/electron.smoke.spec.ts`에 메시지 hover 전후 background/border/shadow 불변 회귀 추가
  - `npm run verify` 통과

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

### 74) 채널 리팩토링 착수
- 사용자 요청:
  - 채널 리팩토링을 단계별로 끝까지 진행하고, 각 단계 완료 시 테스트/확인까지 수행.
- 착수 범위:
  - Phase 1: 백엔드 채널/에이전트 라우트 및 실행 로직 분리
  - Phase 2: 저장소/도메인 레이어 도입
  - Phase 3: 실행 추적 모델 추가
  - Phase 4: 채널 읽음 상태 모델 및 API 추가
  - Phase 5: 렌더러 채널 상태/동기화 분리
- 원칙:
  - 기존 채널 동작(멘션, 재멘션, SSE 동기화, optimistic dedupe)을 유지하면서 구조만 분리
  - 각 단계 종료 시 최소 `check/build` 및 가능한 E2E 검증 수행

### 75) Phase 1 완료: 백엔드 라우트/실행 서비스 분리
- 조치:
  - `server.ts`를 조립 지점으로 축소
  - 공용 유틸(`text-utils`, `member-prompt`, `mention-router`) 분리
  - `AgentLockManager`, `ChannelEventBus` 도입
  - 채널 메시지 실행 로직을 `ChannelMessageService`로 이동
  - DM 실행 로직을 `AgentExecutionService`로 이동
  - 시스템/에이전트/채널 라우트를 각각 `routes/`로 분리
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run test:e2e` 일반 sandbox 실패: Electron `Process failed to launch!`
  - 권한 상승 재실행 후 `npm run test:e2e` 통과

### 76) Phase 2 완료: Repository 레이어 도입
- 조치:
  - `AgentRepository`, `ChannelRepository`, `ChannelMemberRepository`, `ChannelMessageRepository` 추가
  - 백엔드 서비스/라우트가 `ViblackDb` 거대 메서드 대신 repository를 사용하도록 전환
  - `ViblackDb`는 bootstrap/connection 역할을 유지하고 repository 조합의 기반으로 축소
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - 권한 상승 `npm run test:e2e` 통과

### 77) Phase 3 완료: 채널 실행 추적 모델 추가
- 조치:
  - `channel_execution_jobs` 테이블/타입/repository 추가
  - 채널 멘션/재멘션 enqueue 시 execution job 생성
  - 실행 전 `running`, 종료 후 `succeeded/failed/skipped` 상태와 에러 텍스트 기록
  - `GET /api/channels/:channelId/executions` API 추가
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - 신규 Playwright 시나리오에서 멘션 depth 0, 재멘션 depth 1, 성공 상태 검증 통과

### 78) Phase 4 완료: 채널 멤버 읽음 상태/조율자 상태 모델 추가
- 조치:
  - `channel_member_states` 테이블/타입/repository 추가
  - 채널 멤버 추가 시 상태 초기화 및 첫 멤버 coordinator 지정
  - 멘션 대상 enqueue 및 에이전트 응답 완료 시 읽음 위치/seen 시각 업데이트
  - `GET/POST /api/channels/:channelId/read-state` API 추가
  - 멤버 제거 시 읽음 상태 정리
- 검증:
  - 신규 Playwright 시나리오에서 coordinator 초기값, 읽음 위치 갱신, 상태 수정 API, 멤버 제거 시 상태 제거 검증 통과

### 79) Phase 5 완료: 렌더러 채널 상태/동기화 분리
- 조치:
  - `src/renderer/channel-state.ts` 추가로 채널 목록, 활성 채널, pending message, delta cursor, inflight 상태를 store로 분리
  - `src/renderer/channel-sync.ts` 추가로 SSE/delta 동기화 controller 분리
  - `renderer.ts`는 channel store/controller를 조합하는 형태로 전환
  - `index.html`에서 채널 스크립트를 분리 로드하도록 수정
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - 권한 상승 `npm run test:e2e` 통과

### 80) 채널 리팩토링 완료 검증
- 최종 게이트:
  - 권한 상승 `npm run verify` 통과
  - 결과: `check/build/test:e2e` 모두 성공

### 81) 버그 수정: 응답 중복 출력 회귀
- 사용자 이슈:
  - 한 번의 응답이 여러 메시지로 반복 출력됨.
- 원인:
  - Codex 스트림 이벤트가 누적 스냅샷 형태로 올 때, DM/채널 실행 서비스가 매 이벤트마다 새 메시지를 append하고 있었음.
  - 채널은 같은 메시지 ID 업데이트를 고려하지 않아 스트림 업데이트를 새 출력처럼 보이게 만들 수 있었음.
- 조치:
  - DM 메시지는 첫 스트림 메시지만 생성하고 이후 스트림은 같은 row를 update하도록 수정
  - 채널 메시지도 첫 progress 메시지만 생성하고 이후 스트림/최종 응답은 같은 row를 update하도록 수정
  - 채널 SSE 처리에서 이미 본 message id에 대한 이벤트는 전체 refresh로 반영하도록 보강
  - fake-codex에 다중 스트림 시퀀스 강제 분기 추가
  - E2E 회귀 추가: DM/채널 모두 다중 스트림 업데이트 중 메시지 수가 1개만 유지되는지 검증
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - 권한 상승 Playwright 회귀(`electron.smoke.spec.ts`, `electron.channel-metadata.spec.ts`) 통과

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

### 88) Codex app-server 전환 착수
- 사용자 요청 반영: Codex 실행 경로를 `exec --json` 파싱 중심에서 `app-server` 중심으로 점진 전환 시작.
- 범위:
  - `src/backend/codex.ts`에 app-server 세션 런타임 추가(우선 사용, 실패 시 exec fallback).
  - 기존 DM/채널 로직(`server.ts`)은 인터페이스 유지로 회귀 최소화.
  - E2E 픽스처/시나리오를 app-server 경로까지 확장.

### 89) 구현 진행: app-server 런타임 + 테스트 픽스처 확장
- `src/backend/codex.ts`:
  - app-server(JSON-RPC over stdio) 클라이언트 추가.
  - `thread/start|resume` + `turn/start` 기반 실행 경로 구현.
  - `item/completed`의 `agentMessage`를 스트리밍 메시지로 반영.
  - app-server 런타임 오류(프로세스/프로토콜) 시 기존 `exec` 경로로 fallback.
- `tests/e2e/fixtures/fake-codex.js`:
  - `app-server` 서브커맨드 모드 구현.
  - 기존 `FORCE_*` 테스트 토큰 동작을 app-server 경로에도 반영.
- `tests/e2e/electron.smoke.spec.ts`:
  - `FORCE_REQUIRE_APP_SERVER` 메시지로 app-server 경로 사용 회귀 검증 추가.

### 90) 회귀 수정: app-server delta 스트리밍 중간 메시지 복구
- 검증 중 이슈:
  - app-server 경로에서 `item/agentMessage/delta`를 UI 스트림으로 전달하지 않아,
  - DM 중간 응답 노출(`STREAM_*`) 시나리오가 회귀 실패.
- 조치(`src/backend/codex.ts`):
  - delta 누적 버퍼(`deltaAggregate`) 도입.
  - 조건부 emit(초기 길이/증분/문장 경계)로 토큰 스팸을 억제하면서 중간 메시지 반영.
  - `item/completed(agentMessage)`와 중복 emit 방지(`lastStreamEmit`) 처리.

### 91) 검증 완료: app-server 점진 도입 안정화
- 자동 회귀:
  - `npm run verify` 통과 (check/build/e2e 통과, real-codex spec 기본 skip)
- 실코덱스 검증:
  - `VIBLACK_E2E_REAL_CODEX=1 npx playwright test tests/e2e/electron.real-codex.spec.ts` 통과
- 결과:
  - 기본 실행 경로를 app-server 우선으로 전환하되,
  - app-server 런타임 장애 시 기존 exec 경로 fallback으로 서비스 연속성 확보.

### 92) 원인 분석: 두 줄 응답이 여러 메시지로 분할 표시되는 현상
- 실측(실코덱스 direct):
  - `codex exec --full-auto --skip-git-repo-check --json` 동일 프롬프트 응답은 `item.completed(item.type=agent_message)` 1건으로 도착.
  - 예: `text="ALPHA\nBETA"` (단일 최종 메시지)
- 실측(실코덱스 app-server + 앱 UI):
  - 동일 계열 프롬프트에서 UI `msg-agent`가 누적 중간 텍스트로 여러 개 렌더링됨.
  - 예: 짧은 접두 텍스트 -> 더 긴 중간 텍스트 -> 최종 텍스트 (3개)
- 실측(app-server raw 이벤트 probe):
  - `item/agentMessage/delta`가 토큰 단위로 다수 발생하고,
  - 마지막에 `item/completed(agentMessage)` 1건이 도착.
- 코드 원인:
  - `src/backend/codex.ts`에서 delta 누적본을 `onStream(message)`로 emit (`item/agentMessage/delta` 처리).
  - `src/backend/server.ts` DM/채널 경로가 `onStream` 수신마다 DB에 신규 메시지를 `append`.
  - 따라서 "중간 상태"가 매번 별도 버블로 저장/렌더되고, 최종 completed 텍스트까지 별도 버블로 추가될 수 있음.

### 93) 수정 계획 수립: 스트림은 "업데이트", 최종만 "확정"으로 분리
- 목표:
  - 사용자 기준 1회 응답은 기본적으로 1개 버블(최종 메시지)로 보이게 함.
  - 중간 메시지를 보여주더라도 같은 버블 내용 업데이트 방식으로 동작하게 함.
- 계획안:
  1. DB 레이어에 메시지 업데이트 메서드 추가
     - DM: `messages`의 마지막 스트림 메시지 `content`를 update 가능하도록 `updateMessageContent(id, content)` 추가.
     - Channel: `channel_messages`도 동일 update 메서드 추가.
  2. 서버 스트림 처리 정책 변경
     - DM/채널 모두 `onStream` 최초 1회만 progress 메시지 append 후, 이후 delta/completed는 동일 메시지 update.
     - turn 완료 시 최종 텍스트가 존재하면 progress 메시지를 final(result)로 승격(내용 교체 + kind 조정)하고 신규 append 지양.
  3. SSE/폴링 동기화 보강
     - Channel은 현재 append 이벤트 기반이므로, 업데이트 이벤트(`channel_message_updated`)를 추가하거나 기존 폴링 주기에서 변경 감지 보강.
     - DM은 폴링 기반이라 update 반영은 즉시 가능.
  4. 회귀 테스트 추가
     - 실코덱스/fake 공통: "2줄 응답"에서 agent 버블 개수가 1개인지 검증.
     - 스트리밍 존재 케이스에서도 최종 버블 1개 유지 + 내용은 최종 텍스트와 일치 검증.

### 82) 기능 구현 시작: Codex 모델 설정/실행 연동
- 사용자 요청:
  - `~/.codex/models_cache.json`에서 사용 가능한 모델 목록을 읽고,
  - 설정 UI에서 모델을 선택/저장하며,
  - 선택된 모델로 `codex exec -m <model>` 실행되도록 연결.
- 구현 계획:
  - `app_settings` 저장소 + settings API 추가
  - 선택 모델이 있을 때 exec 경로로 모델 인자 주입
  - Slack 참고 설정 모달 UI + E2E 회귀 추가
- 진행 업데이트:
  - `app_settings` 테이블과 `AppSettingsRepository/AppSettingsService` 추가
  - `GET /api/settings`, `PATCH /api/settings/model` API 추가
  - DM/채널/시스템 프롬프트 생성 경로에 선택 모델 주입
  - 선택 모델이 있으면 `runCodex`가 app-server 대신 `exec -m` 경로를 사용하도록 변경
- 중간 검증:
  - `npm run check` 통과
- 진행 업데이트:
  - 렌더러 상단에 현재 모델 배지와 `환경 설정` 진입 버튼 추가
  - Slack 스타일 2단 설정 모달 추가, 모델 목록/캐시 경로/오류 상태 표시 연결
  - 설정 저장 후 상태 텍스트와 모델 배지가 즉시 갱신되도록 정리
- 중간 검증:
  - `npm run build` 통과
- 진행 업데이트:
  - fake codex가 `-m/--model` 인자를 읽어 선택 모델 검증 응답을 반환하도록 확장
  - `tests/e2e/electron.settings.spec.ts` 추가: 설정 모달 모델 저장, 표시 상태, DM 실행 모델 적용 검증
- 중간 검증:
  - `npm run test:e2e -- tests/e2e/electron.settings.spec.ts` 통과
- 최종 검증:
  - `npm run verify` 통과
  - 결과: Playwright 3 passed, `electron.real-codex.spec.ts`는 환경 미설정으로 1 skipped

### 83) UI 조정: 환경 설정 버튼을 사이드바 하단으로 이동
- 사용자 요청:
  - 환경 설정 버튼을 슬랙처럼 왼쪽 패널 하단에 배치.
- 조치 계획:
  - 상단 헤더에서 설정 진입 요소 제거
  - 사이드바 하단 footer 영역 추가
  - 설정 E2E에 위치 회귀 검증 추가
- 추가 UI 조정 요청:
  - 설정 모달 좌측 패널 문구 `Slack 스타일 설정 화면에서 Codex 실행 모델을 관리합니다.` 제거
  - 설정 E2E에 문구 부재 반영 예정
- 진행 업데이트:
  - 환경 설정 버튼을 상단 헤더에서 제거하고 사이드바 하단 footer로 이동
  - 설정 모달 좌측 패널의 보조 문구 제거
  - 설정 E2E에 버튼 위치/문구 부재 검증 추가
- 최종 검증:
  - `npm run verify` 통과

### 84) 버그 수정 착수: 채널 실행 컨텍스트 누락
- 사용자 이슈:
  - 채널 리팩토링 후 A 멤버가 B 멤버의 이전 발언을 모르고,
  - 현재 채널에 어떤 멤버가 있는지 모르는 상태로 응답함.
- 원인 가설:
  - 채널 실행 프롬프트가 `채널 이름 + 현재 트리거 문장` 정도만 포함하고 있어,
  - 멤버 roster와 최근 공개 타임라인이 Codex 실행 입력으로 전달되지 않음.
- 조치 계획:
  - 채널 멤버 목록 + 최근 메시지 맥락을 프롬프트에 구조화해 포함
  - fake codex와 E2E로 실제 전달 여부 검증
- 진행 업데이트:
  - 채널 실행 프롬프트에 `CHANNEL_MEMBERS`, `CHANNEL_RECENT_MESSAGES`, `ACTIVE_TRIGGER_MESSAGE` 섹션 추가
  - 채널 멤버 roster와 최근 공개 메시지 12개를 실행 입력으로 전달하도록 수정
  - fake codex에 채널 컨텍스트 검증 로직 추가
  - `electron.channel-metadata.spec.ts`에 roster/history 전달 회귀 테스트 추가
- 중간 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npx playwright test tests/e2e/electron.channel-metadata.spec.ts` 통과
- 테스트 안정화:
  - `electron.smoke.spec.ts`의 채널 병렬 지연 구간에서 전체 메시지 개수 단정을 제거
  - 대신 두 사용자 메시지가 먼저 보이고, 지연된 Alpha 응답은 나중에 도착하는 의미 단정으로 조정

85) 실제 로컬 채널 대화 디버깅 착수
- 사용자 제보: 영희가 존에게 조사 요청을 시킨 뒤 결과를 정리해달라고 했는데, 존 조사 결과 메시지가 보이지 않음.
- 확인 방향: 실제 로컬 SQLite에서 channel_messages, channel_message_mentions, channel_execution_jobs를 조회해 존 호출 여부와 메시지 저장 여부를 분리 진단.
- 실제 로컬 DB 확인 결과: 문제 시점 사용자 메시지(id=91) 이후 존 대상 execution job 없음, 영희 응답(id=92)에 재멘션 레코드도 없음.
### 86) 기능 추가 착수: 자연어 위임 요청을 채널 @멘션 실행으로 강제
- 목표: 에이전트가 "존한테 시켜" 같은 지시를 받으면 채널 멘션 기능을 이해하고 실제 `@존` 텍스트로 위임하게 함.
- 구현 방향: channel system prompt에 위임/보고 규칙 명시, fake-codex 자연어 위임 시뮬레이션 추가, E2E로 위임→보고→요약 체인 검증.
- 구현 완료: channel prompt/system prompt에 정확한 @멘션 위임 규칙, 보고-재멘션 규칙, 허위 위임 결과 금지 규칙 추가.
- 테스트 추가: 자연어 위임 요청이 실제 멘션 체인(영희→존→영희)으로 이어지는 E2E 시나리오 작성.
### 87) 기능 추가 착수: 모호한 재질문도 반드시 요청자 멘션으로 환류
- 목표: 채널 멤버가 다른 멤버에게 확인 질문을 할 때 plain text가 아니라 반드시 요청자 @멘션을 써서 작업이 끊기지 않게 함.
- 구현 방향: channel prompt에 ACTIVE_TASK_REQUESTER 추가, system prompt에 재질문/보고 시 요청자 명시 멘션 규칙 추가, E2E로 모호한 위임 재질문 회귀 검증.
- 구현 완료: ACTIVE_TASK_REQUESTER prompt 섹션 추가, 재질문/결과 보고 시 요청자 명시 멘션 규칙 추가.
- 테스트 추가: 모호한 위임에서 하위 멤버가 `@요청자 확인 질문`으로 되돌리는 E2E 시나리오 작성.
- 최종 검증: `npm run check`, `npm run build`, `npx playwright test tests/e2e/electron.channel-metadata.spec.ts`, `npm run verify` 통과.
### 88) 버그 조사 착수: 처리 중인데 상단바 상태가 ready로 보이는 문제
- 확인 방향: 렌더러 status 표시 로직, DM/채널 inflight 상태, SSE 기반 후속 실행 처리 타이밍을 코드 기준으로 분석.
### 89) 실제 로컬 채널 대화 디버깅: `test` 채널 재멘션 체인 정지
- 사용자 제보: `test` 채널 최신 대화에서 존이 `@영희`를 멘션했는데 영희가 응답하지 않음.
- 실제 로컬 DB 확인:
  - 메시지 흐름: `103(user @영희) -> 104(영희 @존) -> 105(존 @영희) -> 106(영희 @존) -> 107(존 @영희)`.
  - `channel_message_mentions`에는 메시지 `107`의 `@영희` 레코드가 저장됨.
  - `channel_execution_jobs`에는 job `28`이 `trigger_message_id=103`, `source_message_id=107`, `target_agent_id=member-2(영희)`, `execution_kind=remention`, `depth=4`, `status=queued`로 남아 있고 `started_at`/`finished_at`이 비어 있음.
- 코드 기준 판단:
  - `ChannelMessageService.MAX_MENTION_CHAIN_DEPTH = 4`.
  - while 조건이 `chainDepth < MAX_MENTION_CHAIN_DEPTH`라서 깊이 4 작업은 enqueue만 되고 실행 루프에 들어가지 않음.
  - 별도 background worker가 없어 이 queued job은 나중에 자동 소비되지 않음.
- 결론: 요청이 누락된 것은 아니고, 실제 멘션/실행 잡 생성까지는 됐지만 멘션 체인 최대 깊이 도달로 영희 응답이 영구 대기 상태처럼 멈춘 사례임.
### 90) 버그 수정 착수: 멘션 체인 깊이 제한 제거
- 목표:
  - 고정 `MAX_MENTION_CHAIN_DEPTH` 제거
  - 총 실행 예산(`MAX_MENTION_EXECUTIONS`)만 유지
  - 예산 초과로 실행하지 못한 job은 `queued` 방치 대신 `skipped` 종료
  - 채널에 중단 이유를 시스템 메시지로 남김
- 테스트 계획:
  - depth 4를 넘어도 연쇄 재멘션이 계속 실행되는 회귀 E2E 추가
  - 실행 예산 소진 시 마지막 job이 `skipped`로 끝나는 E2E 추가
- 구현 진행:
  - `ChannelMessageService`에서 depth 기반 while 종료 조건 제거
  - 실행 batch가 예산을 초과하면 초과분을 `skipped`로 마감하고 시스템 결과 메시지를 기록하도록 조정
  - chained mention depth는 배치 카운터가 아니라 각 task의 실제 depth 기준으로 계산하도록 변경
  - fake-codex에 `FORCE_CHAIN_BOUNCE:<target>,<remaining>` 지시어 추가
  - `electron.channel-metadata.spec.ts`에 depth 4 초과 연쇄 실행 케이스와 실행 예산 소진 케이스 추가
- 중간 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npx playwright test tests/e2e/electron.channel-metadata.spec.ts` 통과 (6 passed)
- 최종 검증:
  - `npm run verify` 통과 (`8 passed`, `1 skipped`: `electron.real-codex.spec.ts`)
### 91) 코드 분석: DM/채널 간 Codex 세션 공유 구조 확인
- 사용자 질문: 채널에서 말한 내용을 DM에서 물어봐도 멤버가 알고 있는 이유와 현재 저장/세션 구조 확인 요청.
- 확인 결과:
  - 메시지 저장은 분리됨: DM은 `messages`, 채널은 `channel_messages`.
  - 그러나 Codex 대화 세션은 `agents.session_id` 단일 컬럼 하나로 관리됨.
  - DM 실행(`AgentExecutionService.sendDirectMessage`)과 채널 실행(`ChannelMessageService.executeMentionedAgent`) 모두 같은 `agent.sessionId`를 `runCodex`에 전달하고, 새 session id도 다시 같은 `agents.session_id`에 덮어씀.
  - `runCodex`는 `sessionId`가 있으면 `buildPrompt()`에서 새 `systemPrompt`를 다시 넣지 않고 `userPrompt`만 보내므로, 기존 thread의 문맥/역할이 더 강하게 이어짐.
- 판단:
  - 현재 구현은 "에이전트 1명당 Codex 세션 1개" 구조다.
  - 따라서 같은 멤버가 채널과 DM을 오가면 Codex 내부 thread가 공유되어 채널 맥락이 DM에서 보이는 것이 자연스러운 현상이다.
  - 제품 의도가 DM과 채널을 분리된 작업 공간으로 보는 쪽이라면, 세션 키를 최소 `agent_id + conversation_scope(dm|channel:<id>)` 단위로 분리하는 편이 맞음.
### 92) 기능 수정 착수: DM/채널 런타임 세션 스코프 분리
- 목표:
  - 에이전트 정의(`name`, `role`, `system_prompt`)는 공용으로 유지
  - Codex 런타임 세션은 `dm`과 `channel:<channelId>` 단위로 분리
  - DM 메시지 초기화는 DM 세션만 리셋하고, 채널 멤버 제거는 해당 채널 세션만 리셋
  - 에이전트 정의 수정 시 기존 인스턴스 세션을 비워 새 설정으로 다시 instantiate 되게 함
- 구현 진행:
  - `agent_runtime_sessions(agent_id, scope_key, session_id, updated_at)` 테이블 추가
  - `AgentRepository`에 scoped runtime session 조회/업서트/삭제 API 추가
  - DM 실행은 `dm` scope 세션만 사용하도록 변경
  - 채널 실행은 `channel:<id>` scope 세션만 사용하도록 변경
  - 채널 멤버 제거 시 해당 채널 scope 세션 삭제
  - 에이전트 수정 시 모든 runtime session 삭제
  - fake-codex에 session memory 시뮬레이션 추가 (`FORCE_SESSION_MEMORY_WRITE/READ`)
  - Playwright API E2E에 DM/채널 세션 격리 회귀 테스트 추가
- 테스트 보강:
  - fake-codex가 resumed session에서도 agent identity/채널 위임 규칙을 유지하도록 session state 저장 로직 추가
  - 바운스 체인 시뮬레이션은 현재 프롬프트의 멘션에서 실행 주체를 추론하도록 보강
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npx playwright test tests/e2e/electron.channel-metadata.spec.ts` 통과 (7 passed)
  - `npm run verify` 통과 (`9 passed`, `1 skipped`: `electron.real-codex.spec.ts`)
- 커밋 완료: fix_channel_collaboration_context_and_mention_delegation (검증 완료 후 커밋).
- 원인 분석: channel progress update가 같은 messageId로 SSE에 들어올 때 refreshMessages()가 상태바를 무조건 Ready로 덮어써 실제 실행 중에도 ready로 보였음.
- 수정 방향: active channel running execution job 수를 추적하고, channel refresh/delta sync가 status를 inflight+running job 기준으로 계산하게 변경.
- 구현 완료: channel 상태바가 inflight request 뿐 아니라 active channel running execution job 수를 함께 보고 `working/ready`를 계산하도록 수정.
- 회귀 테스트 추가: streaming channel mention 진행 중 상단바가 Ready로 떨어지지 않고 `Channel is working...`을 유지하는 smoke 검증 추가.
- 최종 검증: `npm run check`, `npm run build`, `npm run test:e2e -- tests/e2e/electron.smoke.spec.ts`, `npm run verify` 통과.
### 89) 작업 요청: 현재 워킹트리 전체 커밋
- 확인 방향: 남아 있는 변경이 코드인지 문서인지 확인 후, 범위 그대로 커밋.
### 93) 분석: Test2 채널 대화 흐름 점검
- 요청:
  - 실제 사용자 DB의 `Test2` 채널 대화 흐름을 확인하고, 사용자 의도 대비 실제 진행 경로와 문제점을 분석.
- 확인한 자료:
  - 채널 기능 의도 문서: `codexdocs/channel-functional-spec.md`, `codexdocs/channel-Refactoring.md`
  - 실제 DB: `~/Library/Application Support/viblack/viblack.sqlite`
  - 관련 구현: `src/backend/services/channel-message-service.ts`, `src/backend/services/member-prompt.ts`, `src/backend/routes/channel-routes.ts`
- 데이터 확인 결과:
  - `Test2` 채널(`channel-4`) 멤버는 영희(시스템 기획자), 존(리서치 전문가), 매튜(문서 작성 전문가).
  - 사용자 최초 메시지는 `@영희`에게 조사 위임과 문서화 위임을 순서대로 조율한 뒤 최종 보고를 요구.
  - 실제 실행은 영희 -> 존/매튜 병렬 위임 -> 영희 재질문/재확인 -> 매튜/존/영희 간 반복 재멘션으로 이어졌고, 최종적으로 멘션 실행 한도 12건에 걸려 후속 1건이 스킵됨.
- 현재 판단:
  - 사용자 의도는 "영희가 조율자로서 존에게 조사, 매튜에게 문서화, 마지막에 사용자에게 최종 결과 보고"인 단일 파이프라인에 가깝다.
  - 실제 구현/프롬프트는 채널 멤션을 매우 강하게 요구하고, 재질문/결과 보고도 요청자 멘션을 강제해 멤버 간 핑퐁을 유도한다.
  - `isCoordinator` 상태는 저장되지만 실제 채널 실행 프롬프트/오케스트레이션에서 조율 정책으로 활용되지 않는다.
  - 그 결과 대표 멤버가 "사용자에게 닫는" 대신 "상대 멤버에게 다시 열어두는" 대화 루프가 생겼다.
- 메모:
  - 이번 작업은 분석만 수행. 코드 수정 및 검증 명령은 실행하지 않음.
### 94) 질의 응답: 채널 대화 공유/할당/연속성 구조 확인
- 요청:
  - 현재 구현에서 채널 대화가 멤버들에게 실제로 어떻게 공유되는지, 멤버들에게 일이 어떤 방식으로 주어지고 대화가 어떻게 이어지는지 설명.
- 코드 확인:
  - `src/backend/services/channel-message-service.ts`
  - `src/backend/services/member-prompt.ts`
  - `src/backend/repositories/channel-message-repository.ts`
  - `src/backend/repositories/agent-repository.ts`
  - `src/backend/services/mention-router.ts`
  - `src/backend/runtime-session-scope.ts`
- 확인 결과 요약:
  - 채널 메시지는 `channel_messages`에 공개 로그로 저장되고, 멘션된 멤버만 실제 실행된다.
  - 멤버들은 채널을 “실시간으로 계속 듣는” 구조가 아니라, 실행 시점에 최근 채널 메시지 스냅샷과 멤버 목록을 프롬프트로 받아 처리한다.
  - 연속성은 두 층으로 유지된다:
    - 공개 맥락: 최근 채널 메시지 최대 12개
    - 멤버 개인 맥락: `agent_runtime_sessions`의 `channel:<channelId>` 세션
  - 따라서 채널 전체가 멤버 간 완전히 동일한 숨은 메모리로 공유되는 것은 아니고, 공용 로그 + 멤버별 채널 세션이 결합된 방식이다.
### 95) 작업 착수: 채널 위임 평가 루프 자동화
- 요청:
  - 실제 Codex 기반으로 대표 시나리오를 반복 평가하는 자동화 루프를 만들고, 기준 측정 -> 수정 -> 재측정 -> 재수정 과정을 문서화하며 반복.
- 현재 진행:
  - 기존 real-codex/fake-codex E2E 자산 검토 시작.
  - 새 작업 문서 `codexdocs/channel-delegation-eval-loop.md` 생성.
  - 평가 목표, 점수 기준, 반복 루프, 초기 가설을 문서화.
- 확인 메모:
  - 실제 Real Codex 평가는 `electron.real-codex.spec.ts`의 opt-in 패턴을 재사용하는 것이 적합.
  - 회귀 검증은 Playwright + fake-codex fixture에 새 협업 프로토콜을 추가해 `verify`에 넣을 수 있게 설계하는 방향이 적합.
### 96) baseline 측정: real Codex 채널 위임 평가
- 구현:
  - `tests/e2e/support/channel-delegation-eval.ts` 추가
    - 채널/멤버 시나리오 생성
    - settle 대기
    - transcript/job 수집
    - 점수 계산
    - JSON/Markdown artifact 저장
  - `tests/e2e/electron.channel-delegation.real.spec.ts` 추가
    - `VIBLACK_E2E_REAL_CODEX=1`일 때 실제 Codex 평가 실행
    - `channel-delegation-real-report.{json,md}` artifact 생성
- baseline 실행:
  - 명령: `VIBLACK_E2E_REAL_CODEX=1 VIBLACK_E2E_REAL_CODEX_TIMEOUT_MS=420000 npx playwright test tests/e2e/electron.channel-delegation.real.spec.ts`
  - 결과: 실행 완료, report 생성
- baseline 점수:
  - `40/100`, verdict=`fail`
- 실제 관찰된 핵심 실패:
  - 영희가 첫 턴에서 순차 위임 의도를 잘 표현했지만, 실제 자동 실행은 `존`까지만 이어짐.
  - `존` 응답 본문에는 `@영희에게`가 있었지만 후속 실행으로 연결되지 않음.
  - 현행 `mention-router`는 이름 뒤 한국어 조사 결합형(`에게`, `한테` 등)을 멘션 경계로 인정하지 않아 재진입이 끊기는 것으로 보임.
  - 따라서 이 baseline은 "루프 폭주"보다 앞선 더 기본적인 실패, 즉 "자연어 멘션 해석 취약성 + coordinator continuation 부재"를 드러냄.
### 97) 채널 위임 오케스트레이션 개편 + 평가 루프 1차 성공
- 구현:
  - `src/backend/services/channel-action-protocol.ts` 추가
    - `[CHANNEL_ACTION] ... [/CHANNEL_ACTION]` 블록에서 `delegate/report/ask_user/final/noop` 파싱
  - `src/backend/services/member-prompt.ts` 수정
    - 채널 프롬프트에 coordinator/worker 모드 명시
    - 순차 위임 규칙, `CHANNEL_ACTION` 예시, worker/coordinator 책임 경계 추가
  - `src/backend/services/channel-message-service.ts` 수정
    - 후속 실행을 자유 텍스트 멘션보다 action block 우선으로 해석
    - `delegate`만 실행 큐로 넘기고 `report`는 requester/coordinator 재진입, `ask_user/final`은 자동 후속 실행 없이 종료
    - coordinator state를 읽어 프롬프트에 반영
  - `src/backend/services/mention-router.ts` 수정
    - `@이름에게`, `@이름한테` 같은 조사 결합형 멘션 인식
  - `tests/e2e/fixtures/fake-codex.js` 수정
    - 대표 시나리오용 결정론적 delegation reply 추가
  - `tests/e2e/electron.channel-delegation.spec.ts` 추가
    - fake-codex 기준 `영희 -> 존 -> 영희 -> 매튜 -> 영희` 순서를 회귀 검증
- real 평가 결과:
  - 대표 시나리오 재실행 결과 최종 점수 `100/100`, verdict=`pass`
  - 성공 흐름 확인:
    - `영희`가 먼저 `존`에게 조사 위임
    - `존`이 공개 채널에 결과 보고 후 `영희`에게 제어 반환
    - `영희`가 `매튜`에게 문서화 위임
    - `매튜`가 공개 채널에 문서 초안 보고
    - `영희`가 사용자 전달용 최종 결과와 함께 종료
### 98) verify 회귀 복구 및 최종 검증 완료
- 최초 `npm run verify` 결과:
  - 새 대표 시나리오 평가는 통과했지만, 기존 메타데이터 회귀 2건 실패
  - 실패 테스트:
    - `natural language delegation request becomes channel mention chain`
    - `ambiguous delegated task triggers clarification mention back to requester`
- 원인 분석:
  - fake-codex generic delegation fixture가 예전 "exact mention" 규칙에만 반응하고, 새 `CHANNEL_ACTION` 프로토콜 기반 응답은 생성하지 못했음
  - 따라서 실제 런타임은 action block을 기대하는데 fixture가 후속 위임/보고 메시지를 만들지 않아 1턴에서 체인이 끊어짐
- 수정:
  - `tests/e2e/fixtures/fake-codex.js`
    - generic delegation reply도 `CHANNEL_ACTION` 규칙 인식
    - 위임은 `type=delegate`
    - worker 결과 반환은 `type=report`
    - coordinator 최종 응답은 `type=final`
    - 모호한 위임은 worker가 coordinator에게 `확인 질문`을 보고하고, coordinator가 `type=ask_user`로 멈추도록 조정
- 검증:
  - 대상 2개 회귀 재실행: 통과
  - `npm run check`: 통과
  - `npm run build`: 통과
  - `npm run verify`: 통과 (`10 passed, 2 skipped`)
### 99) real Codex 불안정성 복구: empty response 재시도 + 평가 하네스 내구성 강화
- 추가 real 평가 중 관찰된 문제:
  - 일부 실행에서 `매튜` 또는 최종 `영희` 턴이 `empty response from codex`로 끊김
  - 다른 실행에서는 renderer window 종료와 함께 평가 하네스의 `page.evaluate` 호출이 끊겨, 실제 채널 상태를 끝까지 수집하지 못함
- 원인 분석:
  - 오케스트레이션 자체는 맞지만, 실제 Codex `exec` 런타임은 드물게 "성공 종료 + 빈 응답"을 반환할 수 있음
  - 평가 하네스가 매 API 호출을 renderer page에 의존하고 있어, 창이 닫히면 백엔드 상태 수집도 함께 끊겼음
  - `main.ts`는 마지막 창이 닫히면 즉시 앱과 서버를 내리므로, 평가 중 창 종료에 취약했음
- 수정:
  - `src/backend/codex.ts`
    - 빈 성공 응답을 transient failure처럼 1회 재시도
    - 재시도 사이에 새로 획득한 `sessionId`를 이어받아 컨텍스트 보존
  - `tests/e2e/fixtures/fake-codex.js`
    - `FORCE_EMPTY_SUCCESS_ONCE` 추가
  - `tests/e2e/electron.channel-metadata.spec.ts`
    - `channel execution retries once when codex returns an empty successful response` 회귀 추가
  - `tests/e2e/support/channel-delegation-eval.ts`
    - backend base URL을 초기 1회만 가져오고, 이후 API 호출은 Node `fetch`로 수행하도록 전환
    - 평가 환경에서 `VIBLACK_KEEP_ALIVE_WITHOUT_WINDOW=1` 주입
  - `src/main.ts`
    - `VIBLACK_KEEP_ALIVE_WITHOUT_WINDOW=1`일 때 `window-all-closed`로 즉시 shutdown 하지 않도록 조정
- 실측 재검증:
  - real Codex 평가 재실행:
    - 명령: `VIBLACK_E2E_REAL_CODEX=1 VIBLACK_E2E_REAL_CODEX_TIMEOUT_MS=420000 npx playwright test tests/e2e/electron.channel-delegation.real.spec.ts`
    - 결과: 통과
    - artifact: `test-results/electron.channel-delegatio-dc6fc-annel-delegation-evaluation/channel-delegation-real-report.json`
    - 점수: `100/100`, verdict=`pass`
    - job order: `영희 -> 존 -> 영희 -> 매튜 -> 영희`
### 100) 최종 전체 검증 갱신
- 검증:
  - `npm run check`: 통과
  - `npm run build`: 통과
  - `npx playwright test tests/e2e/electron.channel-delegation.spec.ts`: 통과
  - `npx playwright test tests/e2e/electron.channel-metadata.spec.ts --grep "empty successful response"`: 통과
  - `npm run verify`: 통과 (`11 passed, 2 skipped`)
### 101) 코드 작업 worker 완료 기준 강화
- 배경:
  - 실제 `테트리스 개발팀` 채널에서 철수가 "아래 로직으로 구현하겠습니다"라고 답한 뒤 실행 job은 `succeeded`로 끝났지만, `report` action과 산출물 경로가 없어 coordinator 재진입이 끊김
  - 파일은 실제로 생성됐지만 채널 오케스트레이션은 이를 완료 보고로 인식하지 못해 사용자 입장에서는 "말만 하고 안 한 것처럼" 보였음
- 수정:
  - `src/backend/services/member-prompt.ts`
    - 코드/파일 산출물 task일 때는 계획만 말하지 말고 실제 파일 작업 후 `type=report + artifact_path`를 넣도록 프롬프트 강화
  - `src/backend/services/channel-action-protocol.ts`
    - `artifact_path` 파싱 추가
  - `src/backend/services/channel-message-service.ts`
    - delegated code task에서 코드 역할 worker 응답은 다음 조건을 만족해야 성공 처리:
      - `type=report` action 존재
      - 실제 존재하는 산출물 파일 경로 존재
      - intent-only 문구(`구현하겠습니다` 등)만으로 끝나지 않음
    - 위 조건을 어기면 `채널 코드 작업 미완료` 시스템 메시지와 함께 job을 `failed` 처리
  - `tests/e2e/fixtures/fake-codex.js`
    - `FORCE_CODE_ARTIFACT_INTENT_ONLY`, `FORCE_CODE_ARTIFACT_SUCCESS:*` 시나리오 추가
  - `tests/e2e/electron.channel-metadata.spec.ts`
    - delegated code task intent-only 응답 실패 회귀 추가
    - delegated code task artifact success 회귀 추가
- 중간 검증:
  - `npm run check`: 통과
  - `npm run build`: 통과
  - `npx playwright test tests/e2e/electron.channel-metadata.spec.ts --grep "delegated code task|empty successful response"`: 통과 (`3 passed`)
- 최종 검증:
  - `npm run verify`: 통과 (`13 passed, 2 skipped`)

### 71) 기능 구현: 테트리스 블럭 회전 엔진 추가(회전 전용)
- `src/renderer/tetris-rotation.ts` 신규 생성
- 현재 블럭 상태(`PieceState`) 기준으로 CW/CCW 회전 처리 함수(`tryRotatePiece`) 구현
- 7종 폴리오미노 좌표 기반 회전, 보드 경계/충돌 검사, 기본 wall-kick 후보 `(0,0),(-1,0),(1,0),(0,-1),(1,-1),(-1,-1)` 재시도 반영
- 독립형 유틸 함수로 구성(`getPieceCells`, `canPlacePiece`)하여 렌더러 기존 코드와 충돌 최소화

### 72) 채널 작업 착수: 테트리스 회전 엔진 파일 생성(공개 산출물)
- `src/renderer/tetris-rotation.ts`를 독립 모듈로 생성해 `tryRotatePiece` + `canPlacePiece` + `getPieceCells` + wall-kick 후보 적용을 한 파일에 완성
- 사용자 요청(회전 동작 최소 구현)에 맞춰 입력/랜더러 본체 의존성 없이 바로 합성 가능한 형태로 구현

### 102) 채팅 누적 버그 조사 착수: 동일 멤버 다중 응답 overwrite
- 증상:
  - 같은 멤버가 한 턴 안에서 여러 assistant 메시지를 보낼 경우, 이전 bubble이 남지 않고 마지막 응답으로 덮이는 현상 제보
- 1차 분석:
  - renderer/channel-state 쪽은 메시지를 sender가 아니라 `message.id` 기준으로 merge 중
  - 실제 overwrite 지점은 backend execution service로 추정
  - DM/채널 모두 스트림 중간 응답을 같은 message row에 `update`하는 구조라, Codex `item.completed` 다중 메시지를 append하지 못하는 경로 확인
- 작업 계획:
  - fake-codex에 다중 completed agent message 시나리오 추가
  - Playwright E2E에 DM/채널 누적 회귀 추가
  - Codex stream event를 delta/completed 경계로 해석해 append/update 정책 수정

### 103) 채팅 누적 버그 수정: completed agent message는 append로 보존
- 구현:
  - `src/backend/services/agent-message-stream.ts` 추가
    - Codex stream raw payload에서 `item/completed` agent message 경계를 판별하는 유틸 분리
  - `src/backend/services/agent-execution-service.ts`
    - DM 실행 중 delta/snapshot은 기존 in-flight bubble을 update
    - completed agent message는 새 bubble로 append하고, 최종 reply가 마지막 completed와 같을 때만 그 마지막 bubble을 finalize
    - 실패 시에는 이전 agent bubble을 system으로 덮지 않고 system error를 별도 append
  - `src/backend/services/channel-message-service.ts`
    - 채널 실행도 동일한 append/finalize 규칙으로 정렬
    - 한 worker가 한 턴 안에서 여러 completed agent message를 내도 이전 공개 메시지가 보존되도록 수정
  - `tests/e2e/fixtures/fake-codex.js`
    - `FORCE_ITEM_COMPLETED_AGENT_MESSAGE_SEQ:` 시나리오 추가
  - `tests/e2e/electron.smoke.spec.ts`
    - DM 다중 completed agent message 누적 회귀 추가
    - 채널 멘션 실행에서 동일 멤버 다중 completed message 누적 회귀 추가
- 검증:
  - `npm run check`: 통과
  - `npm run build`: 통과
  - `npx playwright test tests/e2e/electron.smoke.spec.ts --grep "electron full feature regression flow"`: 통과

### 104) 실사용 채널 조사 착수: `테트리스2`
- 실사용 DB 경로 확인:
  - `/Users/minseoi/Library/Application Support/viblack/viblack.sqlite`
- 조사 계획:
  - `테트리스2` 채널의 멤버/메시지/job/read-state를 함께 조회
  - 마지막 실행이 어디서 끊겼는지와 실제 산출물 존재 여부를 분리해서 확인

### 105) coordinator 단일화 및 사용자 첫 멘션 승격
- 조사 결과:
  - `테트리스2`에서 실제 coordinator state는 `존`이었고, 사용자가 `@영희`로 시작했어도 `영희`가 조율자로 승격되지 않음
  - 원인 중 하나는 첫 멤버가 coordinator로 고정되고, read-state 승격도 기존 coordinator를 자동 해제하지 않던 점
- 구현:
  - `src/backend/services/mention-router.ts`
    - 멘션 추출 결과를 후보 길이 순서가 아니라 본문 첫 등장 순서로 정렬
  - `src/backend/services/channel-message-service.ts`
    - `ensureChannelCoordinator()` / `assignChannelCoordinator()` 추가
    - 사용자 채널 메시지에서 첫 멘션 멤버를 단일 coordinator로 승격
    - 멘션이 없을 때 coordinator가 비어 있으면 fallback으로 첫 멤버를 보장
    - `upsertChannelReadState(... isCoordinator=true)`도 단일 coordinator 보장을 타도록 수정
  - `src/backend/routes/channel-routes.ts`
    - coordinator 멤버 삭제 후 남은 멤버 중 fallback coordinator 자동 정리
  - `tests/e2e/electron.channel-metadata.spec.ts`
    - 수동 coordinator 승격 시 기존 coordinator 해제 회귀 추가
    - 먼저 join한 다른 멤버가 있어도 사용자 첫 멘션 멤버가 sole coordinator가 되는 회귀 추가
- 검증:
  - `npm run check`: 통과
  - `npm run build`: 통과
  - `npx playwright test tests/e2e/electron.channel-metadata.spec.ts`: 통과 (`11 passed`)

### 106) `CHANNEL_ACTION` 스키마 정리: 미사용 파라미터 제거
- 판단:
  - `type`, `target`, `artifact_path`는 실제 엔진에서 소비됨
  - `mode`, `question`, `deliver_to`는 현재 파싱만 하거나 테스트 보조 코드에만 남아 있고 실행 의미가 없음
- 수정:
  - `src/backend/services/channel-action-protocol.ts`
    - `mode`, `question`, `deliver_to` 제거
  - `src/backend/services/channel-message-service.ts`
    - report fallback에서 `deliver_to` 의존 제거
  - `src/backend/services/member-prompt.ts`
    - action example에서 `mode=blocking` 제거
  - `tests/e2e/fixtures/fake-codex.js`
    - ask_user/delegate 예시에서 불필요 파라미터 제거
  - `tests/e2e/support/channel-delegation-eval.ts`
    - 테스트용 action parser/interface도 동일 스키마로 정리

### 107) 불필요한 테트리스 산출물 정리
- 조사:
  - `src/renderer/tetris-rotation.ts`는 리포 내 어디에서도 import되지 않는 고립 파일이었음
  - 관련 문서는 `codexdocs/tetris-rotation-research-notes.md`에만 남아 있었고 제품 동작과 무관했음
- 정리:
  - `src/renderer/tetris-rotation.ts` 삭제
  - `codexdocs/tetris-rotation-research-notes.md` 삭제

- 2026-04-06: `src/renderer/tetris-rotation.ts` 생성 — `PieceState` 기준 회전 적용, 보드 경계/충돌 검사(`canPlacePiece`), wall-kick 후보 순회 포함 `tryRotatePiece` 구현.

- 2026-04-06: `src/renderer/tetris-rotation.ts`에 `applyRotation(board,state,direction)`를 추가해 회전 시도 결과(`RotationResult`)를 함께 반환하도록 확장해 블럭 회전 시스템 완결성을 높였습니다.

### 108) UX 조정: 메시지 종류 배지 숨김
- 사용자 요청:
  - 메시지 이름 옆 `HANDOFF`, `LIVE`, `RESULT` 배지를 숨김
- 조치 예정:
  - 렌더러 메시지 메타에서 종류 배지 DOM 생성 제거
  - 관련 CSS 정리
  - Playwright 스모크에 배지 미노출 회귀 추가
- 완료:
  - `src/renderer/renderer.ts`에서 메시지 종류 배지 DOM 생성 제거
  - `src/renderer/index.html`의 `.msg-kind` 스타일 제거
  - `tests/e2e/electron.smoke.spec.ts`에 배지 미노출 회귀 추가
  - `npm run verify` 통과

### 109) UX 버그 수정 진행: 에이전트 버블 테두리 불일치
- 사용자 이슈:
  - 어떤 멤버 버블은 테두리가 보이고, 어떤 멤버 버블은 테두리가 안 보임
- 원인 파악:
  - 렌더러 CSS에서 일반 `.msg-agent`는 투명 border를 사용하고, 스트리밍 중간 메시지인 `.msg.progress`만 별도 border-color를 가짐
- 조치 예정:
  - 에이전트 메시지 기본 스타일을 하나로 통일
  - 일반 응답/스트리밍 응답 border 일관성 회귀를 Playwright 스모크에 추가
- 완료:
  - `src/renderer/index.html`에서 `.msg-agent` 기본 background/border를 지정해 모든 에이전트 버블 스타일 통일
  - `.msg.progress`는 별도 강한 강조를 하지 않고 동일 border 계열만 유지
  - `tests/e2e/electron.smoke.spec.ts`에 일반 응답과 스트리밍 응답의 border 색상 일치 회귀 추가
  - `npm run verify` 통과

### 110) UX 버그 수정 착수: `CHANNEL_ACTION` 태그 디버그 모드에서만 표시
- 사용자 이슈:
  - 메시지 본문에 `[CHANNEL_ACTION] ... [/CHANNEL_ACTION]` 블록이 그대로 노출됨
- 조치 계획:
  - 앱 설정에 `debugMode` 플래그 추가
  - 설정 모달에서 디버그 모드 on/off 저장 가능하게 연결
  - 렌더러에서 디버그 모드가 꺼져 있으면 `CHANNEL_ACTION` 블록을 숨기고, 켜져 있으면 원문 그대로 표시
  - Playwright 설정/채널 회귀 추가
- 진행 업데이트:
  - `AppSettingsSnapshot/AppSettingsService`에 `debugMode` 플래그 및 저장 로직 추가
  - `PATCH /api/settings` 및 `PATCH /api/settings/debug-mode` 경로를 추가해 모델/디버그 설정을 함께 또는 개별 저장 가능하게 정리
  - 설정 모달에 디버그 상태 카드와 체크박스 토글을 추가
  - 렌더러 메시지 표시 단계에서 디버그 모드가 꺼져 있으면 `[CHANNEL_ACTION]` 블록을 제거하도록 변경
  - `tests/e2e/electron.settings.spec.ts`에 기본 숨김/켜면 표시/다시 끄면 숨김 회귀 추가
- 중간 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npx playwright test tests/e2e/electron.settings.spec.ts` 통과
- 최종 검증:
  - `npm run verify` 통과
  - 결과: Playwright 15 passed, real-codex 계열 2 skipped

### 111) 설정 UX 조정 착수: 디버그 모드 전용 탭 분리
- 사용자 요청:
  - 디버그 옵션을 `AI 모델` 탭 안에 두지 말고, `디버그 모드` 전용 탭에 배치
- 조치 계획:
  - 설정 모달 좌측 nav를 실제 탭 전환 구조로 변경
  - `AI 모델`과 `디버그 모드` 패널을 분리
  - 기존 저장 동작은 유지하되 E2E를 탭 전환 흐름에 맞춰 갱신
- 진행 업데이트:
  - 설정 nav에 `AI 모델`, `디버그 모드` 탭 버튼 추가
  - 모델 카드/셀렉트는 모델 패널에만 남기고, 액션 태그 표시 토글은 디버그 패널로 이동
  - 렌더러에 설정 탭 상태(`model/debug`)와 패널 표시 전환 로직 추가
  - `tests/e2e/electron.settings.spec.ts`를 탭 전환 흐름에 맞춰 수정
- 최종 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npx playwright test tests/e2e/electron.settings.spec.ts` 통과
  - `npm run verify` 통과
  - 결과: Playwright 15 passed, real-codex 계열 2 skipped

### 112) 채널 액션 프로토콜 안정화 착수: bracket block -> BEGIN/END sentinel
- 사용자 요청:
  - 가장 안정적인 방식으로 channel action 구분자를 교체
  - 파서와 디버그 모드 표시 옵션 문구도 함께 수정
- 조치 계획:
  - `CHANNEL_ACTION_BEGIN` / `CHANNEL_ACTION_END` 센티널로 프롬프트/fixture/테스트를 교체
  - 런타임 파서는 신규 형식을 우선 지원하고 기존 `[CHANNEL_ACTION]` 형식도 호환 처리
  - 렌더러 디버그 옵션 문구와 숨김 regex도 새 블록 명칭 기준으로 수정
- 진행 업데이트:
  - `member-prompt`의 채널 액션 예시와 규칙 문구를 `CHANNEL_ACTION_BEGIN/END` 기준으로 교체
  - `channel-action-protocol` 파서를 신규 센티널 우선 + legacy bracket 호환 형태로 확장
  - fake codex fixture와 delegation evaluation parser를 신규 형식에 맞게 수정
  - 렌더러 디버그 모드 안내 문구를 `액션 블록` 표현으로 정리하고 숨김 regex를 신규/legacy 겸용으로 변경
  - 설정 E2E 기대값을 `CHANNEL_ACTION_BEGIN` 기준으로 갱신
- 중간 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npx playwright test tests/e2e/electron.settings.spec.ts` 통과
- 최종 검증:
  - `npm run verify` 통과
  - 결과: Playwright 15 passed, real-codex 계열 2 skipped

### 113) 채널 전용 작업 디렉토리 도입 착수
- 사용자 요청:
  - 채널마다 독립적인 전용 디렉토리를 부여
  - 채널 작업은 해당 디렉토리 내부에서만 읽고 쓰도록 제한
- 조치 계획:
  - 채널별 workspace root를 앱 데이터 기준 `channel-workspaces/<channelId>`로 고정
  - 채널 실행 `cwd`와 prompt의 workspace 안내를 채널 전용 디렉토리로 전환
  - `artifact_path` 검증도 채널 디렉토리 내부 경로만 통과하게 강화
  - fake codex / Playwright 회귀로 채널 간 파일 격리 확인
- 진행 업데이트:
  - `ChannelWorkspaceService`를 추가해 채널별 디렉토리 생성/경로 검증을 공통화
  - 채널 생성 시 전용 디렉토리를 보장하고, 채널 멘션 실행은 해당 디렉토리를 `cwd`로 사용하도록 변경
  - worker `report`의 `artifact_path`는 채널 전용 디렉토리 내부의 실제 파일일 때만 유효하게 조정
  - channel prompt/system prompt에 채널 디렉토리 내부만 읽기/쓰기 하라는 규칙을 추가
  - fake codex가 채널 실행 시 현재 `cwd` 내부에 산출물을 쓰도록 수정하고, 채널별 파일 격리 시나리오를 추가
- 중간 검증:
  - `npm run check` 통과
  - `npx playwright test tests/e2e/electron.channel-metadata.spec.ts --grep "delegated code task continues only after worker reports an existing artifact path"` 통과
- 최종 검증:
  - `npm run verify` 통과
  - 결과: Playwright 17 passed, real-codex 계열 2 skipped

### 114) 채널별 사용자 지정 워크스페이스 필수화로 설계 전환
- 사용자 요청:
  - 채널 생성 시 워크스페이스를 직접 지정하게 변경
  - 워크스페이스 미지정이면 채널 생성 불가
  - 활성 채널끼리는 같은 워크스페이스를 공유하지 않도록 제한
- 조치 계획:
  - 채널 스키마/타입에 `workspace_path`를 정식 필드로 반영
  - 생성/수정 라우트에서 절대경로, 디렉토리, read/write 가능 여부, realpath 중복을 검증
  - 채널 모달에 워크스페이스 입력과 폴더 선택 버튼을 추가하고 인라인 오류로만 안내
  - Playwright/E2E를 새 필수 필드와 중복 워크스페이스 정책에 맞게 갱신
- 진행 업데이트:
  - `ChannelWorkspaceService`를 realpath 정규화/접근권한 검증 중심으로 재작성
  - 채널 repository/db에 `workspace_path` 저장과 활성 채널 기준 unique 검증을 추가
  - 채널 실행 `cwd`와 artifact 검증을 저장된 `workspacePath` 기준으로 연결
  - Electron main/preload/renderer에 디렉토리 picker IPC와 채널 모달 워크스페이스 입력 UI를 추가
  - `electron.smoke`, `electron.settings`, `electron.channel-metadata`, delegation eval helper를 새 workspace 필수 규칙에 맞춰 수정 중
  - 채널 모달은 브라우저 기본 `required` 팝업 대신 기존 인라인 오류를 쓰도록 `channel-form`을 `novalidate`로 전환
- 최종 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npx playwright test tests/e2e/electron.channel-metadata.spec.ts` 통과
  - `npx playwright test tests/e2e/electron.smoke.spec.ts` 통과
  - `npm run verify` 통과
  - 결과: Playwright 17 passed, real-codex 계열 2 skipped

### 115) 헤더 상단 Ready 상태 칩 제거
- 사용자 요청:
  - 상단의 `Ready (...)` 상태 버튼/칩은 DM과 채널 모두에서 불필요하므로 제거
- 조치 계획:
  - 헤더 `#status` 표시를 DOM/CSS에서 제거
  - 렌더러 상태 동기화는 타이핑 인디케이터만 갱신하도록 축소
  - Playwright 런처와 스모크 회귀를 `#status` 의존 없이 동작하도록 수정
- 진행 업데이트:
  - 헤더 우측에는 채널 멤버 버튼만 남기고 `#status` 마크업/CSS 제거
  - `setStatus`는 시각적 텍스트 갱신 대신 `renderTypingIndicator()`만 유지
  - Electron E2E 런처들은 초기 로드 완료를 Helper 멤버 표시 기준으로 대체
  - 스모크 테스트의 `Ready`/`Channel is working...` 단정은 타이핑 인디케이터 기준으로 정리
- 최종 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npx playwright test tests/e2e/electron.settings.spec.ts` 통과
  - `npm run verify` 통과
  - 결과: Playwright 17 passed, real-codex 계열 2 skipped

### 116) E2E 스위트 중복/저신호 단정 1차 정리
- 사용자 요청:
  - E2E 테스트를 리뷰하고 안 쓰거나 불필요한 것들을 정리
- 조치 계획:
  - 제품 회귀 가치가 낮은 표현/배치 의존 단정을 먼저 줄이고
  - 다른 spec이 이미 직접 검증하는 happy-path는 중복 제거
- 진행 업데이트:
  - `electron.settings.spec.ts`에서 문구 부재, top-right 버튼 부재, 옵션 순서/개수 같은 저신호 단정을 제거하고 모델 저장/재적용/실행 검증만 유지
  - `electron.settings.spec.ts`에서 초기 탭 active 상태와 패널 visible/hidden 같은 수동 UI 단정을 한 번 더 덜어내고, 실제 debug toggle 지속성과 메시지 노출 변화만 남김
  - `electron.smoke.spec.ts`에서 아카이브 후 동일 채널명 재생성 UI 흐름을 제거하고 create/edit/delete + 인라인 오류 + 멤버/메시지 흐름 검증에 집중
  - `electron.channel-metadata.spec.ts`에서 자연어 위임 happy-path를 제거하고, 전용 `electron.channel-delegation.spec.ts`가 해당 회귀를 대표하도록 정리
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과
  - 결과: Playwright 16 passed, real-codex 계열 2 skipped

### 117) API 중심 E2E의 Electron 창 의존 제거
- 사용자 요청:
  - API 테스트는 창 없이 돌릴 수 없나, 테스트할 때마다 창이 떴다 사라져서 거슬림
- 조치 계획:
  - backend 단독 child-process 하네스를 추가하고
  - API 위주 spec을 Electron launch 대신 backend base URL 직접 호출로 전환
- 진행 업데이트:
  - `src/backend/test-server-entry.ts` 추가로 compiled backend server를 테스트용 child process로 기동/종료할 수 있게 함
  - `tests/e2e/support/backend-harness.ts` 추가로 base URL 대기, 종료, 공통 API 호출 유틸을 묶음
  - `electron.channel-delegation*.spec.ts`와 `electron.channel-metadata.spec.ts`를 Electron window 대신 backend 하네스로 전환
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과
  - 결과: Playwright 16 passed, real-codex 계열 2 skipped, 전체 소요 43.2s

### 118) 메시지 자동 하단 스크롤 UX 개선 착수
- 사용자 요청:
  - 새 메시지가 생길 때마다 메시지 영역이 무조건 맨 아래로 내려가는 동작을 멈추고 싶음.
  - 사용자가 위쪽 메시지를 읽는 동안에는 현재 스크롤 위치를 유지하고, 새 메시지 도착 알림을 보여준 뒤 클릭 시에만 맨 아래로 이동하게 하고 싶음.
- 조사:
  - `src/renderer/renderer.ts`의 `renderMessages()`가 렌더링마다 `.messages-wrap.scrollTop = scrollHeight`를 강제로 적용하고 있었음.
  - DM 폴링 갱신과 채널 SSE delta 갱신 모두 최종적으로 같은 `renderMessages()`를 타므로, 스크롤 강제 이동이 DM/채널 공통 증상으로 재현되는 구조였음.
- 진행 업데이트:
  - 메시지 영역 하단에 `새 메시지 보기` 배지를 추가하고, 새 메시지가 온 동안 사용자가 아래쪽에 붙어 있지 않으면 배지만 노출하도록 변경.
  - 렌더러가 `현재 컨텍스트`, 하단 근접 여부, 마지막 비사용자 메시지 시그니처를 함께 추적해 새 agent/system 메시지 도착 시에만 배지를 띄우도록 정리.
  - 사용자가 직접 아래에서 벗어난 상태(`detached from bottom`)를 별도로 추적해, 중간 폴링/SSE 렌더가 와도 자동 하단 스크롤을 다시 켜지 않도록 보강.
  - 응답 완료 후 입력창 자동 포커스는 사용자가 위쪽 메시지를 읽는 중일 때는 생략하도록 조정해, 완료 시점에 스크롤이 다시 하단으로 끌려가지 않게 함.
  - 초기 구현에서는 배지를 `.messages-wrap` 안에 절대 배치했는데, 실제 사용 시 스크롤 영역 안으로 묻혀 보이지 않을 여지가 있어 입력창 바로 위 형제 레이어로 이동시킴.
  - `electron.smoke.spec.ts`에 긴 DM 히스토리 + 지연 응답 시나리오를 추가해 `스크롤 유지 -> 새 메시지 배지 노출 -> 클릭 후 하단 이동` 회귀를 검증.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과
  - 결과: Playwright 17 passed, real-codex 계열 2 skipped

### 119) 새 메시지 보기 배지 배경 투명도 조정 착수
- 사용자 요청:
  - `새 메시지 보기` 버튼 배경이 너무 불투명해 보여서 주변 메시지 레이어와 동떨어져 보임.
- 진행 업데이트:
  - `new-messages-btn` 배경 alpha를 낮추고 hover 배경도 반투명 계열로 맞춤.
  - `backdrop-filter`를 추가해 배지가 메시지 위에 얹힌 보조 레이어처럼 보이도록 조정.
  - 기존 scroll-indicator smoke에 computed background color alpha와 `backdrop-filter` 단정을 추가해 완전 불투명 회귀를 막음.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과
  - 결과: Playwright 17 passed, real-codex 계열 2 skipped

### 120) 새 메시지 배지 숨김 조건 조정 착수
- 사용자 요청:
  - `새 메시지 보기` 버튼 배경을 더 투명하게 만들고 싶음.
  - 새 메시지가 viewport에 보이기 시작하면 바로 버튼이 사라져야 하는데, 현재는 스크롤을 거의 맨 아래까지 내려야만 사라짐.
- 진행 업데이트:
  - `new-messages-btn` 배경 alpha를 더 낮춘 반투명 ghost chip 스타일로 조정하고, hover도 완전 불투명해지지 않도록 맞춤.
  - 렌더러에 `pendingNewMessageAnchorId`를 추가해 배지 표시 시 "이번에 새로 들어온 첫 메시지"를 anchor로 저장.
  - scroll sync는 `near bottom`만 보지 않고, 해당 anchor 메시지 element가 viewport에 보이는 순간 배지를 숨기도록 변경.
  - smoke는 1차 지연 응답에서 "맨 아래까지 내리지 않아도 anchor 메시지가 보이면 배지가 사라지는지"를 검증하고, 2차 지연 응답에서 버튼 클릭으로 맨 아래 이동하는 기존 흐름도 유지하도록 확장.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과
  - 결과: Playwright 17 passed, real-codex 계열 2 skipped

### 121) 새 메시지 배지 배경 완전 투명화 착수
- 사용자 요청:
  - `새 메시지 보기` 버튼은 반투명이 아니라 아예 투명한 배경이어야 함.
- 진행 업데이트:
  - 버튼 기본 배경과 hover 배경을 모두 `transparent`로 바꾸고, border/blur만 남겨 실제 배경 면은 완전히 제거.
  - smoke의 computed background 검증을 `transparent` 또는 alpha `0`만 통과하도록 강화.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과
  - 결과: Playwright 17 passed, real-codex 계열 2 skipped

### 122) 새 메시지 배지 잔여 불투명 효과 제거 착수
- 사용자 요청:
  - 배경이 여전히 불투명해 보이므로 상위 레이아웃까지 확인해서 완전히 투명하게 만들어야 함.
- 조사:
  - 배지는 `.messages-wrap`와 `.composer` 사이 형제 레이어였고, 부모 쪽 별도 배경은 없었음.
  - 실제 불투명하게 보이던 원인은 버튼의 `box-shadow`와 `backdrop-filter`가 남아 있어 frosted chip처럼 렌더되던 점이었음.
- 진행 업데이트:
  - `new-messages-btn`의 shadow와 blur 효과를 모두 제거해 배경면 없이 border/text만 남기는 투명 버튼으로 정리.
  - smoke에서 `backgroundColor` alpha `0`뿐 아니라 `backdropFilter === none`, `boxShadow === none`도 함께 확인하도록 보강.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과
  - 결과: Playwright 17 passed, real-codex 계열 2 skipped

### 123) 새 메시지 배지 오버레이 레이아웃 전환 착수
- 사용자 요청:
  - 버튼이 있는 영역 뒤로 메시지가 보여야 하는데, 현재는 별도 공간을 차지해 뒤가 비어 보임.
- 조사:
  - `new-messages-indicator`가 `.messages-wrap` 밖, `.composer` 위의 일반 흐름 블록으로 배치되어 있었음.
  - 그래서 배경이 투명해도 실제로는 메시지 위 오버레이가 아니라 레이아웃 중간 줄을 추가하는 구조였음.
- 진행 업데이트:
  - 메시지 영역과 배지를 `conversation-stage`로 묶고, 배지를 stage 내부의 absolute overlay로 옮겨 메시지 레이어 위에 겹치도록 변경.
  - smoke에 배지 rect가 `.messages-wrap` 내부 하단에 놓이는지 확인하는 단정을 추가해 다시 별도 줄로 내려가는 회귀를 막음.
  - 오버레이 구조와 무관한 smoke 플래키 포인트를 줄이기 위해 새 배지 테스트의 agent id 조회를 poll로 바꾸고, 멤버 중복 단계는 "중복 생성 방지" 중심으로 안정화.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과
  - 결과: Playwright 17 passed, real-codex 계열 2 skipped

### 124) 새 메시지 배지 버튼 표면 효과 복구
- 사용자 요청:
  - 배지 위치는 맞고, 이번에 잘못 제거한 버튼의 배경과 그림자 효과는 복구해야 함.
  - 이번 작업에서는 테스트 실행은 스킵.
- 진행 업데이트:
  - `new-messages-btn`의 반투명 배경, 그림자, blur 효과를 복구.
  - 오버레이 배치 구조(`conversation-stage` 내부 absolute overlay)는 그대로 유지.
- 검증:
  - 사용자 요청에 따라 테스트 실행 스킵

### 125) 새 메시지 배지 클릭 시 첫 새 메시지로 점프
- 사용자 요청:
  - `새 메시지 보기` 버튼을 눌렀을 때 맨 아래가 아니라 새 메시지들의 시작 지점으로 이동해야 함.
- 조사:
  - 렌더러는 이미 첫 새 메시지 anchor를 추적하고 있었지만, 클릭 핸들러는 이를 무시하고 항상 `scrollMessagesToBottom()`을 호출하고 있었음.
  - detached 상태에서 렌더 후 예약된 scroll restore가 클릭 직후 이동을 덮어쓸 수 있었고, pending/stream 메시지는 persisted id가 없어 anchor 식별이 비는 경우도 있었음.
- 진행 업데이트:
  - 버튼 클릭 시 pending anchor 메시지의 시작 위치로 스크롤하고, anchor가 없을 때만 맨 아래 fallback 하도록 조정.
  - 새 메시지 anchor는 `message id` 대신 현재 렌더 index도 함께 다뤄 pending/stream 메시지에서도 찾을 수 있게 보강.
  - 클릭/사용자 스크롤 전에는 pending scroll-restore RAF를 취소해 수동 이동이 다시 덮이지 않게 정리.
  - smoke는 버튼 클릭 후 "맨 아래 도달" 대신 "새 메시지 anchor의 시작 부분이 실제로 viewport 안에 보이는지"를 검증하도록 갱신.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과
  - 결과: Playwright 17 passed, real-codex 계열 2 skipped

### 126) 시스템 프롬프트 파일 외부화 착수
- 사용자 요청:
  - 코드 안에 하드코딩된 시스템 프롬프트들을 별도 파일로 분리하고, 앱 시작 시 로드해서 사용하고 싶음.
- 조사:
  - 실행용 멤버 시스템 프롬프트는 `src/backend/services/member-prompt.ts`에 긴 문자열로 하드코딩되어 있었음.
  - 시스템 프롬프트 생성용 user/system prompt는 `src/backend/routes/system-routes.ts`에 하드코딩되어 있었음.
  - 새 멤버 생성 시 기본 시스템 프롬프트는 `src/renderer/renderer.ts`에 하드코딩되어 있었음.
- 구현 계획:
  - backend startup에서 템플릿 파일을 읽는 prompt template service 추가
  - 실행용/생성용/기본 멤버 프롬프트를 텍스트 파일로 분리
  - renderer init 시 기본 멤버 프롬프트를 받아와 create modal에 주입
  - smoke에 startup-loaded prompt 반영 회귀 추가
- 진행 업데이트:
  - `src/backend/services/prompt-template-service.ts` 추가로 app startup 시 `src/backend/prompt-templates/*.md`를 로드하는 템플릿 서비스 도입.
  - 실행용 멤버 시스템 프롬프트, 채널 실행 규칙, 시스템 프롬프트 생성용 user/system prompt, 기본 멤버 프롬프트를 각각 별도 파일로 분리.
  - `startServer()`에 `appDir`를 추가해 runtime workspace와 템플릿 리소스 루트를 분리하고, DM/채널 실행 서비스와 system route가 공통 템플릿 서비스를 주입받도록 정리.
  - renderer는 init 시 `/api/system/prompt-templates`를 한 번 읽고, 새 멤버 create modal 기본 system prompt에 startup-loaded 값을 사용하도록 변경.
  - `electron.smoke.spec.ts`에 새 멤버 모달 기본 프롬프트가 startup-loaded 템플릿과 일치하는지 확인하는 회귀 추가.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과
  - 결과: Playwright 17 passed, real-codex 계열 2 skipped

### 127) evaluate-tool 구현 착수
- 사용자 요청:
  - `codexdocs/evaluate/evaluate-tool-spec.md`를 기반으로 headless evaluate-tool을 구현하고, 사용 방법 문서를 별도로 작성해야 함.
- 조사:
  - 기존 backend-only harness는 `tests/e2e/support/backend-harness.ts`에 있고, delegation 평가 루프는 `tests/e2e/support/channel-delegation-eval.ts`에 묶여 있음.
  - 현재 빌드는 root `tsconfig.json`이 `src/**`만 컴파일하므로 `tools/evaluator/**`를 위한 별도 TypeScript build 경로가 필요함.
- 구현 계획:
  - `tools/evaluator/` 아래에 CLI, scenario, scorer, reporter, runtime harness를 분리해서 추가
  - 기존 delegation 평가 로직을 evaluator 코드로 옮기고 Playwright는 그 shared evaluator를 재사용
  - baseline report 비교와 최종 decision 계산을 evaluator CLI에 포함
  - 사용 문서를 별도 `codexdocs/` 문서로 작성
- 진행 업데이트:
  - `package.json`에 `build:app`, `build:evaluator`, `check:app`, `check:evaluator`, `eval:prompt`를 추가해 evaluator가 루트 빌드/체크 체인에 포함되도록 정리.
  - `tools/evaluator/tsconfig.json` 추가로 `dist/tools/evaluator/` 빌드 경로를 신설.
  - `tools/evaluator/src/` 아래에 runtime backend harness, repo path resolver, delegation-basic scorer, baseline comparison/final decision, JSON/Markdown reporter, CLI 엔트리(`run.ts`)를 추가.
  - evaluator는 `dist/backend/test-server-entry.js`를 child process로 띄우고 backend API 계약을 재사용하는 구조로 구현.
  - delegation Playwright spec 2개는 새 evaluator shared code를 사용하도록 전환했고, evaluator CLI 자체를 검증하는 `tests/e2e/evaluator.cli.spec.ts`를 추가.
  - 기존 `tests/e2e/support/channel-delegation-eval.ts`는 제거.
- 중간 검증:
  - `npm run check` 통과
  - `npm run build` 통과
- 추가 진행:
  - `codexdocs/evaluate/evaluate-tool-usage.md` 추가로 fake/real 실행, baseline report 비교, output 구조, decision 해석, 현재 제약을 별도 사용 문서로 정리.
  - evaluator CLI는 `delegation-basic` scenario, fake/real codex 선택, baseline report 비교, final decision(`promote/hold/reject/investigate`) 계산, JSON/Markdown report 출력을 지원하게 구현.
  - `tests/e2e/evaluator.cli.spec.ts`에서 실제 CLI를 두 번 실행해 report artifact 생성과 baseline comparison 동작을 검증.
  - `tests/e2e/electron.channel-delegation*.spec.ts`는 shared evaluator 경로를 사용하도록 전환해 evaluator와 Playwright가 같은 시나리오/채점 로직을 재사용하게 정리.
- 최종 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과
  - 결과: Playwright `18 passed, 2 skipped`

### 128) evaluator real-only 정리 착수
- 사용자 요청:
  - evaluator는 프롬프트 하네스 엔지니어링 평가용이므로 fake Codex 평가는 user-facing 경로에서 불필요함.
- 조정 방향:
  - evaluator CLI와 관련 문서는 real Codex 전용으로 정리
  - fake 경로는 앱 회귀용 shared helper에만 내부적으로 남기고, evaluator 사용 문서/옵션에서는 제거
  - Playwright는 `fake 금지`와 `real opt-in 실행` 기준으로 재정리
- 진행 업데이트:
  - `tools/evaluator/src/run.ts`의 CLI 파서를 수정해 `--codex real`만 허용하고, `fake` 입력 시 명시적 에러로 종료하도록 변경.
  - `codexdocs/evaluate/evaluate-tool-spec.md`, `codexdocs/evaluate/evaluate-tool-usage.md`에서 fake evaluator 실행 예시와 설명을 제거하고, user-facing evaluator는 real Codex만 지원한다고 정리.
  - `tests/e2e/evaluator.cli.spec.ts`는 기본 회귀에서 `fake` 거부를 검증하고, 실제 evaluator 실행은 `VIBLACK_E2E_REAL_CODEX`가 있을 때만 opt-in으로 돌도록 재구성.
- 검증:
  - `npm run build` 통과
  - `npx playwright test tests/e2e/evaluator.cli.spec.ts` 통과
  - `npm run verify` 통과
  - 결과: Playwright `18 passed, 3 skipped`

### 129) 채널 멤버의 워킹 디렉토리 쓰기 작업 일반화 착수
- 사용자 요청:
  - 채널 내 멤버들이 워킹 디렉토리에 쓰기 작업을 할 수 있게 해야 함.
- 조사:
  - fake 회귀에서는 `FORCE_CHANNEL_FILE_WRITE`로 채널 멤버가 `cwd`(채널 workspace)에 직접 파일을 쓰는 경로가 이미 검증돼 있음.
  - 현재 제품 로직의 `requiresArtifactReport()`는 `Programmer/Developer` 계열 역할일 때만 파일 산출물 검증/강제 경로를 타고 있음.
  - 따라서 문서 작성, 리서치 정리, Markdown 초안 작성처럼 "비코드지만 파일 산출물이 필요한 작업"은 프롬프트/검증이 약해 실제 파일 생성 없이 텍스트 답변으로 끝나기 쉬운 구조임.
- 구현 계획:
  - artifact/report 강제 조건을 코드 역할 전용에서 "실제 파일 산출이 필요한 작업" 전반으로 일반화
  - 채널 프롬프트 문구도 코드 중심에서 파일 산출 중심으로 정리
  - 문서 작성 역할이 워크스페이스 파일을 생성하고 `artifact_path`로 보고하는 회귀를 추가
- 진행 업데이트:
  - `validateChannelCompletionReply()`가 worker `report`뿐 아니라 coordinator의 direct `final + artifact_path`도 파일 산출 완료 신호로 인정하도록 조정.
  - 첫 시도에서 coordinator의 초기 `delegate` 응답까지 artifact completion으로 오인해 막히는 회귀를 발견했고, `delegate/ask_user/noop`처럼 아직 완료 단계가 아닌 coordinator 제어 응답은 통과시키도록 보정.
  - 후속 검증에서 `sourceAgentId` 기준 때문에 coordinator가 worker 보고를 받아 `final`로 마무리하는 응답까지 worker로 오판하는 문제를 추가로 확인했고, 검증 기준을 `sourceAgentId` 대신 실제 coordinator 여부로 전환.
  - `requiresArtifactReport()`는 코드 역할 fallback을 유지하되, `workspace`, `markdown`, `파일`, 확장자 힌트 등 파일 산출 요청 문구가 있으면 역할과 무관하게 artifact 검증 경로를 타도록 일반화.
  - fake Codex에 `FORCE_DOC_ARTIFACT_SUCCESS:*` 시나리오를 추가해 채널 워크스페이스에 `.md` 파일을 실제 생성하고 `type=final`로 완료 보고하도록 확장.
  - 기존 code-artifact fake 성공 시나리오도 coordinator의 최종 `type=final`에 worker가 전달한 `artifact_path`를 다시 싣도록 맞춰 새 completion 규칙과 정합성을 맞춤.
  - `electron.channel-metadata` 스펙에 direct mention 문서 작성 회귀를 추가하고, 기존 실패 기대 문구도 `채널 파일 작업 미완료` 기준으로 갱신 중.
  - 전체 `verify` 중 `electron.smoke`에서 새 멤버 생성 직후 `/api/agents` lookup이 드물게 뒤 구두점이 붙은 표시명 때문에 흔들리는 것을 확인해, smoke 테스트의 agent ID 조회를 trailing punctuation 무시 방식으로 보강.

### 130) Codex app-server only 전환
- 사용자 요청:
  - 선택 모델이 있어도 `exec`로 우회하지 말고 `app-server`로 실행.
  - `exec` 경로와 fallback을 제거하고, 실패 시 앱에서 에러 메시지를 그대로 노출.
- 진행 업데이트:
  - `src/backend/codex.ts`에서 `runCodex()`의 `model -> exec` 분기와 app-server 실패 시 exec fallback 분기를 제거.
  - app-server 요청인 `thread/start`, `thread/resume`, `turn/start`에 모두 `model` 필드를 실어 선택 모델이 app-server 세션/턴 override로 전달되도록 조정.
  - fake app-server도 `params.model`과 thread state의 `requestedModel`을 읽어 `FORCE_ASSERT_MODEL` 검증이 app-server 경로에서 동작하도록 확장.
  - settings E2E는 선택 모델 저장 후 실제 응답이 해당 모델로 처리되는지, 그리고 런타임이 계속 `APP_SERVER_RUNTIME_OK`를 반환하는지 검증하도록 갱신.
- 검증:
  - `npm run check` 통과
  - `npx playwright test tests/e2e/electron.settings.spec.ts tests/e2e/electron.channel-delegation.spec.ts tests/e2e/electron.smoke.spec.ts` 통과
  - `npm run verify` 통과
  - 결과: Playwright `19 passed, 3 skipped`

### 131) app-server 유지 + 사용자 표시를 최종 응답 only로 회귀
- 사용자 요청:
  - app-server는 유지하되, AI 멤버 응답은 스트리밍처럼 점진적으로 보이지 말고 한 번에 도착해야 함.
- 조사:
  - 현재 app-server delta는 `src/backend/codex.ts`에서 계속 `onStream`으로 emit되고 있음.
  - 다만 실제 사용자 노출 여부는 `agent-execution-service` / `channel-message-service`가 non-completed stream을 저장하느냐에 달려 있음.
  - fake app-server는 `turn/completed` 직전에 `item/completed`를 먼저 보내므로, completed 이벤트를 즉시 렌더링하면 채널/DM 모두 최종 완료 전에 메시지 수가 먼저 증가함.
- 진행 업데이트:
  - 1차로 delta 표시만 끊었지만, smoke에서 channel 경로가 여전히 `item/completed` 시점에 한 박자 먼저 렌더링되는 회귀를 확인.
  - `agent-execution-service`와 `channel-message-service` 모두 completed agent message를 즉시 append/update하지 않고 메모리 버퍼에만 쌓도록 전환.
  - 실제 저장/노출은 `runCodex()`가 끝난 뒤에만 수행하고, 여러 completed agent message가 있으면 순서대로 append한 뒤 최종 reply와 마지막 completed 내용이 다를 때만 추가 메시지를 하나 더 append하도록 정리.
  - 이로써 app-server 스트림 자체는 유지하지만, 사용자 UI에는 turn 완료 후 최종 결과만 한 번에 나타나고, multi-completed message 회귀도 보존되는 구조로 맞춤.
  - smoke는 채널 타이핑 인디케이터 정리 타이밍과 분리해서, DM/채널 모두 중간 chunk가 실제 메시지로 노출되지 않고 최종 완료 텍스트만 남는지 검증하도록 기대값을 갱신.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npx playwright test tests/e2e/electron.smoke.spec.ts` 통과
  - `npm run verify` 통과
  - 결과: Playwright `19 passed, 3 skipped`

### 132) app-server write sandbox 누락으로 채널 파일 생성 실패 수정
- 사용자 이슈:
  - 채널에서 Markdown 산출물 생성을 요청했는데 에이전트가 `현재 실행 환경이 read-only라 파일 생성이 차단됐다`고 응답.
- 조사:
  - 실제 채널 메시지에 `read-only`, `cat > 거부`, `권한 허용 필요` 응답이 남아 있었음.
  - 현재 `src/backend/codex.ts`는 app-server를 `codex app-server --listen stdio://`로만 띄우고 있었고, CLI의 sandbox 모드 지정이 전혀 없었음.
  - 반면 fake-codex app-server payload는 `sandbox.mode = workspace-write`를 전제로 동작해서, 그동안 fake E2E가 실제 런타임 누락을 가려 왔음.
- 진행 업데이트:
  - real app-server spawn 인자를 `codex --sandbox workspace-write app-server --listen stdio://`로 변경.
  - fake-codex는 global CLI 옵션이 subcommand 앞에 와도 `app-server`/`exec`를 올바르게 해석하도록 argv 파서를 일반화.
  - fake 응답에 `FORCE_REQUIRE_WORKSPACE_WRITE_RUNTIME` 검증 토큰을 추가해, app-server가 실제로 `--sandbox workspace-write`로 떠 있는지 settings E2E에서 확인하도록 보강.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npx playwright test tests/e2e/electron.settings.spec.ts` 통과
  - `npm run verify` 통과
  - 결과: Playwright `19 passed, 3 skipped`

### 133) 파일 산출 작업에서 coordinator ask_user 회피 차단
- 사용자 이슈:
  - 실제 채널에서 문서 파일 생성 요청 시, 에이전트가 `read-only`, `권한 허용` 같은 문구와 함께 `type=ask_user`로 빠지며 작업을 끝내지 않음.
- 조사:
  - 현재 `validateChannelCompletionReply()`는 파일 산출 작업이어도 coordinator의 `ask_user` / `noop` control action을 정상 완료처럼 통과시키고 있었음.
  - 그래서 실제 artifact가 없어도 `ask_user` 응답이 result로 저장되어 사용자에게 그대로 노출될 수 있었음.
- 진행 업데이트:
  - 파일 산출 검증에서는 coordinator의 중간 제어 응답으로 `delegate`만 허용하고, `ask_user` / `noop`는 더 이상 완료로 인정하지 않도록 조정.
  - 멤버 프롬프트에도 채널 워크스페이스는 이미 쓰기 루트라고 명시하고, read-only/권한 요청 핑계 대신 실제 파일 생성 후 completion action으로만 마무리하라고 강화.
  - fake-codex에 `FORCE_DOC_ARTIFACT_ASK_USER` 시나리오를 추가해, direct document task가 `ask_user`로 빠질 때 job이 실패하고 시스템 오류로 승격되는 회귀를 추가.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npx playwright test tests/e2e/electron.channel-metadata.spec.ts` 통과
  - `npm run verify` 통과
  - 결과: Playwright `20 passed, 3 skipped`

### 134) workspace별 app-server 분리로 채널 간 파일 쓰기 루트 고정 문제 수정
- 사용자 이슈:
  - `v4` 채널에서 한 번 작업한 뒤 `v5` 같은 다른 워크스페이스 채널에서 계속 `read-only`, `쓰기 권한 허용` 응답이 반복됨.
- 조사:
  - 실제 실행 중인 app-server 프로세스는 `--sandbox workspace-write`로 뜨고 있었지만, 프로세스 cwd가 `/Users/minseoi/Desktop/test/v4`로 고정돼 있었음.
  - 현재 구현은 global singleton app-server client 하나를 모든 DM/채널에서 재사용하고 있었음.
  - Codex CLI의 workspace-write sandbox는 thread `cwd`보다 app-server 프로세스의 workspace root 영향을 받는 것으로 보였고, 그래서 첫 채널(root=v4) 이후 다른 채널(root=v5) 파일 쓰기가 막히는 구조였음.
- 진행 업데이트:
  - `src/backend/codex.ts`의 app-server client를 singleton에서 `workspace root -> client` 맵으로 전환해, 각 워크스페이스마다 별도 app-server 프로세스를 유지하도록 조정.
  - 종료 시에도 모든 workspace별 app-server를 순회하며 함께 shutdown 하도록 정리.
  - app-server protocol 생성 타입을 다시 확인한 결과, real Codex는 CLI 인자만으로는 충분하지 않았고 `thread/start|resume`의 `sandbox: "workspace-write"`, `turn/start`의 `sandboxPolicy: { type: "workspaceWrite", writableRoots: [...] }`까지 함께 보내야 실제 쓰기 세션으로 열렸음.
  - 그래서 `src/backend/codex.ts`에 thread/turn sandbox override를 추가하고, fake-codex도 session sandbox mode + writableRoots를 실제로 검사하도록 보강.
  - fake-codex도 app-server 프로세스의 `process.cwd()` 밖 워크스페이스에 대해서는 파일 생성/문서 artifact 쓰기를 `read-only`처럼 실패시키도록 바꿔, 이 버그를 테스트에서 재현 가능하게 만듦.
  - channel workspace isolation E2E를 확장해 첫 채널 write 후 두 번째 채널에서도 별도 write가 실제로 성공하는지까지 검증하도록 보강.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npx playwright test tests/e2e/electron.channel-metadata.spec.ts` 통과
  - `npm run verify` 통과
  - 결과: Playwright `20 passed, 3 skipped`
  - real Codex 채널 probe(`.tmp_probe_app_server.js`)로 서로 다른 두 workspace에서 sequential markdown 파일 생성까지 직접 확인:
    - workspace A: `real-a.md` 생성 성공, 내용 `alpha`
    - workspace B: `real-b.md` 생성 성공, 내용 `beta`

### 135) 채널 Codex turn timeout 상향
- 사용자 이슈:
  - `codex app-server turn timed out`가 최신성 조사/긴 문서 작업에서 자주 발생했고, 최근 실측도 1회 시도 한도를 넘긴 뒤 재시도까지 겹쳐 약 4분 후 실패로 끝남.
- 조사:
  - 채널 실행은 `timeoutMs: 120_000`으로 고정되어 있었음.
  - app-server 경로는 transient retry 1회가 있어, 한 번 timeout이 나면 체감 실패 시간이 더 길어질 수 있음.
- 진행 업데이트:
  - 채널 멘션 실행 timeout을 `120_000ms -> 300_000ms`로 상향.
  - real delegation Playwright/evaluator도 장기 채널 작업을 조기 stall로 오판하지 않도록 settle timeout과 `maxRunningMs` 기본값을 함께 상향.
- 검증:
  - `npm run check` 통과
  - `npm run build` 통과
  - `npm run verify` 통과
  - 결과: Playwright `20 passed, 3 skipped`

### 86) 진행: 이름 기반 아바타 색상 구분 개선 착수
- 사용자 이슈: 멤버 이름이 달라도 프로필 이미지 배경색이 거의 같아 구분이 어렵다.
- 조사: 렌더러 아바타 색상 seed가 주로 agent.id를 사용하며, DB agent id가 연속 숫자 문자열이라 해시 hue도 연속되어 색 차이가 작게 보일 수 있다.
- 방향: agent 아바타 색상 seed를 표시 이름 기반으로 정규화하고, 해시 혼합을 강화해 비슷한 이름/연속 숫자에서도 색상 차이가 나도록 수정한다.
- 구현:
  - `src/renderer/renderer.ts`의 agent 아바타 seed를 `agent.id` 중심에서 정규화된 표시 이름 중심으로 변경.
  - 연속 숫자 ID/비슷한 문자열에서도 hue가 붙지 않도록 해시 혼합을 FNV 기반으로 강화.
  - 멤버 목록, 헤더, 메시지, typing avatar가 동일한 이름 seed를 사용하도록 정리.
- 테스트:
  - `tests/e2e/electron.smoke.spec.ts`에 서로 다른 멤버 이름의 아바타 배경색 차이와 이름 변경 후 배경색 갱신 단정을 추가.
- 검증:
  - `npm run check` 통과
  - `npm run verify` 통과
  - 결과: Playwright `20 passed, 3 skipped`
