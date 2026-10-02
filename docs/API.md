# MPS API

기본 경로 `/api`. 사용자 API는 `Authorization: Bearer <JWT>`, 매장 연동 API는 `X-Device-Key: <키>` 헤더를 사용합니다.
오류 응답: `{ "error": "메시지", "detail": [...] }`

## 인증
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | /auth/login | `{loginId, password}` → `{token}` |
| GET | /auth/me | 사용자, 권한 목록, 접근 가능한 매장 |
| POST | /auth/password | `{current, next}` |

## 조직 · 사용자
| 메서드 | 경로 | 권한 |
|---|---|---|
| GET | /orgs | org:view (내 범위 전체) |
| POST | /orgs | org:manage `{parentId, type, name, code?, address?, phone?}` |
| PATCH | /orgs/:id | org:manage (status: active/suspended/closed) |
| GET | /users?orgId= | user:manage |
| POST | /users | `{orgId, role, loginId, password, name}` |
| PATCH | /users/:id | `{name?, role?, active?, password?}` |

## 메뉴
| 메서드 | 경로 | 권한 |
|---|---|---|
| GET | /menus?hqId= | menu:view (생략 시 소속 본부) |
| POST | /menus/categories | menu:master |
| POST | /menus/items | menu:master `{hqId, code, name, aliases[], price, stationType, targetMinutes, recipe[], allergens[]}` |
| PATCH | /menus/items/:id | menu:master |

## 매장 (`/stores/:storeId/...`)
| 메서드 | 경로 | 권한 |
|---|---|---|
| GET/POST | /stations | 조회: 매장 접근 / 등록: station:manage |
| PATCH | /stations/:id | station:manage (active=false 로 비활성화) |
| GET | /menu | 매장 메뉴(본부 마스터 + 품절/스테이션/가격) |
| PUT | /menu/:menuItemId | menu:store `{soldOut?, stationId?, price?}` |
| GET | /orders?scope=active\|all&date=YYYY-MM-DD | kds:operate |
| POST | /orders | order:create (수동 주문) |
| POST | /print-test | order:create `{text, commit?}` 전표 파싱 미리보기/생성 |
| GET/POST | /devices | device:manage (POST 응답의 `key`는 1회만 노출) |
| PATCH | /devices/:id | `{active}` |

## KDS 처리 (`kds:operate`)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /orders/:id | 주문 상세 |
| POST | /orders/items/:itemId/start\|done\|recall\|cancel | 품목 상태 변경 (cancel은 order:manage) |
| POST | /orders/:id/bump | `{stationId?}` 스테이션 품목 일괄 완료 (생략 시 전체) |
| POST | /orders/:id/recall | `{stationId?}` 완료 품목 되돌리기 |
| POST | /orders/:id/serve | `{force?}` 서빙 완료 (force는 order:manage) |
| POST | /orders/:id/unserve | 서빙 되돌리기 |
| POST | /orders/:id/cancel | order:manage |
| POST | /orders/:id/rush | order:manage `{rush}` |

## 분석 · 공지 · 시스템
| 메서드 | 경로 | 권한 |
|---|---|---|
| GET | /analytics/summary?orgId=&from=&to= | analytics:view |
| GET/POST | /notices | 조회: 전체 / 발행: notice:publish |
| DELETE | /notices/:id | notice:publish |
| GET | /audit-logs?limit= | audit:view |
| GET | /system/stats | system:manage |
| GET | /health | 공개 |

## 매장 연동 (X-Device-Key)

### POS 주문 전송
```http
POST /api/pos/orders
X-Device-Key: mps_xxx
Content-Type: application/json

{
  "externalId": "POS-20261002-0001",      // 중복 전송 방지 키 (권장)
  "posOrderNo": "0012", "tableNo": "5", "orderType": "dine_in",
  "memo": "수저 추가", "rush": false,
  "items": [ { "code": "M003", "name": "된장찌개", "qty": 1, "options": "덜맵게" } ]
}
```
응답 `201 {id, displayNo, duplicate:false}` / 같은 externalId 재전송 시 `200 {duplicate:true}`

### POS 주문 취소
`POST /api/pos/orders/cancel` `{ "posOrderNo": "0012" }`

### 주방프린터 원본 전송 (브릿지 에이전트)
```http
POST /api/pos/print
X-Device-Key: mps_xxx
X-Encoding: euc-kr
X-Job-Id: 3f2a...            (중복 방지)
Content-Type: application/octet-stream

<ESC/POS 원본 바이트>
```
또는 JSON `{ "data": "<base64>", "encoding": "euc-kr", "jobId": "..." }`
응답 `{ action: created|duplicate|cancelled|ignored, orderId, displayNo, items, reason }`

## 실시간 (Socket.IO)
```js
const socket = io({ auth: { token } });
socket.emit('store:join', { storeId }, (ack) => ack.ok);
socket.on('order:created', (order) => {});
socket.on('order:updated', (order) => {});
socket.on('menu:changed', () => {});
socket.on('stations:changed', () => {});
```
