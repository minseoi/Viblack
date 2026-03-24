# 채널 리팩토링 설계 문서

이 문서는 현재 채널 구현을 유지 가능한 구조로 재구성하기 위한 상세 리팩토링 계획이다. 목표는 동작을 새로 발명하는 것이 아니라, 이미 구현된 채널 메시징/멘션 실행/실시간 동기화 기능을 도메인 단위로 분리하고, `channel-Refactoring.md`에 적힌 협업 의도를 담을 수 있는 구조를 만드는 것이다.

## 1. 리팩토링 목표

- 채널 기능의 책임을 `server.ts`와 `renderer.ts`의 거대 파일에서 분리한다.
- 채널 메시징, 멘션 라우팅, 에이전트 실행, 실시간 이벤트를 각각 독립 모듈로 나눈다.
- 현재 보장된 동작을 깨지 않고 구조를 정리한다.
- 이후 읽음 상태, 대표 멤버, 역할 기반 라우팅, 작업 추적 같은 기능을 붙일 수 있게 만든다.

## 2. 이번 리팩토링의 비목표

- DM과 채널을 한 번에 완전 통합된 conversation 모델로 갈아엎지 않는다.
- 작업 보드, 스레드, 핀, 검색까지 한 번에 구현하지 않는다.
- 채널 UX 전체를 새 디자인으로 교체하지 않는다.

즉, 이번 설계는 "구조 분리와 확장 기반 마련"이 핵심이다.

## 3. 현재 구조의 문제

### 3.1 백엔드 집중도 과다

현재 `src/backend/server.ts`가 다음 책임을 동시에 가진다.

- HTTP 라우팅
- 입력 검증
- 멘션 파싱
- 채널 실행 오케스트레이션
- Codex 호출
- 스트림 메시지 처리
- 재멘션 체인 처리
- SSE 브로드캐스트

이 구조의 문제는 기능 추가보다 변경 안전성이 낮다는 점이다. 예를 들어 읽음 상태나 실행 이력 테이블을 넣으려면 라우트 핸들러 중심 코드에 계속 분기와 상태가 붙는다.

### 3.2 렌더러 단일 파일 과비대화

현재 `src/renderer/renderer.ts`에는 다음이 한 파일에 섞여 있다.

- 앱 전역 상태
- 채널 목록 렌더링
- 멤버 모달 렌더링
- 메시지 타임라인 렌더링
- SSE 연결 관리
- 낙관적 메시지 병합
- DM 전송과 채널 전송 분기

이 상태에서는 채널 관련 수정이 DM 회귀를 만들기 쉽고, 반대로 DM 수정이 채널 동기화 로직을 깨기 쉽다.

### 3.3 데이터 모델의 추적성 부족

현재 스키마는 `channels`, `channel_members`, `channel_messages`, `channel_message_mentions`까지만 있다. 그래서 다음 정보를 표현하기 어렵다.

- 누가 어디까지 읽었는가
- 어떤 메시지가 어떤 실행을 유발했는가
- 재멘션 체인이 어떤 경로로 이어졌는가
- 채널에서 누가 현재 조율자 역할을 맡고 있는가

### 3.4 실행 정책과 메시지 저장이 강하게 결합

지금은 사용자 메시지 저장 직후 바로 실행 큐를 만들고, 그 결과도 다시 메시지로 적는다. 단순한 MVP로는 충분하지만, 다음 단계로 가면 분리해야 한다.

- 메시지 저장
- 멘션 해석
- 실행 큐 생성
- 에이전트 실행
- 실행 결과 기록
- UI 갱신 이벤트 발행

### 3.5 현재 보존해야 할 핵심 불변식

리팩토링은 아래 동작을 깨면 안 된다.

- 멘션 없는 채널 메시지는 `log_only`
- 멘션된 멤버만 실행
- 같은 멤버는 직렬 실행
- 다른 멤버는 병렬 실행 가능
- 재멘션 체인 가능
- 사용자 메시지 중복 렌더링 방지
- SSE 기반 증분 동기화 유지

## 4. 목표 아키텍처

리팩토링 후 채널 구조는 네 층으로 나눈다.

### 4.1 Route Layer

역할:

- HTTP 요청/응답 처리
- 입력 검증
- 서비스 호출
- 에러 매핑

후보 파일:

- `src/backend/routes/channel-routes.ts`
- `src/backend/routes/agent-routes.ts`
- `src/backend/routes/system-routes.ts`

### 4.2 Service Layer

역할:

- 채널 도메인 규칙 처리
- 멘션 라우팅
- 실행 큐 구성
- 메시지 저장과 실행 결과 기록 오케스트레이션

후보 파일:

- `src/backend/services/channel-service.ts`
- `src/backend/services/channel-message-service.ts`
- `src/backend/services/channel-member-service.ts`
- `src/backend/services/channel-execution-service.ts`
- `src/backend/services/mention-router.ts`

### 4.3 Repository Layer

역할:

- SQLite 접근 캡슐화
- 테이블별 CRUD 분리
- 서비스에서 SQL 세부사항 제거

후보 파일:

- `src/backend/repositories/agent-repository.ts`
- `src/backend/repositories/channel-repository.ts`
- `src/backend/repositories/channel-message-repository.ts`
- `src/backend/repositories/channel-member-state-repository.ts`
- `src/backend/repositories/channel-execution-repository.ts`

### 4.4 Event Layer

역할:

- 채널 메시지 이벤트 브로드캐스트
- 향후 읽음 상태, 실행 상태 이벤트 확장

후보 파일:

- `src/backend/events/channel-event-bus.ts`

## 5. 권장 디렉터리 구조

```text
src/backend/
  routes/
    agent-routes.ts
    channel-routes.ts
    system-routes.ts
  services/
    agent-execution-service.ts
    channel-execution-service.ts
    channel-member-service.ts
    channel-message-service.ts
    channel-service.ts
    mention-router.ts
  repositories/
    agent-repository.ts
    channel-execution-repository.ts
    channel-member-repository.ts
    channel-member-state-repository.ts
    channel-message-repository.ts
    channel-repository.ts
  events/
    channel-event-bus.ts
  db.ts
  server.ts
  types.ts
```

핵심은 `server.ts`를 오케스트레이터가 아니라 "조립점"으로 낮추는 것이다.

## 6. 데이터 모델 리팩토링 설계

### 6.1 유지할 기존 테이블

아래 테이블은 유지하되 repository 단위로 분리한다.

- `channels`
- `channel_members`
- `channel_messages`
- `channel_message_mentions`

### 6.2 추가 권장 테이블

### `channel_member_states`

목적:

- 멤버별 읽음 위치 추적
- 마지막 확인 시점 저장
- 채널 내 조율자 여부 같은 상태 저장

권장 컬럼:

- `channel_id`
- `agent_id`
- `last_read_message_id`
- `last_seen_at`
- `is_coordinator`
- `updated_at`

### `channel_execution_jobs`

목적:

- 어떤 메시지가 어떤 실행을 유발했는지 추적
- 재멘션 체인 및 실패 이력 기록
- 재시도와 감사 로그 기반 마련

권장 컬럼:

- `id`
- `channel_id`
- `trigger_message_id`
- `source_message_id`
- `source_agent_id`
- `target_agent_id`
- `execution_kind` (`mention` | `remention`)
- `status` (`queued` | `running` | `succeeded` | `failed` | `skipped`)
- `depth`
- `error_text`
- `created_at`
- `started_at`
- `finished_at`

현재는 실행 결과가 메시지에만 남아서 경로 추적성이 부족하다. 이 테이블이 있으면 실행 파이프라인을 UI와 테스트에서 직접 검증할 수 있다.

### 6.3 타입 구조 제안

`src/backend/types.ts`는 다음 중심 타입으로 정리한다.

- `Channel`
- `ChannelMember`
- `ChannelMemberState`
- `ChannelMessage`
- `ChannelMessageMention`
- `ChannelExecutionJob`
- `ChannelExecutionResult`
- `ExecutionMode`

중요한 점은 "메시지"와 "실행"을 같은 엔티티로 보지 않는 것이다.

## 7. 백엔드 도메인 설계

### 7.1 `mention-router.ts`

책임:

- 멤버 목록 기반 멘션 파싱
- `@name`, `@{name}` 정규화
- 중복 멘션 제거
- 향후 자동완성 토큰 규칙과 동일한 파서 제공

이유:

- 현재 멘션 파싱이 `server.ts`에 박혀 있어 테스트가 어렵다.
- UI 자동완성과 백엔드 파서 규칙을 같은 도메인 규칙으로 맞춰야 한다.

