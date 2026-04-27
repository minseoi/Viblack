# Evaluate Tool Spec

## 상태 메모

이 문서는 evaluator의 초기 설계 메모를 포함하고 있어, 일부 섹션은 현재 구현과 다를 수 있다.

현재 구현의 authoritative behavior는 아래 두 문서를 따른다.

- [evaluate-tool-usage.md](/Users/minseoi/dev/Viblack/codexdocs/evaluate/evaluate-tool-usage.md)
- [evaluate-loop-playbook.md](/Users/minseoi/dev/Viblack/codexdocs/evaluate/evaluate-loop-playbook.md)

특히 현재 구현은 더 이상 numeric score나 `promote/hold/reject/investigate` 판정을 주축으로 삼지 않고, `feedback`과 `previousRunComparison` 기반의 qualitative loop를 사용한다.

## 목적

Viblack의 프롬프트 템플릿과 멤버 협업 규칙을 UI 개발과 분리해서 개선할 수 있는 headless 평가 도구를 정의한다.

이 도구의 핵심 목적은 아래 4가지다.

1. 현재 프롬프트 구성이 실제 Codex 런타임에서 얼마나 잘 동작하는지 측정한다.
2. 새 프롬프트가 이전 baseline보다 분명히 나아졌는지 비교한다.
3. 일이 더 효율적으로 진행되었는지 판단한다.
4. 다음 프롬프트 수정 방향을 제안하는 피드백 루프를 만든다.

이 문서는 Electron UI 테스트가 아니라, 프롬프트 엔지니어링을 위한 전용 evaluate 툴을 대상으로 한다.

## 배경

현재 프롬프트는 별도 템플릿 파일로 분리되어 있다.

- `src/backend/prompt-templates/default-member-system-prompt.md`
- `src/backend/prompt-templates/member-execution-system-prompt.md`
- `src/backend/prompt-templates/member-execution-channel-rules.md`
- `src/backend/prompt-templates/system-prompt-generation-user.md`
- `src/backend/prompt-templates/system-prompt-generation-system.md`

이 구조는 UI/기능 개발과 프롬프트 개선을 분리하기 위한 1단계다. 다음 단계는 템플릿 변경을 제품 코드 수정과 분리해서 반복 평가할 수 있는 전용 evaluator를 만드는 것이다.

## 설계 원칙

### 1. GUI 없이 동작해야 한다

평가 루프는 Electron 창을 띄우지 않고 실행할 수 있어야 한다. Ubuntu 같은 별도 평가 머신에서도 돌아야 한다.

### 2. 실제 제품 런타임을 재사용해야 한다

평가를 위해 제품 로직을 복제하지 않는다. 채널 오케스트레이션, workspace 정책, artifact 검증, action protocol 등은 실제 backend 계약을 그대로 사용한다.

### 3. 기계 채점과 AI 평가를 혼합해야 한다

구조적 규칙 준수는 코드가 채점하고, 품질과 실무 적합성은 AI judge가 평가한다.

### 4. 절대 점수만 보지 않는다

한 번의 점수보다 다음이 더 중요하다.

- 기준선 이상인지
- 이전 baseline보다 개선되었는지
- 품질 향상이 효율 저하를 정당화하는지
- 더 좋아질 방법이 무엇인지

### 5. 같은 repo 안에 두되, 폴더 계층과 실행 경계는 분리해야 한다

평가기는 독립 실행형 CLI이지만, 별도 repo나 별도 앱으로 분리하지 않는다. 대신 제품 코드와 evaluator 코드는 폴더 계층과 실행 경계를 분리해서 관리한다. 제품과 evaluator가 drift 나지 않도록 같은 codebase 안에서 backend 계약을 재사용한다.

## 범위

### 포함

- 프롬프트 템플릿 평가
- 멤버 협업 시나리오 평가
- 채널 orchestration 품질 평가
- DM/채널 실행 품질 비교
- baseline 대비 개선 여부 비교
- 효율성 분석
- 개선 제안 생성

### 제외

- Electron 화면 렌더링 검증
- 픽셀 단위 UI 회귀
- 범용 제품 E2E 전체 대체
- 모델 자체 벤치마크
- 프롬프트 자동 배포 결정

## 실행 형태

평가 도구는 headless CLI로 제공한다.

예시:

```bash
npm run build
node dist/tools/evaluator/run.js --scenario delegation-basic --codex real
node dist/tools/evaluator/run.js --suite prompt-regression --codex real --baseline-report eval-results/baseline/delegation-basic.report.json
```

권장 구조는 evaluator를 제품 코드 아래에 섞지 않고 `tools/evaluator/` 아래로 분리하는 것이다. 빌드 후 실행물은 `dist/tools/evaluator/`에 위치시킨다.

