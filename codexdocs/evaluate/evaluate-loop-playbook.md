# Prompt Engineering Feedback Loop Playbook

## 목적

이 문서는 Viblack의 `evaluate-tool`을 사용해 AI가 프롬프트를 반복 개선할 때, `점수`가 아니라 `현재 개선 포인트`와 `직전 실행 대비 better/worse`를 기준으로 안정적으로 루프를 돌리기 위한 운영 문서다.

이 문서는 다음 상황을 전제로 한다.

- 평가 도구는 [evaluate-tool-usage.md](/Users/minseoi/dev/Viblack/codexdocs/evaluate/evaluate-tool-usage.md)에 정의된 real Codex 기반 headless evaluator다.
- AI는 제품 코드 전체를 뒤엎는 것이 아니라, 프롬프트 템플릿을 중심으로 반복 개선을 수행한다.
- 최종 승격 결정은 사람이 할 수 있지만, 반복 실험과 1차 판단은 AI가 대신 수행한다.

## 이 루프의 기본 생각

- 첫 실행은 `현재 상태 점검`이다.
- 두 번째 실행부터는 `직전 실행과 비교`한다.
- evaluator는 숫자 점수 대신 아래를 만든다.
  - 현재 실행의 `feedback`
  - 직전 실행 대비 `previousRunComparison`
- 따라서 이 루프의 핵심 질문은 아래 두 개다.
  - 지금 실행에서 고쳐야 할 행동은 무엇인가
  - 직전 실행보다 좋아졌는가, 나빠졌는가

## 포함 범위

- `src/backend/prompt-templates/*.md` 개선
- evaluator report 해석
- 직전 실행 대비 개선/퇴보 판단
- 효율성 악화 여부 판단
- 다음 프롬프트 수정 제안
- 반복 실험 로그 정리

## 제외 범위

- Electron UI 개선
- backend 로직 리팩터링
- DB schema 변경
- 채널 프로토콜 자체 변경
- evaluator 코드 변경

위 항목이 필요해 보이면 AI는 프롬프트 엔지니어링 범위를 벗어난 것으로 판단하고 사람에게 에스컬레이션해야 한다.

## 핵심 원칙

### 1. real Codex만 사용한다

이 루프에서 evaluator는 실제 Codex CLI 결과만 신뢰한다. fake fixture는 제품 회귀 테스트용이다.

### 2. 비교 기준은 `직전 실행 report`다

같은 개선 축 안에서는 비교 기준을 계속 바꾸지 않는다.

- 첫 실행 report를 만든다.
- 수정 후에는 그 report를 `--previous-report`로 넘긴다.
- 진전이 있으면 새 report를 다음 iteration의 비교 기준으로 삼는다.

즉, 필요한 것은 `baseline score`가 아니라 `이전 실행 스냅샷`이다.

### 3. 한 번에 하나의 가설만 검증한다

한 iteration에서 여러 문제를 동시에 고치지 않는다.

좋은 가설 예시:

- worker가 불필요한 progress를 너무 많이 내는 것은 진행 보고 제한 규칙이 약해서다.
- 문서 작업인데 `codexdocs/` 탐색을 드러내는 것은 task-focused reporting 규칙이 약해서다.
- coordinator final 보고가 장황한 것은 최종 보고 형식 제약이 약해서다.

나쁜 가설 예시:

- 전체적으로 다 부족하니 prompt를 전면 재작성하자.

### 4. 제품 코드와 프롬프트 코드를 섞지 않는다

기본적으로 AI는 아래 파일만 수정해야 한다.

- `src/backend/prompt-templates/member-execution-system-prompt.md`
- `src/backend/prompt-templates/member-execution-channel-rules.md`
- `src/backend/prompt-templates/system-prompt-generation-user.md`
- `src/backend/prompt-templates/system-prompt-generation-system.md`
- `src/backend/prompt-templates/default-member-system-prompt.md`

실행 품질 개선 루프에서는 대체로 앞의 두 파일만 다룬다.

### 5. hard gate와 개선 포인트를 분리해서 본다

항상 아래 순서로 읽는다.

1. `report.hardGates`
2. `feedback.improvementAreas`
3. `feedback.nextPromptChanges`
4. `previousRunComparison`
5. `report.transcript`

### 6. 실험은 별도 브랜치에서 진행한다

- 프롬프트 엔지니어링 전용 별도 브랜치에서 시작한다
- 한 실험 루프 안에서는 같은 브랜치를 유지한다
- 문제 축을 바꿀 때만 새 브랜치로 넘어간다

### 7. 하나의 진전이 생기면 바로 커밋한다

AI는 여러 iteration을 워킹트리에 쌓아두지 않는다.