### 7.2 `channel-message-service.ts`

책임:

- 사용자 메시지 저장
- 메시지 종류 검증
- 멘션 저장
- 채널 메시지 조회

출력:

- 저장된 메시지
- 멘션 목록
- 실행 필요 여부

### 7.3 `channel-execution-service.ts`

책임:

- 멘션된 멤버 실행 오케스트레이션
- `withAgentLock` 기반 직렬화 적용
- 스트림 결과와 최종 결과 조합
- 재멘션 체인 큐 운영
- 실행 job 생성/갱신

이 서비스는 현재 채널 기능의 핵심이며, 라우트에서 완전히 떼어내야 한다.

### 7.4 `agent-execution-service.ts`

책임:

- Codex 호출 공통화
- DM/채널 공용 system prompt 조합
- 세션 ID 업데이트 처리
- 스트림 이벤트를 도메인 이벤트 형태로 상위 서비스에 전달

현재 DM과 채널 실행 코드가 거의 같은 구조를 따르므로, 이 부분은 공통 서비스로 올리는 편이 맞다.

### 7.5 `channel-event-bus.ts`

책임:

- SSE 구독자 관리
- `message.created`, `message.updated`, `execution.updated`, `member.read` 이벤트 발행

초기에는 기존 `channel_message` 이벤트만 내보내도 되지만, 내부 인터페이스는 이벤트 타입별로 분리해 두는 것이 낫다.

## 8. 렌더러 리팩토링 설계

### 8.1 리팩토링 목표

- 채널 상태와 DM 상태를 같은 파일 안의 전역 변수 집합으로 두지 않는다.
- 서버 동기화와 화면 렌더링을 분리한다.
- 낙관적 메시지 병합 로직을 재사용 가능한 채널 전용 모듈로 뺀다.

### 8.2 권장 구조

```text
src/renderer/
  api/
    agent-client.ts
    channel-client.ts
  state/
    app-state.ts
    channel-state.ts
    dm-state.ts
  sync/
    channel-sync.ts
  views/
    sidebar-view.ts
    message-pane-view.ts
    channel-members-view.ts
    modal-view.ts
  controllers/
    app-controller.ts
    composer-controller.ts
  renderer.ts
```

`renderer.ts`는 부트스트랩과 이벤트 연결만 담당하고, 실제 로직은 모듈로 보낸다.

### 8.3 렌더러 상태 모델

`channel-state.ts`는 최소한 다음 상태를 관리해야 한다.

- `channels`
- `activeChannelId`
- `activeChannelMembers`
- `lastSeenChannelMessageId`
- `pendingChannelUserMessages`
- `isChannelDeltaSyncing`
- `pendingChannelDeltaSync`
- `inflightChannelRequestCount`

지금도 비슷한 상태가 존재하지만, 전역 변수로 흩어져 있다. 이를 채널 전용 상태 모듈로 묶어야 한다.

### 8.4 동기화 구조

`channel-sync.ts`는 다음만 책임진다.

- SSE 연결 열기/닫기
- `after=lastSeenId` 증분 조회
- pending 메시지 reconcile
- 재시도 가능한 동기화 흐름 관리

이렇게 분리하면 UI 렌더링 함수가 네트워크 타이밍과 직접 얽히지 않는다.

### 8.5 메시지 뷰 구조

메시지 영역은 DM과 채널이 비슷한 타임라인 UI를 공유한다. 따라서 다음 분리가 유효하다.

- 공통: 메시지 마크다운 렌더링, sender label, 시간 표기
- 채널 전용: 멘션 하이라이트, 시스템/진행/결과 스타일, 채널 pending merge
- DM 전용: 단일 에이전트 상태, busy guard

## 9. API 계약 정리안

### 9.1 유지할 API

- `GET /api/channels`
- `POST /api/channels`
- `PATCH /api/channels/:channelId`
- `DELETE /api/channels/:channelId`
- `GET /api/channels/:channelId/members`
- `POST /api/channels/:channelId/members`
- `DELETE /api/channels/:channelId/members/:agentId`
- `GET /api/channels/:channelId/messages`
- `POST /api/channels/:channelId/messages`
- `GET /api/channels/events`

### 9.2 확장 권장 API

