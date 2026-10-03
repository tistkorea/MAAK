# MPS 아키텍처

## 1. 시스템 구성

```
[매장]                                   [클라우드 / 서버]                          [사용자]
POS ─ESC/POS─▶ printer-agent ─HTTPS─▶  ┌──────────────────────────────┐
           (실제 프린터로 패스스루)      │ Node.js (Express 5)          │◀── 관리 포털 (본부·지점·매장)
POS ─REST(JSON)───────────────────────▶ │  /api/pos/*   디바이스 키    │
                                         │  /api/*       JWT + RBAC     │
                                         │  Socket.IO    store:{id} 룸  │──▶ KDS 스테이션 / 패스 화면
                                         └──────────────┬───────────────┘
                                                        │
                                                 PostgreSQL 16
```

- **단일 프로세스**가 REST API, 실시간(Socket.IO), 빌드된 프론트엔드 정적 파일을 함께 제공합니다. 매장이 늘면 Socket.IO Redis 어댑터를 붙여 수평 확장할 수 있습니다.
- KDS 화면은 소켓 이벤트(`order:created`, `order:updated`, `menu:changed`, `stations:changed`)로 즉시 갱신되며, 재연결 시 전체 재조회 + 30초 주기 동기화로 이벤트 유실에 대비합니다.

## 2. 조직 계층과 권한 범위

`organizations` 한 테이블에 `platform > hq > branch > store` 계층을 저장하고, 트리거가 `path`(`/1/2/5/`)를 계산합니다.
사용자는 **자기 조직 path로 시작하는 조직**에만 접근할 수 있습니다 (`services/scope.js`).

| 상위 \ 생성 가능 | hq | branch | store |
|---|---|---|---|
| platform(개발팀) | ✔ | | |
| hq(가맹본부) | | ✔ | ✔ (본부 직영) |
| branch(가맹지점) | | | ✔ |

### 역할별 권한 (`server/src/auth/rbac.js`)

| 권한 | 개발팀 | 가맹본부 | 가맹지점 | 가맹점 | 매니저 | 스텝 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| system:manage 시스템 모니터링 | ✔ | | | | | |
| audit:view 감사 로그 | ✔ | ✔ | | | | |
| org:view / org:manage 조직 | ✔/✔ | ✔/✔ | ✔/✔ | ✔/ | | |
| user:manage 사용자(하위 역할만) | ✔ | ✔ | ✔ | ✔ | ✔ | |
| menu:master 마스터 메뉴·레시피 | ✔ | ✔ | | | | |
| menu:view 메뉴·레시피 조회 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| menu:store 품절·스테이션 재지정 | ✔ | ✔ | ✔ | ✔ | ✔ | |
| station:manage 스테이션 | ✔ | ✔ | ✔ | ✔ | ✔ | |
| kds:operate 조리·서빙 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| order:manage 취소·긴급·강제서빙 | ✔ | ✔ | ✔ | ✔ | ✔ | |
| order:create 수동주문·POS 테스트 | ✔ | ✔ | | ✔ | ✔ | |
| device:manage POS·프린터 키 | ✔ | ✔ | | ✔ | ✔ | |
| analytics:view 품질 분석 | ✔ | ✔ | ✔ | ✔ | ✔ | |
| notice:publish 공지 | ✔ | ✔ | ✔ | ✔ | | |

사용자 생성/수정 규칙: 본인보다 **낮은 역할**만(개발팀 제외), 역할과 조직 유형 일치(점주·매니저·스텝은 store 소속).

## 3. 데이터 모델

| 테이블 | 설명 |
|---|---|
| organizations | 조직 계층 (path, status: active/suspended/closed) |
| users | 로그인 계정, 역할, 소속 조직 |
| stations | 매장 주방 파트. `type`(grill/soup/fry/cold/drink…), `is_expo`(패스), `is_default` |
| menu_categories, menu_items | 본부 마스터 메뉴. `code`(POS 코드), `aliases`(프린터 출력명), `station_type`, `target_minutes`(표준 조리시간), `recipe`(JSON 단계) |
| store_menu_items | 매장 운영값: 품절, 스테이션 재지정, 판매가 |
| orders | 주문. 상태 `received → cooking → ready → served` (또는 cancelled), 인원 `guest_count`, 유입경로 `source`(pos/printer/table_order/manual), `external_id`로 중복 방지, `raw_ticket` 원문 |
| order_items | 주문 품목. `station_id`, 상태 `pending → cooking → partial → ready(호출) → served(완료)` / `cancelled`, 수량 `done_qty`·`cancel_qty`, `started_at/done_at/served_at/done_by`, 기준시간 `min_minutes~target_minutes` 스냅샷 |
| order_item_events | **조리 진행 이력**: 접수·대기·조리중·일부완료·호출·완료·부분취소·취소·되돌림·긴급 이벤트를 시각·수량·작업자·사유와 함께 기록 (분석 원천) |
| service_requests | 직원 호출·고객 요청 (테이블, 유형, 출처, 접수→확인→처리 시각, 처리자) |
| devices | POS/프린터 에이전트 키 (SHA-256 해시만 저장) |
| notices | 공지 (발행 조직의 하위 전체에 노출) |
| audit_logs | 감사 로그 |