- `src`는 원본 TypeScript
- `dist`는 빌드된 JavaScript 실행물

## 권장 디렉토리 구조

```text
src/
  main.ts
  preload.ts
  renderer/
  backend/

tools/
  evaluator/
    src/
      run.ts
      scenarios/
        delegation-basic.ts
        clarification-needed.ts
        artifact-required.ts
      runners/
        backend-eval-runner.ts
        codex-judge-runner.ts
      scorers/
        rule-scorer.ts
        efficiency-scorer.ts
        final-decision.ts
      reporters/
        json-reporter.ts
        markdown-reporter.ts
      types.ts
```

## 코드 경계 원칙

### 제품 코드

- `src/backend/`
- `src/renderer/`
- `src/main.ts`
- `src/preload.ts`

이 영역은 실제 앱 동작과 사용자 기능을 담당한다.

### evaluator 코드

- `tools/evaluator/src/`

이 영역은 headless 평가, 시나리오 실행, 채점, judge 호출, 리포트 생성을 담당한다.

### 공유 경계

Evaluator는 제품 런타임을 복제하지 않고 아래 경계만 공유한다.

- backend HTTP API 계약
- backend test server 엔트리포인트
- 필요 시 최소한의 shared type

### 금지 사항

- channel orchestration 로직을 evaluator 안에 다시 구현하지 않는다.
- workspace 정책을 evaluator 안에 복제하지 않는다.
- artifact validation 규칙을 evaluator 안에 별도로 복제하지 않는다.
- Electron renderer나 UI helper를 evaluator가 직접 의존하지 않는다.

즉 evaluator는 제품 코드를 재구현하는 도구가 아니라, 제품 런타임을 호출해서 평가하는 도구여야 한다.

## 전체 아키텍처

평가 흐름은 아래 순서로 동작한다.

1. evaluator CLI가 시작된다.
2. 임시 DB와 임시 workspace를 생성한다.
3. backend test server를 띄운다.
4. 현재 브랜치의 prompt template을 로드한 backend를 사용한다.
5. 시나리오 정의에 따라 agent, channel, member, message를 구성한다.
6. 실제 Codex CLI로 시나리오를 실행한다.
7. transcript, execution jobs, system messages, artifact 정보를 수집한다.
8. rule-based scorer가 구조/계약 위반을 채점한다.
9. AI judge가 품질/실무성/개선 가능성을 평가한다.
10. baseline과 current를 비교해 delta verdict를 계산한다.
11. 최종 decision, 개선 제안, 리포트를 출력한다.

## 실행 환경

### 평가 머신

- Ubuntu 사용 가능
- Codex CLI 설치 필요
- Codex 인증 완료 필요
- Node.js와 프로젝트 의존성 설치 필요

### 권장 분리

- Prompt evaluator: Ubuntu headless 머신
- Electron UI 테스트: GUI 가능한 로컬 개발 머신 또는 별도 GUI 러너

이 문서의 evaluator는 CLI 기반 평가를 전제로 하므로 GUI가 필요 없다.
user-facing evaluator는 실제 Codex 실행을 전제로 하며, fake Codex fixture는 제품 회귀 테스트용 보조 수단으로만 남긴다.

## 시나리오 설계

시나리오는 단순 프롬프트 모음이 아니라, 재현 가능한 업무 과제와 기대 행동을 포함한 평가 단위여야 한다.

각 시나리오는 다음 정보를 가진다.

```ts
interface EvalScenario {
  id: string;
  title: string;
  objective: string;
  setup: {
    agents: Array<{
      name: string;
      role: string;
      systemPrompt?: string;
    }>;
    channel?: {
      name: string;
      description?: string;
      workspaceMode: "temp";
    };
  };
  input: {
    message: string;
    mode: "channel" | "dm";
  };
  expectations: {
    hardGates: string[];
    requiredBehaviors: string[];
    forbiddenBehaviors: string[];
    efficiencyTargets?: {
      maxJobs?: number;
      maxQuestions?: number;
      maxDelegationDepth?: number;
    };
  };
}
```

### 시나리오 원칙

- 하나의 업무 목표만 검증한다.
- 성공 조건이 관찰 가능해야 한다.
- 표현이 아니라 행동을 검증해야 한다.
- 프롬프트 wording 변화에 너무 민감하지 않아야 한다.
- 실제 사용자 요청처럼 자연어여야 한다.

### 초기 권장 시나리오

#### 1. `delegation-basic`

coordinator가 researcher에게 조사, writer에게 문서화, 다시 coordinator가 최종 보고하는 기본 채널 협업 흐름.

#### 2. `clarification-needed`