다음 중 하나가 발생하면 즉시 커밋한다.

- hard gate 하나를 복구함
- `previousRunComparison.verdict=better`
- `mixed`이지만 이번 가설의 핵심 regressions 없이 목표 문제를 줄였음
- 다음 비교 기준점으로 삼을 가치가 있는 안정된 변화가 생김

## 사전 준비

### 1. 첫 report 만들기

```bash
npm run eval:prompt -- \
  --scenario delegation-basic \
  --codex real \
  --output-dir ./eval-results/run-01
```

### 2. 실험 대상 템플릿 확인

실행 품질 loop라면 보통 아래 두 파일이 주 대상이다.

- `src/backend/prompt-templates/member-execution-system-prompt.md`
- `src/backend/prompt-templates/member-execution-channel-rules.md`

### 3. 동일 조건 유지

반복 동안 아래는 고정한다.

- evaluator scenario
- runtime (`exec` 또는 `app-server`)
- 평가 머신

## 표준 반복 절차

### Step 1. 직전 report 읽기

첫 iteration이면 방금 만든 `run-01`을 읽고, 이후 iteration이면 가장 최근 비교 기준 report를 읽는다.

우선순위:

1. `report.hardGates`
2. `feedback.improvementAreas`
3. `feedback.nextPromptChanges`
4. `report.transcript`

### Step 2. 이번 loop의 단일 가설 정하기

한 iteration에서 다음 중 하나만 선택한다.

- 역할/우선순위 규칙 강화
- 위임 순서 규칙 강화
- 질문 최소화 규칙 강화
- progress 보고 축소
- 결과 보고의 task focus 강화
- final report 형식 강화

### Step 3. 수정 범위 최소화

- 가능하면 한 템플릿 파일 안에서 끝낸다
- 꼭 필요할 때만 두 파일까지 허용한다
- unrelated prompt 수정은 섞지 않는다

### Step 4. prompt 수정

수정 시 아래를 반드시 지킨다.

- placeholder를 깨지 않는다
- 기존 정책과 정면 충돌하는 문구를 넣지 않는다
- 지나치게 장문 규칙을 늘리지 않는다
- 한 번에 여러 행동을 과잉 강제하지 않는다

### Step 5. evaluator 재실행

수정 후에는 직전 report와 비교하며 다시 실행한다.

```bash
npm run eval:prompt -- \
  --scenario delegation-basic \
  --codex real \
  --previous-report ./eval-results/run-01/delegation-basic.report.json \
  --output-dir ./eval-results/run-02
```

### Step 6. 결과 판독

AI는 결과를 아래 순서로 읽는다.

1. hard gate 실패/복구 여부
2. 현재 `feedback.improvementAreas`
3. `previousRunComparison.verdict`
4. `previousRunComparison.improvements`
5. `previousRunComparison.regressions`
6. transcript 기준 실제 행동 변화

### Step 7. iteration 결론 쓰기

각 loop 끝에서 AI는 아래 5가지를 짧게 남긴다.

- 무엇을 바꿨는지
- 어떤 가설을 검증했는지
- 현재 개선 포인트가 무엇인지
- 직전 실행 대비 무엇이 좋아졌고 무엇이 나빠졌는지
- 다음 loop에서 무엇을 할지

반드시 출력할 항목:

- 이번 가설
- 수정한 파일
- current feedback
- previous run 비교
- 실제 행동 변화
- 다음 액션

### Step 8. 진전 여부 판단 후 커밋

아래를 확인한다.

- hard gate 복구가 있었는가
- `better`가 나왔는가
- `mixed`여도 이번 가설의 핵심 regressions 없이 목표 문제가 줄었는가

`예`면:

1. 현재 변경을 커밋한다
2. 그 커밋의 report를 다음 loop의 비교 기준으로 삼는다
3. 다음 가설로 넘어간다

`아니오`면:

- 커밋하지 말고 같은 브랜치에서 다음 수정 가설로 이어간다
- 단, 3회 연속 의미 있는 진전이 없으면 중단 조건을 적용한다

## Comparison Verdict 해석과 다음 액션

### `better`

의미:

- 직전 실행 대비 개선만 확인됨

다음 액션:

- 현재 결과를 다음 비교 기준으로 채택
- 같은 문제 축에 대한 과최적화는 중단 검토

### `same`

의미:

- 큰 변화가 없음

다음 액션:

- 같은 축에서 더 작은 수정 한 번 더 시도
- 또는 가설 자체를 바꿀지 검토

### `worse`

의미:

- 직전 실행 대비 퇴보만 확인됨

다음 액션:

- 직전 수정 가설을 폐기
- 직전 안정 버전 기준으로 다시 시도

### `mixed`

의미:

