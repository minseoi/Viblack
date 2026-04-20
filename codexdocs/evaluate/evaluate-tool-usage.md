# Evaluate Tool Usage

## 개요

`evaluate-tool`은 Viblack의 프롬프트 템플릿과 채널 협업 규칙을 Electron UI 없이 평가하는 headless CLI다.

현재 구현 범위:

- scenario: `delegation-basic`
- real Codex 실행
- baseline report 비교
- final decision 계산
- JSON / Markdown report 출력

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

## 빠른 시작

### 1. real Codex로 기본 평가

```bash
npm run eval:prompt -- --scenario delegation-basic --codex real
```

이 명령은 다음을 수행한다.

1. `dist/backend/test-server-entry.js`를 child process로 띄운다.
2. 평가용 agent / channel / workspace를 만든다.
3. `delegation-basic` 시나리오를 실행한다.
4. score, hard gate, final decision을 계산한다.
5. `eval-results/...` 아래에 JSON / Markdown report를 저장한다.

### 2. runtime을 지정해 real Codex 평가

```bash
npm run eval:prompt -- --scenario delegation-basic --codex real
```

기본 runtime은 `exec`다. 필요하면 override 할 수 있다.

```bash
npm run eval:prompt -- --scenario delegation-basic --codex real --runtime app-server
```

## 자주 쓰는 옵션

### `--scenario`

실행할 단일 scenario id.

현재 지원:

- `delegation-basic`

예시:

```bash
node dist/tools/evaluator/run.js --scenario delegation-basic --codex real
```

### `--suite`

scenario 묶음을 실행한다.

현재 지원:

- `prompt-regression`

현재는 내부적으로 `delegation-basic` 하나를 실행하지만, 추후 여러 scenario를 묶을 수 있게 열어 둔 엔트리다.

예시:

```bash
node dist/tools/evaluator/run.js --suite prompt-regression --codex real
```

### `--codex`

현재 user-facing evaluator CLI는 `real`만 지원한다.

- `real`

예시:

```bash
node dist/tools/evaluator/run.js --scenario delegation-basic --codex real
```

`fake`를 넘기면 CLI는 에러로 종료된다. fake fixture는 앱 회귀 테스트용 경로이며 evaluator CLI의 공식 실행 모드가 아니다.

### `--baseline-report`

이전 실행에서 생성된 report JSON 경로를 넘기면 현재 결과와 비교한다.

예시:

```bash
node dist/tools/evaluator/run.js \
  --scenario delegation-basic \
  --codex real \
  --baseline-report eval-results/baseline/delegation-basic.report.json
```

주의:

- 현재 baseline 비교는 `이전 report 파일` 기준이다.
- `main 브랜치 자동 체크아웃 후 비교` 같은 branch-aware baseline은 아직 구현되지 않았다.

### `--output-dir`

결과를 저장할 디렉토리를 직접 지정한다.

예시:

```bash
node dist/tools/evaluator/run.js \
  --scenario delegation-basic \
  --codex real \
  --output-dir ./eval-results/manual-run
```

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

scenario 단일 실행 시:

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
  전체 평가 결과. 점수, transcript, jobs, baseline comparison, final decision 포함
- `*.report.md`
  사람이 읽기 쉬운 요약 리포트
- `runtime/`
  평가 중 사용한 DB와 workspace

## JSON report에서 보는 핵심 필드

### 현재 평가

- `report.score`
- `report.maxScore`
- `report.verdict`
- `report.criteria`
- `report.hardGates`
- `report.metrics`

### baseline 비교

- `baselineComparison.deltaScore`
- `baselineComparison.deltaVerdict`
- `baselineComparison.deltaConfidence`
- `baselineComparison.efficiencyVerdict`

### 최종 판정

- `finalDecision.decision`
- `finalDecision.reason`
- `finalDecision.strengths`
- `finalDecision.weaknesses`
- `finalDecision.nextPromptChanges`

## Final Decision 해석

### `promote`

- hard gate 통과
- 현재 score 기준 이상
- baseline 대비 개선이 명확함
- 효율성 악화가 크지 않음

### `hold`

- 현재 실행은 통과
- 하지만 baseline이 없거나, 개선 폭이 불명확하거나, 효율성이 아쉬움

### `reject`

- hard gate 실패
- score 기준 미달
- baseline 대비 품질 악화

### `investigate`

- 점수 변화와 효율성 변화가 충돌해 원인 분석이 더 필요함

## 추천 사용 흐름

### 1. baseline 만들기

```bash
npm run eval:prompt -- --scenario delegation-basic --codex real --output-dir ./eval-results/baseline
```

### 2. 프롬프트 수정 후 다시 실행

```bash
npm run eval:prompt -- \
  --scenario delegation-basic \
  --codex real \
  --baseline-report ./eval-results/baseline/delegation-basic.report.json \
  --output-dir ./eval-results/candidate
```

### 3. real Codex로 최종 확인

```bash
npm run eval:prompt -- \
  --scenario delegation-basic \
  --codex real \
  --baseline-report ./eval-results/candidate/delegation-basic.report.json \
  --output-dir ./eval-results/real-check
```

## 현재 구현 제약

- scenario는 아직 `delegation-basic`만 제공한다.
- baseline 비교는 report file 기준이며 branch-aware compare는 아직 없다.
- AI judge는 아직 붙어 있지 않고, 현재 final decision은 rule-based scoring + heuristic comparison 기반이다.
- Electron UI 회귀를 대체하는 도구는 아니다. UI는 기존 Playwright/Electron 테스트가 담당한다.
- fake Codex 경로는 evaluator CLI에서 지원하지 않는다.

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

### `fake codex mode is not supported`

의도된 동작이다. evaluator CLI는 real Codex만 지원한다.

### `codex: command not found`

`--codex real`에서 발생하면 Codex CLI 설치 또는 PATH 설정을 확인한다.

### `reject`가 나왔지만 transcript를 보고 싶다

`*.report.md`를 먼저 보면 된다. 더 자세한 raw 정보는 `*.report.json`의 `report.transcript`, `report.jobs`, `report.criteria`를 확인한다.