요청이 모호할 때 멋대로 진행하지 않고 clarification을 요청하는지 검증.

#### 3. `artifact-required`

파일 산출이 필요한 작업에서 실제 artifact를 만들고 `artifact_path`를 통해 보고하는지 검증.

### 시나리오 생성 방식

시나리오는 AI가 초안을 만들 수 있지만, 최종 canonical scenario는 사람이 승인해야 한다.

권장 방식:

1. 사람이 평가 축을 정한다.
2. Codex가 구체 시나리오 초안을 생성한다.
3. 사람이 후보를 검토하고 canonical scenario로 채택한다.
4. 채택된 시나리오만 회귀 평가에 사용한다.

즉, AI는 시나리오 생성 보조자이지 최종 권위자가 아니다.

## 수집 데이터

Evaluator는 최소한 아래 데이터를 저장해야 한다.

- prompt template snapshot 또는 template hash
- scenario id
- 실행 브랜치 또는 commit sha
- transcript
- execution jobs
- mentions
- parsed channel actions
- system messages
- artifact paths
- wall-clock runtime
- turn count
- question count
- delegation depth

이 데이터는 리포트 생성뿐 아니라 baseline 비교와 실패 원인 분석에 사용된다.

## 점수화 원칙

최종 평가는 `기계 채점 + AI judge` 혼합형으로 한다.

### A. 기계 채점

다음은 코드 기반으로 판정한다.

- timeout 발생 여부
- crash 발생 여부
- final report 존재 여부
- 필수 artifact 존재 여부
- coordinator/worker 순서
- 공개 보고 여부
- 예산 소진 여부
- question loop 여부
- 과도한 위임 증식 여부

이 영역은 transcript와 execution logs 같은 관찰 가능한 런타임 데이터만 사용해야 한다.

### B. AI judge 평가

다음은 Codex 또는 별도 judge 모델이 평가한다.

- 결과가 실제로 쓸 만한지
- 불필요하게 장황하거나 질문이 많은지
- 조사와 문서화가 자연스럽게 연결되는지
- 사용자가 바로 활용 가능한 형태인지
- 과장, 추정 확정, 환각 위험이 있는지
- baseline보다 실질적으로 좋아졌는지

### C. 효율성 평가

효율성은 독립 축으로 본다.

- 총 job 수
- 총 agent turn 수
- clarification 횟수
- 재시도 횟수
- delegation depth
- 완료까지 걸린 시간

품질이 약간 좋아졌더라도 효율이 크게 나빠졌다면 자동 승격하면 안 된다.

## 하드 게이트

다음 조건 중 하나라도 만족하면 자동 실패다.

- timeout
- crash
- 채널 실행 미정리 상태
- 필수 final report 누락
- 필수 artifact 누락
- 금지된 행동 발생
- workspace 정책 위반
- 평가 시스템이 transcript를 정상 수집하지 못함

## 점수 모델

기본 점수는 100점 만점으로 계산한다.

예시:

- 30점: 구조 준수
- 25점: 결과 완결성
- 15점: 협업 품질
- 15점: 효율성
- 15점: AI judge 품질 평가

또는 운영 초기에는 아래처럼 분리할 수 있다.

- 기계 점수 60
- AI judge 점수 40

중요한 점은 절대 배점보다 항목 안정성이다. 항목 정의가 자주 바뀌면 회귀 추세가 의미를 잃는다.

## Baseline 비교

Evaluator는 current만 평가하지 않고 baseline과 비교해야 한다.

baseline 후보:

- `main` 브랜치의 최신 성공 결과
- 직전 승인된 prompt revision
- 특정 템플릿 해시의 기준점

비교 결과는 최소한 아래를 포함해야 한다.

- `current_score`
- `baseline_score`
- `delta_score`
- `delta_verdict`
- `delta_confidence`

`delta_verdict`는 아래 중 하나를 사용한다.

- `better`
- `same`
- `worse`
- `unclear`

## 최종 판정

최종 판정은 단순 `pass/fail` 대신 다음 상태를 사용한다.

- `promote`
  현재 품질이 기준 이상이고 baseline보다 분명히 좋아졌으며 효율성도 수용 가능함
- `hold`
  품질은 괜찮지만 개선이 불명확하거나 효율이 악화됨
- `reject`
  기준 미달 또는 하드 게이트 실패
- `investigate`
  점수는 좋지만 결과가 불안정하거나 평가 근거가 충돌함

## 최종 판정 기준

### `promote`

- hard gate 통과
- current score 기준 이상
- delta verdict가 `better`
- delta confidence가 충분히 높음
- 효율성 악화가 크지 않음

### `hold`

- hard gate 통과
- current score는 기준 이상
- 하지만 개선 폭이 불명확하거나 효율성 저하가 큼

