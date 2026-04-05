# Channel Delegation Eval Loop

## Goal

실제 Codex 기반 채널 협업에서 아래 사용자 요청이 안정적으로 성공하도록 만든다.

```text
@영희 인스타 맛집 계정 운영을 시작하는 사람에게 줄 가이드 문서를 만들어야 해.
존한테 조사 시키고 그거를 매튜한테 문서 만들게 시킨 다음에 나한테 알려줘
```

목표 성공 조건:

1. 사용자 최초 요청은 `영희`가 조율자로 수신한다.
2. `영희`는 먼저 `존`에게 조사 작업을 위임한다.
3. `존`의 조사 결과가 공개 채널에 보고된다.
4. 그 다음 `매튜`가 조사 결과를 바탕으로 문서 초안을 작성한다.
5. `영희`가 최종 내용을 취합해 사용자에게 작업 완료를 보고한다.
6. 불필요한 핑퐁 재멘션, 실행 예산 소진, 내부 추정 확정이 없어야 한다.

## Evaluation Harness

평가 하네스는 두 층으로 운영한다.

1. Real Codex evaluation:
   - 실제 Codex CLI를 사용해 Electron 앱을 띄우고 API로 시나리오를 실행한다.
   - 대화 transcript, execution jobs, 평가 점수, 실패 원인을 artifact로 저장한다.
2. Fake Codex regression:
   - 결정론적 fixture를 사용해 새로운 협업 오케스트레이션 규칙을 빠르게 회귀 검증한다.
   - `npm run verify`에 포함될 수 있는 안정적인 Playwright E2E로 유지한다.

## Scoring Rubric

총점 100점.

- 20점: 최초 사용자 멘션이 올바른 coordinator에게 전달됨
- 20점: 연구 단계가 문서화 단계보다 먼저 진행됨
- 15점: 조사 담당자 결과가 공개 채널에 반환됨
- 15점: 문서 담당자가 조사 결과를 반영한 산출물을 생성함
- 20점: coordinator가 사용자에게 최종 완료 보고를 남김
- 10점: 루프/예산 소진/불필요한 재멘션 없이 종료됨

실패 판정 예시:

- 조사 전에 문서화가 시작됨
- worker가 사용자 질문을 대체로 추정 확정함
- 보고/승인 멘션이 자동 실행으로 이어져 루프가 남
- 시스템 메시지로 멘션 실행 예산 소진이 발생함

## Iteration Loop

1. 평가 하네스를 실행한다.
2. transcript와 jobs를 바탕으로 점수와 원인을 기록한다.
3. 문제 원인을 코드/프롬프트/정책 레벨로 분해한다.
4. 수정안을 구현한다.
5. fake regression + real evaluation을 다시 실행한다.
6. 목표 성공 조건을 만족할 때까지 반복한다.

## Working Notes

### 2026-04-05

- 작업 시작.
- 기존 구조는 `plain mention -> immediate execution` 기반이며, 에이전트 응답의 재멘션도 그대로 후속 실행된다.
- 이번 루프에서는 자연어 멘션과 실제 실행을 분리하는 방향, coordinator 중심 제어, `ask_user/report/final` 비자동 실행 경계 도입을 우선 검토한다.
- real Codex baseline 1회 측정 완료.
- baseline 결과:
  - score: `40/100`
  - 초기 흐름은 좋았음: `영희 -> 존` 순차 위임까지는 성공.
  - 실패 지점: `존`의 공개 응답 안에 `@영희에게`가 있었지만, 현재 멘션 파서가 한국어 조사 결합형 멘션을 파싱하지 못해 coordinator 재진입이 발생하지 않음.
  - 결과적으로 `매튜` 단계와 최종 사용자 보고가 아예 시작되지 않음.
- 수정 우선순위:
  1. 자연어 멘션 fallback을 보강: `@영희에게`, `@매튜한테` 같은 조사 결합형 멘션 인식
  2. 에이전트용 구조화된 channel action 프로토콜 도입
  3. coordinator / worker 역할을 프롬프트에 명시하고, `delegate -> report -> delegate -> report -> final` 흐름을 강제

### Iteration 1

