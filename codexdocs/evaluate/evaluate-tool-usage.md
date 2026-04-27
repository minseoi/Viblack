# Evaluate Tool Usage

## 개요

`evaluate-tool`은 Viblack의 프롬프트 템플릿과 채널 협업 규칙을 Electron UI 없이 점검하는 headless CLI다.

현재 구현 범위:

- scenario: `delegation-basic`
- real Codex 실행
- 현재 실행의 개선 포인트 추출
- 이전 실행 report와의 qualitative 비교
- JSON / Markdown report 출력

핵심 변화:

- 더 이상 numeric score나 `promote/hold/reject/investigate` 판정을 만들지 않는다.
- 대신 현재 실행의 `feedback`과 이전 실행 대비 `previousRunComparison`을 만든다.
- 즉 evaluator는 "점수 계산기"가 아니라 "개선 포인트와 퇴보 여부를 찾는 도구"다.

CLI 실행 파일:

```bash
node dist/tools/evaluator/run.js
```

편의 스크립트:

```bash
npm run eval:prompt -- --scenario delegation-basic --codex real
```

## 사전 조건

### 공통

- Node.js 22+
- `npm install`
- `npm run build`

### real Codex 평가

- Codex CLI 설치
- Codex CLI 인증 완료
- 터미널에서 `codex --version` 가능

필요하면 Codex 경로를 명시할 수 있다.

```bash
VIBLACK_CODEX_PATH=/absolute/path/to/codex npm run eval:prompt -- --scenario delegation-basic --codex real
```

## 빠른 시작

### 1. 현재 상태를 한 번 평가

```bash
npm run eval:prompt -- \
  --scenario delegation-basic \
  --codex real \
  --output-dir ./eval-results/run-01
```

이 명령은 다음을 수행한다.

1. `dist/backend/test-server-entry.js`를 child process로 띄운다.
2. 평가용 agent / channel / workspace를 만든다.
3. `delegation-basic` 시나리오를 실행한다.
4. hard gate, criteria, transcript를 바탕으로 현재 개선 포인트를 만든다.
5. `eval-results/...` 아래에 JSON / Markdown report를 저장한다.

### 2. 프롬프트 수정 후 이전 실행과 비교

```bash
npm run eval:prompt -- \
  --scenario delegation-basic \
  --codex real \
  --previous-report ./eval-results/run-01/delegation-basic.report.json \
  --output-dir ./eval-results/run-02
```

이때 evaluator는 다음을 추가로 계산한다.

- 직전 실행 대비 개선점
- 직전 실행 대비 퇴보
- 여전히 남아 있는 문제

### 3. runtime 지정

기본 runtime은 `exec`다. 필요하면 override 할 수 있다.

```bash
npm run eval:prompt -- \
  --scenario delegation-basic \
  --codex real \
  --runtime app-server
```

## 자주 쓰는 옵션

### `--scenario`

실행할 단일 scenario id.

현재 지원:

- `delegation-basic`

### `--suite`

scenario 묶음을 실행한다.

현재 지원:

- `prompt-regression`

현재는 내부적으로 `delegation-basic` 하나만 실행한다.

### `--codex`

현재 user-facing evaluator CLI는 `real`만 지원한다.

- `real`

`fake`를 넘기면 CLI는 에러로 종료된다. fake fixture는 앱 회귀 테스트용 경로이며 evaluator CLI의 공식 실행 모드가 아니다.

### `--previous-report`

직전 실행에서 생성된 report JSON 경로를 넘기면 현재 결과와 qualitative 비교한다.

예시:

```bash
node dist/tools/evaluator/run.js \
  --scenario delegation-basic \
  --codex real \
  --previous-report eval-results/run-01/delegation-basic.report.json
```

주의:

- 비교 기준은 branch가 아니라 `이전 report 파일`이다.
- `--baseline-report`는 deprecated alias로만 남아 있다.

### `--output-dir`

결과를 저장할 디렉토리를 직접 지정한다.

지정하지 않으면 기본적으로 `eval-results/<timestamp>-<scenario-or-suite>-<codexKind>/` 아래에 저장된다.