### `reject`

- hard gate 실패
- 또는 current score 기준 미달
- 또는 baseline 대비 명확한 악화

### `investigate`

- 채점 항목 간 상충이 큼
- 실행 결과가 변동성이 큼
- transcript 상으로는 좋아 보이나 실제 artifact 품질이 불안정함

## AI Judge 역할

AI judge는 단순 점수기보다 리뷰어 역할을 해야 한다.

judge는 아래를 출력해야 한다.

- 현재 결과의 품질 요약
- baseline 대비 개선 여부
- 효율성에 대한 판단
- 문제가 생긴 원인 가설
- 더 나아질 방법
- 다음 프롬프트 수정 제안

예시 출력 스키마:

```json
{
  "current_score": 87,
  "baseline_score": 81,
  "delta_score": 6,
  "delta_verdict": "better",
  "delta_confidence": 0.84,
  "efficiency_verdict": "slightly_worse",
  "final_decision": "hold",
  "summary": "품질은 개선됐지만 불필요한 clarification이 늘어나 효율성이 떨어졌다.",
  "strengths": [
    "research -> writing 흐름이 더 안정적이다",
    "최종 보고가 더 명확하다"
  ],
  "weaknesses": [
    "애매하지 않은 요청에서도 확인 질문이 추가된다",
    "coordinator 중간 요약이 반복된다"
  ],
  "next_prompt_changes": [
    "명확한 요청이면 clarification 없이 즉시 delegation하도록 제한한다",
    "research 결과를 받은 뒤 coordinator 요약은 1회만 허용한다"
  ]
}
```

## 결과물

Evaluator는 최소한 아래 artifact를 출력해야 한다.

- JSON 리포트
- Markdown 요약 리포트
- transcript dump
- scoring breakdown
- baseline comparison
- judge feedback

파일 예시:

```text
eval-results/
  2026-04-09/
    delegation-basic.current.json
    delegation-basic.current.md
    delegation-basic.baseline.json
    delegation-basic.diff.json
```

## 운영 루프

권장 루프는 다음과 같다.

1. 프롬프트 브랜치에서 템플릿 수정
2. evaluator CLI 실행
3. current score, delta verdict, efficiency verdict 확인
4. judge feedback으로 문제 원인과 다음 수정 방향 확인
5. 프롬프트 다시 수정
6. `promote`가 나올 때까지 반복

## 브랜치 전략

장수 프롬프트 브랜치 1개보다 실험 브랜치를 짧게 가져가는 방식을 권장한다.

- `main`: 현재 승인된 기준
- `prompt-exp/*`: 실험 브랜치

baseline은 보통 `main` 또는 직전 승인된 template revision을 사용한다.

## 자동화 전략

초기에는 수동 실행으로 시작한다.

1. 별도 평가 머신에 Codex CLI 설치
2. 브랜치 checkout
3. evaluator CLI 실행
4. 결과 리포트 확인

이후 자동화는 다음 순서로 확장한다.

1. 수동 실행
2. 원격 머신 스크립트
3. self-hosted GitHub Actions runner
4. PR 트리거 + nightly scheduled evaluation

핵심은 자동화보다 먼저 평가 항목과 decision 기준을 안정화하는 것이다.

## 비목표

이 evaluator는 프롬프트를 스스로 무한 최적화하는 자율 시스템이 아니다.

목표는 다음과 같다.

- 반복 실험을 빠르게 한다
- baseline 대비 개선 여부를 명확히 한다
- 실패 원인을 구조적으로 드러낸다
- 다음 수정 방향을 좁혀 준다

최종 프롬프트 승격 결정은 여전히 사람이 검토하는 것을 원칙으로 한다.

## 1차 구현 우선순위

### Phase 1

- headless evaluator CLI 엔트리
- `delegation-basic` 시나리오 이관
- rule-based scoring 정리
- JSON/Markdown report 출력

### Phase 2

- baseline comparison
- AI judge 추가
- `clarification-needed`, `artifact-required` 추가

### Phase 3

- branch-to-branch 비교 자동화
- nightly scheduled eval
- prompt revision tracking

## 성공 기준

이 도구가 성공했다고 볼 최소 기준은 다음과 같다.

1. Electron UI 없이 Ubuntu 머신에서 평가가 실행된다.
2. 하나의 prompt 변경이 baseline 대비 개선인지 악화인지 판정할 수 있다.
3. 결과 품질뿐 아니라 효율성 악화 여부를 함께 잡아낸다.
4. 리포트가 다음 prompt 수정 방향을 제안한다.
5. `delegation-basic` 같은 대표 시나리오에서 회귀 탐지와 개선 검증이 모두 가능하다.