- 구현:
  - `CHANNEL_ACTION` 프로토콜 추가: `delegate`, `report`, `ask_user`, `final`, `noop`
  - 채널 프롬프트에 coordinator/worker 모드와 순차 위임 규칙 추가
  - 후속 실행은 본문 멘션이 아니라 action block 우선 해석으로 변경
  - 자연어 fallback 멘션 파서에 조사 결합형(`에게`, `한테` 등) 지원 추가
  - fake-codex fixture에 결정론적 delegation scenario와 generic action-protocol 위임 흐름 추가
- 중간 real evaluation:
  - 초기 프로토콜 도입 직후 일부 real run에서 빈 응답/불안정성이 있어 prompt를 더 좁게 조정함
  - 평가용 agent prompt를 coordinator/researcher/writer 책임이 더 분명하도록 보강
- 결과:
  - 최신 real Codex 평가 점수: `100/100`
  - verdict: `pass`
  - 실제 job 순서: `영희 -> 존 -> 영희 -> 매튜 -> 영희`
  - 최종 단계에서 `영희`가 `type=final`로 사용자 전달 완료

### Regression Repair

- `npm run verify` 첫 전체 실행에서 기존 메타데이터 회귀 2건이 실패함
  - `natural language delegation request becomes channel mention chain`
  - `ambiguous delegated task triggers clarification mention back to requester`
- 원인:
  - fake-codex generic delegation fixture가 예전 "exact mention rule"만 이해하고 새 `CHANNEL_ACTION` 프로토콜을 따르지 못했음
- 조치:
  - generic delegation fixture도 action protocol을 인식하도록 수정
  - worker 결과 보고는 `type=report`, coordinator 최종 응답은 `type=final`, 모호성 회신은 `type=ask_user`로 맞춤
- 결과:
  - 위 2개 회귀 복구
  - `npm run verify` 최종 통과

### Iteration 2

- 추가 관찰:
  - real Codex 재평가 중 `매튜` 턴에서 간헐적으로 `empty response from codex`가 발생했고, 또 다른 실행에서는 renderer window가 닫히며 평가 하네스가 `page.evaluate` 단계에서 끊겼다.
  - 즉 오케스트레이션 자체는 맞아도, 실제 런타임/하네스 레벨 복원력이 부족했다.
- 수정:
  - `src/backend/codex.ts`
    - 성공 응답이지만 본문이 빈 경우 1회 재시도
    - 재시도 시 획득한 `sessionId`를 다음 시도에 이어받아 채널 맥락 유지
  - `tests/e2e/fixtures/fake-codex.js`
    - `FORCE_EMPTY_SUCCESS_ONCE` 추가
  - `tests/e2e/electron.channel-metadata.spec.ts`
    - 채널 실행이 빈 성공 응답 1회 후 재시도로 복구되는 회귀 추가
  - `tests/e2e/support/channel-delegation-eval.ts`
    - 평가 하네스 API 호출을 renderer `page.evaluate` 의존에서 `backendBaseUrl + fetch` 기반으로 변경
    - 렌더러 창이 닫혀도 백엔드가 살아 있으면 transcript/job 수집 계속 가능
  - `src/main.ts`
    - 평가 모드(`VIBLACK_KEEP_ALIVE_WITHOUT_WINDOW=1`)에서는 `window-all-closed` 후에도 즉시 앱을 내리지 않도록 조정
- 결과:
  - real Codex 평가 재실행: `100/100`, `pass`
  - artifact:
    - `test-results/electron.channel-delegatio-dc6fc-annel-delegation-evaluation/channel-delegation-real-report.json`
    - `test-results/electron.channel-delegatio-dc6fc-annel-delegation-evaluation/channel-delegation-real-report.md`
  - 실제 job 순서 재확인: `영희 -> 존 -> 영희 -> 매튜 -> 영희`

## Final Status

- fake regression: 통과
- real Codex evaluation: `100/100`, pass
- full verify: `11 passed, 2 skipped`
- 현재 기준으로 목표 시나리오는 "coordinator 순차 위임 -> worker 공개 보고 -> coordinator 최종 완료 보고" 흐름으로 안정화됨
