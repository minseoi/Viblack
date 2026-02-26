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