### 품목 상태와 수량
| 상태 | 의미 | 조건 |
|---|---|---|
| pending 대기 | 조리 전 | |
| cooking 조리중 | 조리 시작 (started_at) | |
| partial 일부완료 | 일부 수량 완료 | 0 < done_qty < qty − cancel_qty |
| ready 호출 | 조리완료, 홀 픽업 호출 (done_at) | done_qty = qty − cancel_qty |
| served 완료 | 제공 완료 (served_at) | |
| cancelled 취소 | 전체 취소 | cancel_qty = qty |

부분취소는 `cancel_qty`를 늘리며, 미조리 수량부터 차감합니다. 제공된 품목은 취소할 수 없습니다.

### 주문 상태 계산
품목 상태로 주문 상태를 다시 계산합니다 (`services/orderService.js#recompute`).
- 모든 품목 완료(제공) → `served` / 모두 호출 이상 → `ready` / 하나라도 진행 → `cooking` / 모두 대기 → `received`
- 패스의 서빙 완료는 `ready`에서만 가능(매니저 이상은 강제 서빙), 되돌리기 시 주문이 다시 열립니다

### 스테이션 라우팅
`매장 재지정(store_menu_items.station_id)` → `본부 조리 파트 유형과 같은 type의 스테이션` → `기본 스테이션` → `첫 조리 스테이션`. 마스터에 없는 메뉴(프린터 전표의 미등록 품목)도 기본 스테이션으로 전송됩니다.

## 4. 주방프린터 전표 처리 (`services/printerParser.js`)

1. **ESC/POS 제거**: ESC/GS/FS/DLE 명령과 파라미터, 비트·래스터 이미지, 바코드/QR, 용지 커트 제거
2. **디코딩**: 기본 CP949(EUC-KR), 디바이스별 `X-Encoding` 지정 가능
3. **해석**: 테이블·주문번호·포장/배달·취소 전표·긴급·요청사항 헤더, `메뉴 수량`/`메뉴 x수량`/`수량 x 메뉴`/`메뉴 수량 금액` 형식, 들여쓰기·`-`·`└` 옵션 라인
4. **메뉴 매칭**: 공백/기호를 제거한 이름으로 POS 코드 → 메뉴명 → 출력명(aliases) 순 매칭
5. 취소 전표는 같은 POS 주문번호의 진행 중 주문을 취소, 판독 불가 라인은 `[미확인]` 메모로 보존

## 5. 품질 지표 (`routes/analytics.js`)

README의 9개 분석 영역 표를 참고하세요. 주요 정의는 다음과 같습니다.

| 지표 | 정의 |
|---|---|
| 평균 조리완료 시간 | `ready_at - created_at` |
| 평균 패스 대기 | `served_at - ready_at` (조리 후 서빙까지 음식이 식는 시간) |
| 표준시간 초과율 | 조리완료 시간이 주문 표준시간(품목 표준시간의 최댓값)을 넘은 비율 |
| 스테이션별 | 평균 조리(`done - started`), 접수부터 완료까지, 초과율 |
| 픽업 대기 | `served_at - done_at` (품목 단위, 호출 후 홀이 가져가기까지) |
| 테이블 동시제공 편차 | 같은 주문 내 품목 `done_at`의 최댓값 − 최솟값 |
| 과속률 / 지연률 | 조리시간(`done_at - started_at`)이 기준 하한 미만 / 상한 초과인 비율 |
| 조리 후 취소 | 취소 이벤트 시각이 품목 `started_at` 이후인 수량 (손실) |
| 작업자 지표 | 이벤트의 `user_id` 기준 조리·제공 수량, `done_by` 기준 평균 조리시간·지연률 |
| 메뉴 조합 | 같은 주문에 함께 담긴 메뉴 쌍의 주문 수 |

## 6. 보안

- 비밀번호 bcrypt, JWT(기본 12시간), 매 요청마다 사용자 활성 상태 재확인
- 디바이스 키는 발급 시 1회만 노출, DB에는 SHA-256 해시 저장, 매장이 중지되면 키도 거부
- 모든 입력은 Zod 스키마로 검증, SQL은 파라미터 바인딩
- 운영 모드에서 기본 JWT_SECRET 사용 시 서버가 시작되지 않음
