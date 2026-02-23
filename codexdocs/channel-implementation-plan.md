# 채널 구현 계획 (channel-methodology 기반)

## 1) 목적
- `codexdocs/channel-methodology.md`의 운영 원칙을 현재 코드베이스에 구현 가능한 형태로 전환한다.
- DM 중심 구조를 유지하면서 채널 기능을 점진적으로 추가한다.

## 2) 확정 구현 원칙
1. 멘션 기준은 `@표시명(name)`으로 한다.
2. 멤버 표시명(`agents.name`)은 중복 불가로 강제한다.
3. 무멘션 메시지는 저장만 하고 실행하지 않는다. (옵션 B)
4. 멘션된 에이전트만 실행한다.
5. 동일 에이전트 동시 실행은 금지한다. (`withAgentLock` 유지)
6. DM과 채널 저장/조회/실행 책임을 분리한다.

## 3) 현재 상태 (요약)
- 백엔드 DB는 `agents`, `messages` 중심이며 채널 테이블이 없다.
- 백엔드 API는 DM 흐름(`api/agents/*`) 위주다.
- 렌더러는 채널 UI 상태를 로컬 메모리로만 관리하고 채널 대화는 비활성화 상태다.

## 4) 목표 아키텍처
- 저장소:
  - DM: 기존 `messages` 유지
  - 채널: 신규 `channels`, `channel_members`, `channel_messages`, `channel_message_mentions`
- 실행:
  - 메시지 저장 후 멘션 파싱
  - 멘션 대상만 실행
  - 대상별 `withAgentLock` 직렬화, 대상 간 병렬 허용
- UI:
  - 로컬 채널 상태 제거
  - 채널 목록/멤버/메시지 전부 API 연동

## 5) 데이터 모델 계획
### 5.1 `agents` 확장
- `name`: unique (case-insensitive)
- (선택) `role_profile`: 역할 프로필(강점/한계) 텍스트

### 5.2 신규 테이블
1. `channels`
- `id`, `name`, `description`, `created_at`, `archived_at(nullable)`

2. `channel_members`
- `channel_id`, `agent_id`, `joined_at`
- unique: (`channel_id`, `agent_id`)

3. `channel_messages`
- `id`, `channel_id`, `sender_type(user|agent|system)`, `sender_id(nullable)`, `content`, `message_kind(request|progress|result|remention|general)`, `created_at`

4. `channel_message_mentions`
- `message_id`, `agent_id`, `mention_name`, `created_at`
- unique: (`message_id`, `agent_id`)

## 6) API 계획
### 6.1 채널 관리
- `GET /api/channels`
- `POST /api/channels`
- `PATCH /api/channels/:channelId`
- `DELETE /api/channels/:channelId` (archive 권장)

### 6.2 채널 멤버
- `GET /api/channels/:channelId/members`
- `POST /api/channels/:channelId/members`
- `DELETE /api/channels/:channelId/members/:agentId`

### 6.3 채널 메시지
- `GET /api/channels/:channelId/messages`
- `POST /api/channels/:channelId/messages`
  - 입력: `content`, `messageKind(optional)`
  - 동작:
    1) 메시지 저장
    2) `@표시명` 파싱
    3) 멘션 매핑 저장
    4) 멘션 없으면 저장-only 반환
    5) 멘션 있으면 대상 에이전트 실행 후 결과를 채널 메시지로 추가

## 7) 멘션/실행 규칙 상세
1. 파싱 규칙
- 패턴: `@{name}` (`name`은 `agents.name`과 case-insensitive 일치)
- 중복 멘션은 1회로 정규화

2. 라우팅 규칙
- 무멘션: `executedAgents=[]`, `executionMode="log_only"`
- 멘션 있음: `executedAgents=[...]`, `executionMode="mention_only"`

3. 실패 규칙
- 일부 에이전트 실패 시 해당 실패를 `system` 채널 메시지로 남기고 나머지는 계속 수행
- 요청 단위는 200 반환 + 실행 결과 상세(payload) 포함

## 8) 렌더러 구현 계획
1. 채널 상태 전환
- `channels[]` 로컬 생성/수정/삭제 로직 제거
- 채널 CRUD를 API 호출로 교체

2. 채널 메시지 활성화
- 채널 선택 시 composer 활성화
- 전송 시 `/api/channels/:id/messages` 호출
- 채널 타임라인 렌더링 공용화(DM/채널)

3. 멘션 UX
- `@` 입력 시 채널 멤버 표시명 자동완성
- 표시명 중복이 불가능하므로 선택 결과는 1:1 매핑

4. 입력 검증 UX
- 중복 표시명: 상단 배너 대신 팝업 필드 에러(현재 적용 방식 유지)

## 9) 단계별 작업 순서
### Phase 1: DB/타입/Repository
- 채널 스키마 추가
- DB 접근 메서드 추가
- 타입 정의 추가 (`Channel`, `ChannelMessage`, `ChannelMember`)

### Phase 2: API
- 채널 CRUD/멤버/메시지 엔드포인트 추가
- 멘션 파서 + 실행 라우터 추가

### Phase 3: Renderer 연동
- 채널 목록/멤버/메시지 API 전환
- 채널 composer 활성화
- 멘션 자동완성 1차

### Phase 4: 안정화
- 에러/타임아웃/부분 실패 처리 보강
- 성능 점검(메시지 로딩/렌더링)

## 10) 테스트 계획
1. 단위/통합
- 중복 표시명 생성/수정 차단
- 무멘션 저장-only 검증
- 멘션 대상 실행 검증
- 동일 에이전트 동시 요청 직렬화 검증

2. E2E
- 채널 생성 -> 멤버 추가 -> 멘션 전송 -> 결과 메시지 확인
- 무멘션 전송 -> 실행 없음 확인
- DM 동작 회귀 확인

3. 품질 게이트
- `npm run check`
- `npm run build`
- `npm run start` 수동 스모크
- `npm run test:e2e`

## 11) 리스크 및 대응
1. 표시명 기반 멘션 파싱 오탐
- 대응: 멘션 토큰 규칙 고정, 자동완성 선택형 UX 제공

2. 에이전트 응답 지연/실패
- 대응: 채널 시스템 메시지로 상태 공개, 부분 실패 허용

3. 초기 데이터 마이그레이션
- 대응: `CREATE TABLE IF NOT EXISTS` + 안전한 점진 마이그레이션

## 12) 완료 기준 (DoD)
- 채널 메시지가 DB에 저장된다.
- 무멘션 메시지는 실행되지 않는다.
- 멘션된 에이전트만 실행된다.
- 동일 에이전트 동시 실행이 발생하지 않는다.
- 렌더러 채널 UI가 백엔드 데이터와 동기화된다.
- 기존 DM 기능 회귀가 없다.
