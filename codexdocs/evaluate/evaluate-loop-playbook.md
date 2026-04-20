# Prompt Engineering Feedback Loop Playbook

## 목적

이 문서는 Viblack의 `evaluate-tool`을 사용해 AI가 스스로 프롬프트 엔지니어링을 수행하고, 평가 결과를 읽고, 다음 수정을 제안하고, 다시 평가하는 반복 루프를 안정적으로 수행하도록 하기 위한 운영 문서다.

이 문서는 다음 상황을 전제로 한다.

- 평가 도구는 [evaluate-tool-usage.md](/Users/minseoi/dev/Viblack/codexdocs/evaluate/evaluate-tool-usage.md)에 정의된 real Codex 기반 headless evaluator다.
- AI는 제품 코드 전체를 무분별하게 수정하는 것이 아니라, 프롬프트 템플릿과 그 주변의 평가용 메모를 중심으로 반복 개선을 수행한다.
- 최종 승격 결정은 사람이 할 수 있지만, 반복 실험과 1차 판단은 AI가 대신 수행한다.

## 이 루프가 다루는 범위

### 포함

- `src/backend/prompt-templates/*.md` 개선
- evaluator report 해석
- baseline 대비 개선 여부 판단
- 효율성 악화 여부 판단
- 다음 프롬프트 수정 제안
- 반복 실험 로그 정리

### 제외

- Electron UI 개선
- backend 로직 리팩터링
- DB schema 변경
- 채널 프로토콜 자체 변경
- evaluator 코드 변경

위 항목이 필요해 보이면 AI는 프롬프트 엔지니어링 범위를 벗어난 것으로 판단하고 사람에게 에스컬레이션해야 한다.

## 핵심 원칙

### 1. real Codex만 사용한다

이 루프에서 evaluator는 실제 Codex CLI 결과만 신뢰한다. fake fixture는 제품 회귀 테스트용이며, 프롬프트 엔지니어링 loop의 판단 근거로 쓰지 않는다.

### 2. 한 번에 하나의 가설만 검증한다

한 iteration에서 여러 문제를 동시에 고치지 않는다.  
각 loop는 `하나의 실패 원인 또는 하나의 효율 저하 원인`만 대상으로 삼는다.

### 3. 제품 코드와 프롬프트 코드를 섞지 않는다

기본적으로 AI는 아래 파일만 수정해야 한다.

- `src/backend/prompt-templates/member-execution-system-prompt.md`
- `src/backend/prompt-templates/member-execution-channel-rules.md`
- `src/backend/prompt-templates/system-prompt-generation-user.md`
- `src/backend/prompt-templates/system-prompt-generation-system.md`
- `src/backend/prompt-templates/default-member-system-prompt.md`

실행 품질 개선 루프에서는 대체로 앞의 두 파일만 다룬다.

### 4. baseline은 고정한다

같은 개선 loop 안에서는 baseline report를 바꾸지 않는다.  
비교 기준이 계속 바뀌면 개선 여부를 판단할 수 없다.

### 5. 점수만 보지 않는다

항상 아래 4가지를 같이 본다.

- 현재 score
- baseline 대비 개선 여부
- 효율성 변화
- 다음 수정 방향

### 6. 실험은 별도 브랜치에서 진행한다

이 루프는 기본 브랜치에서 직접 수행하지 않는다.

- 프롬프트 엔지니어링 전용 별도 브랜치에서 시작한다
- 한 실험 루프 안에서는 같은 브랜치를 유지한다
- baseline을 바꾸거나 실험 축을 바꿀 때만 새 브랜치로 넘어간다

즉, 실험 브랜치는 iteration의 작업 단위이고, main 계열 브랜치는 결과를 수용하는 단위다.

### 7. 하나의 진전이 생기면 바로 커밋한다

AI는 여러 iteration을 워킹트리에 쌓아두지 않는다.

다음 중 하나가 발생하면 즉시 커밋하고 다음 loop로 넘어간다.

- baseline 대비 명확한 개선이 발생함
- hard gate 하나를 복구함
- 효율성 악화 없이 품질이 개선됨
- 다음 비교의 기준점으로 삼을 가치가 있는 안정된 변화가 생김

커밋 원칙:

- 커밋 하나에는 하나의 가설과 그 결과만 담는다
- unrelated prompt 수정은 같은 커밋에 섞지 않는다
- 커밋 메시지는 무엇을 개선하려 했는지 드러나야 한다

예시:

- `prompt_improve-delegation-ordering`
- `prompt_reduce-unnecessary-clarifications`
- `prompt_strengthen-final-report-format`

## 루프의 역할 정의

### AI Prompt Engineer

담당:

- report 읽기
- 실패 원인 가설 세우기
- 최소한의 prompt 수정안 만들기
- evaluator 재실행
- 결과 요약
- 다음 변경안 제안

금지:

- 문제 원인이 불명확한데 여러 템플릿을 동시에 크게 뒤엎기
- evaluator 결과 없이 "좋아졌을 것"이라고 주장하기
- baseline 없이 `promote`를 선언하기

### Human Reviewer

담당:

- 실험 시작점과 종료점 승인
- baseline 선택
- 최종 승격 여부 판단
- 프롬프트 루프로 해결되지 않는 구조 문제 분리

## 사전 준비

### 1. baseline report 확보

먼저 기준이 되는 report를 하나 만든다.

예시:

```bash
npm run eval:prompt -- \
  --scenario delegation-basic \
  --codex real \
  --output-dir ./eval-results/baseline
```

baseline 경로 예시:

```text
./eval-results/baseline/delegation-basic.report.json
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
- baseline report

## 표준 반복 절차

### Step 1. 현재 결과 읽기

AI는 가장 최근 report에서 아래를 먼저 읽는다.

- `report.score`
- `report.verdict`
- `report.hardGates`
- `report.criteria`
- `report.metrics`
- `baselineComparison`
- `finalDecision`

그리고 필요하면 아래 raw 데이터를 본다.

- `report.transcript`
- `report.jobs`

### Step 2. 이번 loop의 단일 가설 정하기

좋은 가설 예시:

- coordinator가 너무 일찍 writer를 호출하는 건, 조사 선행 규칙이 prompt에서 약해서다.
- clarification이 불필요하게 많은 건, "명확한 요청이면 바로 진행" 규칙이 약해서다.
- 최종 보고가 흐릿한 건, coordinator final output 형식 요구가 약해서다.

나쁜 가설 예시:

- 전체적으로 다 부족하니 prompt를 전면 재작성하자.

### Step 3. 수정 범위 최소화

한 iteration에서 다음 중 하나만 선택한다.

- 역할/우선순위 규칙 강화
- 위임 순서 규칙 강화
- 질문 최소화 규칙 강화
- final report 형식 강화
- artifact/report 요구 강화

가능하면 한 템플릿 파일 안에서 끝내고, 꼭 필요할 때만 두 파일까지 허용한다.

### Step 4. prompt 수정

AI는 템플릿 수정 시 아래를 반드시 지킨다.

- placeholder를 깨지 않는다
- 기존 정책과 정면 충돌하는 문구를 넣지 않는다
- 지나치게 장문 규칙을 늘리지 않는다
- 한 번에 여러 행동을 강제하지 않는다
- "무조건" 같은 과잉 제약은 신중하게 쓴다

### Step 5. evaluator 재실행

수정 후 반드시 같은 baseline에 대해 다시 평가한다.

예시:

```bash
npm run eval:prompt -- \
  --scenario delegation-basic \
  --codex real \
  --baseline-report ./eval-results/baseline/delegation-basic.report.json \
  --output-dir ./eval-results/candidate-01