- `GET /api/channels/:channelId/read-state`
- `POST /api/channels/:channelId/read-state`
- `GET /api/channels/:channelId/executions`
- `GET /api/channels/:channelId/messages/:messageId/context`

이 확장 API들은 리팩토링 이후 단계에서 붙여도 된다. 중요한 것은 내부 구조를 먼저 이런 API를 수용 가능한 형태로 바꾸는 것이다.

## 10. 단계별 리팩토링 계획

### Phase 0. 기준선 고정

- 현재 채널 동작을 문서화한다.
- 기존 E2E 시나리오를 채널 회귀 기준으로 삼는다.
- "보존해야 할 불변식"을 체크리스트로 명시한다.

### Phase 1. 무동작 변경 백엔드 분리

- `server.ts`에서 멘션 파서 추출
- 채널 CRUD/멤버/메시지 라우트를 별도 파일로 이동
- Codex 실행 공통 로직을 서비스로 추출

완료 기준:

- API 동작은 그대로 유지
- 기존 E2E 전부 통과

### Phase 2. 저장소 레이어 도입

- `db.ts` 직접 호출을 repository 경유로 교체
- 채널 관련 SQL을 테이블별 repository로 쪼갠다
- 테스트 가능한 단위 함수로 바꾼다

완료 기준:

- 서비스에서 SQL 문자열 제거
- repository 단위 테스트 작성 가능 상태

### Phase 3. 실행 파이프라인 정규화

- `channel_execution_jobs` 도입
- 메시지 저장과 실행 큐 생성을 분리
- 재멘션 체인 처리 로직을 서비스 내부 상태머신처럼 정리

완료 기준:

- 어떤 메시지가 어떤 실행을 일으켰는지 추적 가능
- 실패/부분성공 테스트 가능

### Phase 4. 읽음 상태와 운영 규칙 수용

- `channel_member_states` 도입
- 마지막 읽은 메시지 저장
- 대표 멤버 또는 조율자 상태 저장

완료 기준:

- 채널별 읽지 않은 메시지 계산 가능
- 운영 규칙이 제품 데이터 모델로 일부 승격됨

### Phase 5. 렌더러 모듈화

- `renderer.ts` 상태/동기화/뷰 코드 분리
- 채널 상태 모듈 도입
- 채널 SSE 동기화 로직 별도 파일화
- 메시지 뷰 공통부 추출

완료 기준:

- 채널 관련 수정이 단일 모듈 경계 안에서 가능
- DM과 채널 회귀 범위 분리

### Phase 6. UX 확장

- 멘션 자동완성
- 메시지 종류 입력 UX
- 읽지 않음 표시
- 실행 이력 또는 핸드오프 정보 노출

이 단계는 구조 정리 후에 착수하는 것이 맞다.

## 11. 테스트 전략

리팩토링은 기능 추가보다 회귀 방지가 중요하므로 테스트 구조를 나눠야 한다.

### 11.1 Repository 단위 테스트

- 채널 생성/아카이브
- 멤버 추가/제거
- 멘션 저장
- 읽음 상태 저장
- 실행 job 저장/상태 변경

### 11.2 Service 단위 테스트

- 멘션 파싱
- 무멘션 메시지의 `log_only`
- 멘션 실행 큐 생성
- 재멘션 체인 깊이 제한
- 동일 에이전트 직렬화

### 11.3 E2E 회귀 테스트

- 채널 CRUD
- 채널 멤버 관리
- 멘션 응답
- 재멘션 체인
- 동시 요청 시 직렬화
- 낙관적 메시지 중복 방지

## 12. 최종 설계 판단

이번 채널 리팩토링의 핵심 판단은 두 가지다.

첫째, 채널은 단순 UI 기능이 아니라 "메시지 기록 + 멘션 라우팅 + 에이전트 실행 + 실시간 동기화"가 결합된 도메인이다. 따라서 라우트 파일이나 렌더러 전역 상태로 유지하면 이후 기능이 계속 엉킨다.

둘째, 지금 당장 DM/채널 전체를 추상적으로 통합하기보다, 채널 도메인을 먼저 독립 구조로 세우는 편이 더 현실적이다. 현재 이미 동작하는 기능이 많기 때문에, 보존해야 할 동작을 유지하면서 책임을 떼어내는 점진적 리팩토링이 가장 안전하다.