- 개선과 퇴보가 함께 존재함

다음 액션:

- regressions가 현재 가설의 부작용인지 본다
- 개선이 regressions보다 중요한지 판단한다
- 애매하면 더 작은 수정으로 다시 시도한다

### `uncomparable`

의미:

- scenario나 report 구조가 달라 직접 비교가 성립하지 않음

다음 액션:

- 비교 기준 report를 다시 선택한다

## 중단 조건

아래 중 하나가 발생하면 반복을 중단하고 사람에게 보고해야 한다.

- 같은 문제 축에서 3회 연속 의미 있는 진전이 없음
- hard gate 실패 원인이 prompt가 아니라 runtime/infra 문제로 보임
- transcript와 evaluator 기준이 계속 모순돼 원인 해석이 불명확함
- 수정 범위가 prompt template을 넘어 backend 정책 변경으로 번짐

## AI가 따라야 하는 작업 규칙

### 수정 전에

- 직전 report를 먼저 읽는다
- 현재 템플릿 전문을 읽는다
- 이번 loop의 단일 가설을 명시한다
- 현재 작업 브랜치가 실험 브랜치인지 확인한다

### 수정 중

- 최소 diff만 만든다
- 같은 iteration에서 unrelated prompt를 건드리지 않는다
- 문구를 늘리기보다 행동 제약을 명확히 한다

### 수정 후

- evaluator를 반드시 다시 돌린다
- `feedback`과 `transcript`를 함께 확인한다
- "왜 좋아졌는지" 또는 "왜 나빠졌는지"를 행동 기준으로 설명한다
- 진전이 있으면 바로 커밋한다

## 권장 iteration 보고 포맷

```md
## Iteration N

- Hypothesis:
- Edited files:
- Current feedback:
- Previous run comparison:
- Observed behavior change:
- Next action:
- Commit needed:
- Commit message:
```

`Commit needed`는 `yes` 또는 `no`로 적는다.

## 권장 디렉토리 운영

```text
eval-results/
  run-01/
    delegation-basic.report.json
    delegation-basic.report.md
  run-02/
    delegation-basic.report.json
    delegation-basic.report.md
  run-03/
    delegation-basic.report.json
    delegation-basic.report.md
```

필요하면 별도 메모 파일을 둔다.

```text
eval-results/
  notes/
    delegation-basic-loop.md
```

## AI에게 직접 줄 작업 지시문 템플릿

```text
너는 Viblack의 prompt engineer다.

목표:
- evaluate-tool report를 읽고
- 현재 개선 포인트를 기준으로 prompt 수정안을 만들고
- real Codex evaluator를 다시 실행한 뒤
- 직전 실행 대비 무엇이 좋아졌고 나빠졌는지 비교하고
- 다음 수정 방향을 제안하라.

작업 규칙:
- real Codex evaluator만 사용한다.
- 한 iteration에 하나의 가설만 검증한다.
- 기본적으로 prompt template 파일만 수정한다.
- 비교 기준은 직전 report다.
- 점수로 판단하지 않는다.
- hard gate, feedback, previousRunComparison, transcript를 함께 본다.
- 같은 문제 축에서 3회 연속 진전이 없으면 에스컬레이션한다.
- 하나의 진전이 생기면 바로 커밋한다.

우선순위:
1. hard gate 복구
2. 구조적 규칙 준수
3. 품질 개선
4. 효율성 유지 또는 개선

반드시 출력할 것:
- 이번 가설
- 수정한 파일
- current feedback
- previous run comparison
- 실제 행동 변화
- 다음 액션
- 커밋 필요 여부
- 커밋 메시지
```

## 좋은 loop의 기준

좋은 루프는 아래 특징을 가진다.

- 매 iteration의 목적이 분명하다
- 수정 범위가 작다
- evaluator 결과로 판단한다
- transcript로 실제 행동 변화를 확인한다
- 다음 수정 방향이 이전 결과에서 직접 나온다

나쁜 루프는 아래 특징을 가진다.

- 결과가 애매한데 계속 전면 수정한다
- 점수만 높다고 성공이라고 선언한다
- 현재 개선 포인트를 못 읽고 규칙 문구만 계속 늘린다
- regressions가 생겼는데 무시한다

## 운영 권장 순서

1. 첫 report 생성
2. AI에게 단일 가설 기반 수정 지시
3. evaluator 재실행
4. current feedback / previous run comparison 읽기
5. 필요 시 다음 iteration
6. 충분히 좋아졌으면 사람 승인 후 종료

이 문서의 목적은 AI가 evaluator를 "한 번 실행하는 도구"가 아니라, 지속적 개선을 위한 판단 루프의 일부로 사용하게 만드는 것이다.