```

### Step 6. 결과 판독

AI는 결과를 아래 순서로 읽는다.

1. hard gate 실패 여부
2. 현재 score 변화
3. delta verdict
4. efficiency verdict
5. final decision
6. transcript 기준 실제 행동 변화

### Step 7. iteration 결론 쓰기

각 loop 끝에서 AI는 아래 5가지를 짧게 남긴다.

- 무엇을 바꿨는지
- 어떤 가설을 검증했는지
- score가 어떻게 바뀌었는지
- 효율성이 어떻게 바뀌었는지
- 다음 loop에서 무엇을 할지

그리고 아래 항목은 반드시 출력해야 한다.

- 이번 가설
- 수정한 파일
- baseline/current 비교
- 실제 행동 변화
- 다음 액션

### Step 8. 진전 여부 판단 후 커밋

AI는 iteration이 끝나면 아래를 확인한다.

- 이번 수정이 baseline 대비 실제 진전을 만들었는가
- 또는 hard gate 복구 같은 독립적인 진전이 있었는가

둘 중 하나라도 `예`면:

1. 현재 변경을 커밋한다
2. 그 커밋을 다음 loop의 작업 기준점으로 삼는다
3. 다음 가설로 넘어간다

둘 다 `아니오`면:

- 커밋하지 말고 같은 브랜치에서 다음 수정 가설로 이어간다
- 단, 3회 연속 실패하면 중단 조건을 적용한다

## 최종 판정 해석과 다음 액션

### `promote`

의미:

- hard gate 통과
- baseline 대비 개선이 명확함
- 효율 악화가 크지 않음

다음 액션:

- 현재 결과를 새 candidate baseline으로 올릴지 사람에게 제안
- 같은 문제 축에 대한 추가 과최적화는 중단

### `hold`

의미:

- 현재 결과는 동작하지만 개선 폭이 불명확하거나 효율성이 애매함

다음 액션:

- transcript와 metrics를 다시 읽고
- 같은 축에서 더 작은 수정을 한 번 더 시도하거나
- 다른 원인 가설로 전환

### `reject`

의미:

- hard gate 실패
- 품질 악화
- baseline 대비 후퇴

다음 액션:

- 직전 수정 가설을 폐기
- baseline 또는 직전 안정 버전으로 되돌린 뒤
- 다른 단일 가설로 재시도

### `investigate`

의미:

- score와 효율성이 서로 상충하거나
- 실제 transcript 해석이 불명확함

다음 액션:

- 제품 구조 문제인지, evaluator 기준 문제인지, prompt 문제인지 분리
- 필요하면 사람에게 에스컬레이션

## 중단 조건

AI는 아래 중 하나가 발생하면 반복을 중단하고 사람에게 보고해야 한다.

- 같은 문제 축에서 3회 연속 `hold` 또는 `reject`
- hard gate 실패 원인이 prompt가 아니라 runtime/infra 문제로 보임
- transcript와 score가 모순돼 원인 해석이 불명확함
- 수정 범위가 prompt template을 넘어 backend 정책 변경으로 번짐

## AI가 따라야 하는 작업 규칙

### 수정 전에

- baseline report를 먼저 읽는다
- 현재 템플릿 전문을 읽는다
- 이번 loop의 단일 가설을 명시한다
- 현재 작업 브랜치가 실험 브랜치인지 확인한다

### 수정 중

- 최소 diff만 만든다
- 같은 iteration에서 unrelated prompt를 건드리지 않는다
- 설명용 코멘트를 문서에 남기고 템플릿 본문은 과도하게 주석화하지 않는다

### 수정 후

- evaluator를 반드시 다시 돌린다
- score뿐 아니라 transcript를 확인한다
- "왜 좋아졌는지" 또는 "왜 나빠졌는지"를 행동 기준으로 설명한다
- 진전이 있으면 바로 커밋한다

## 반드시 출력할 항목

AI는 각 iteration 결과에서 아래 항목을 반드시 출력해야 한다.

- 이번 가설
- 수정한 파일
- baseline/current 비교
- 실제 행동 변화
- 다음 액션

이 다섯 항목이 없으면 iteration 보고는 불완전한 것으로 간주한다.

## 권장 iteration 보고 포맷

AI는 각 loop를 끝낼 때 아래 포맷으로 요약한다.

```md
## Iteration N

- Hypothesis:
- Edited files:
- Baseline score:
- Current score:
- Delta verdict:
- Efficiency verdict:
- Final decision:
- Observed behavior change:
- Next action:
- Commit needed:
- Commit message:
```

`Commit needed`는 `yes` 또는 `no`로 적는다.  
`yes`라면 같은 iteration 안에서 바로 커밋해야 한다.

## 권장 디렉토리 운영

예시:

```text
eval-results/
  baseline/
    delegation-basic.report.json
    delegation-basic.report.md
  candidate-01/
    delegation-basic.report.json
    delegation-basic.report.md
  candidate-02/
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

아래 텍스트는 evaluator 기반 프롬프트 개선 작업을 AI에게 직접 시킬 때 사용할 수 있다.

```text
너는 Viblack의 prompt engineer다.

목표:
- evaluate-tool report를 읽고
- baseline 대비 더 나은 prompt 수정안을 만들고
- real Codex evaluator를 다시 실행한 뒤
- 결과를 비교하고
- 다음 수정 방향을 제안하라.

작업 규칙:
- real Codex evaluator만 사용한다.
- 한 iteration에 하나의 가설만 검증한다.
- 기본적으로 prompt template 파일만 수정한다.
- baseline report는 고정한다.
- 실험은 별도 브랜치에서 진행한다.
- 점수만 보지 말고 hard gate, delta verdict, efficiency verdict, transcript를 함께 본다.
- 개선이 불명확하면 억지로 promote 하지 않는다.
- 같은 문제 축에서 3회 연속 실패하면 에스컬레이션한다.
- 하나의 진전이 생기면 바로 커밋한다.

우선순위:
1. hard gate 복구
2. 구조적 규칙 준수
3. 품질 개선
4. 효율성 유지 또는 개선

반드시 출력할 것:
- 이번 가설
- 수정한 파일
- baseline/current 비교
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
- baseline 없이 "좋아 보인다"고 말한다
- 품질 향상 없이 규칙 문구만 계속 늘린다
- 효율이 악화됐는데 점수만 보고 성공이라고 선언한다

## 운영 권장 순서

실제 운영에서는 아래 순서를 권장한다.

1. baseline 생성
2. AI에게 단일 가설 기반 수정 지시
3. evaluator 실행
4. 결과 요약 수집
5. `promote/hold/reject/investigate` 판정
6. 필요 시 다음 iteration
7. 충분히 좋아졌으면 사람 승인 후 baseline 갱신

이 문서의 목적은 AI가 evaluator를 "한 번 실행하는 도구"가 아니라, 지속적 개선을 위한 판단 루프의 일부로 사용하게 만드는 것이다.