### `--runtime`

Codex runtime preference를 지정한다.

예시:

```bash
node dist/tools/evaluator/run.js \
  --scenario delegation-basic \
  --codex real \
  --runtime exec
```

## 출력 구조

```text
eval-results/<run>/
  delegation-basic.report.json
  delegation-basic.report.md
  runtime/
    viblack.evaluator.sqlite
    backend-workspace/
    channel-workspaces/
      delegation-eval-.../
```

설명:

- `*.report.json`
  전체 평가 결과. hard gate, criteria, transcript, feedback, previousRunComparison 포함
- `*.report.md`
  사람이 읽기 쉬운 요약 리포트
- `runtime/`
  평가 중 사용한 DB와 workspace

## JSON report에서 보는 핵심 필드

### 현재 실행

- `report.verdict`
- `report.criteria`
- `report.hardGates`
- `report.metrics`
- `report.transcript`
- `report.jobs`

### 현재 개선 포인트

- `feedback.strengths`
- `feedback.improvementAreas`
- `feedback.nextPromptChanges`

### 이전 실행과 비교

- `previousRunComparison.verdict`
- `previousRunComparison.improvements`
- `previousRunComparison.regressions`
- `previousRunComparison.unchangedConcerns`
- `previousRunComparison.summary`

## Comparison Verdict 해석

### `better`

- 직전 실행 대비 개선만 보임
- 새 regressions는 없음

### `same`

- 큰 변화가 없음
- 이전 문제도 그대로일 수 있음

### `worse`

- 직전 실행 대비 퇴보만 보임

### `mixed`

- 좋아진 점과 나빠진 점이 함께 있음

### `uncomparable`

- scenario id가 다르거나 비교 기준이 맞지 않음

## 추천 사용 흐름

### 1. 첫 report 생성

```bash
npm run eval:prompt -- \
  --scenario delegation-basic \
  --codex real \
  --output-dir ./eval-results/run-01
```

### 2. report에서 개선 포인트 읽기

우선순위:

1. `report.hardGates`
2. `feedback.improvementAreas`
3. `feedback.nextPromptChanges`
4. `report.transcript`

### 3. 프롬프트 수정

대체로 아래 파일이 대상이다.

- `src/backend/prompt-templates/member-execution-system-prompt.md`
- `src/backend/prompt-templates/member-execution-channel-rules.md`

### 4. 이전 report와 비교하며 재실행

```bash
npm run eval:prompt -- \
  --scenario delegation-basic \
  --codex real \
  --previous-report ./eval-results/run-01/delegation-basic.report.json \
  --output-dir ./eval-results/run-02
```

### 5. `better / same / worse / mixed`로 읽고 다음 수정 결정

## 현재 구현 제약

- scenario는 아직 `delegation-basic`만 제공한다.
- user-facing evaluator CLI는 real Codex만 지원한다.
- 비교는 report file 기준이며 branch-aware compare는 아직 없다.
- Electron UI 회귀를 대체하는 도구는 아니다. UI는 기존 Playwright/Electron 테스트가 담당한다.

## 문제 해결

### `backend test server exited before ready`

원인 후보:

- `npm run build` 미실행
- loopback port bind 권한 문제
- evaluator가 backend child process를 띄울 수 없는 환경

확인:

```bash
npm run build
node dist/tools/evaluator/run.js --scenario delegation-basic --codex real
```

### `spawn codex ENOENT`

원인 후보:

- backend child process에서 Codex 경로를 찾지 못함
- `PATH`가 shell과 child process에서 다름

대응:

```bash
command -v codex
VIBLACK_CODEX_PATH=/absolute/path/to/codex npm run eval:prompt -- --scenario delegation-basic --codex real
```

### `fake codex mode is not supported`

의도된 동작이다. evaluator CLI는 real Codex만 지원한다.

### transcript를 자세히 보고 싶다

`*.report.md`를 먼저 보면 된다. 더 자세한 raw 정보는 `*.report.json`의 `report.transcript`, `report.jobs`, `report.criteria`를 확인한다.
