# MPS · Menu Portal Solution

**주방 운영(Kitchen Control) 시스템.** POS가 주방프린터로 보내던 주문 정보를 화면(KDS)으로 받아 주방 파트(스테이션)별로 전송하고, 조리 → 완료 → 서빙까지 하나의 흐름으로 관리합니다.
본부의 표준 레시피와 표준 조리시간을 모든 가맹점에 똑같이 적용하고, 조리시간과 지연을 측정해 **음식 품질과 고객 서비스**를 관리합니다.

```
 POS ──(주방프린터 출력)──▶ 프린터 브릿지 에이전트 ──▶ MPS 서버 ──(실시간)──▶ 스테이션 KDS (그릴/국·찌개/튀김/찬/음료)
  └──(POS API 연동, 선택)─────────────────────────▶   │                         │ 품목 조리·완료(BUMP)
                                                     │                         ▼
                                                     └──────────────────▶ 패스(Expo) KDS ── 서빙 완료
                                                     │
                                       본부·지점·매장 관리 포털 (메뉴·레시피·스테이션·사용자·품질 분석)
```

## 구성

| 영역 | 기술 | 위치 |
|---|---|---|
| 프론트엔드 | React 18 + Vite, Socket.IO client | `web/` |
| 백엔드 | Node.js 22, Express 5, Socket.IO, Zod, JWT | `server/` |
| 데이터베이스 | PostgreSQL 16 (마이그레이션 SQL) | `server/db/migrations/` |
| 서버 시스템 | Docker 단일 이미지 + docker-compose, Nginx(HTTPS·WebSocket) | `Dockerfile`, `docker-compose.yml`, `deploy/` |
| 매장 연동 | 주방프린터 브릿지 에이전트(ESC/POS, CP949) · POS REST API | `agent/`, `/api/pos/*` |

## 운영 주체(역할)

| 역할 | 소속 조직 | 하는 일 |
|---|---|---|
| **개발팀** | 플랫폼 | 가맹본부(브랜드) 등록, 전체 시스템·디바이스 모니터링, 감사 로그 |
| **가맹본부** | 본부 | 마스터 메뉴·표준 레시피·표준 조리시간·조리 파트 지정, 지점/가맹점 개설, 전 매장 품질 분석, 공지 |
| **가맹지점** | 지점(지사) | 관할 가맹점 개설·관리, 매장 운영 지원, 지점 단위 품질 분석, 공지 |
| **가맹점(점주)** | 가맹점 | 스테이션 구성, 매장 메뉴(품절·스테이션 재지정·가격), 직원, POS/프린터 연결, 매장 분석 |
| **매니저** | 가맹점 | 영업 중 주방 흐름 통제(긴급·취소·강제서빙), 품절, 스텝 관리 |
| **스텝** | 가맹점 | KDS에서 조리/완료/리콜, 패스에서 서빙 처리 |

상위 조직은 하위 조직 전체를 조회·관리하며, 본인보다 낮은 역할만 생성할 수 있습니다. 자세한 권한표는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 빠른 시작 (로컬 개발)

필요: Node.js 22+, PostgreSQL 16

```bash
# 1) DB 준비
createuser -s mps && createdb -O mps mps && psql -c "ALTER USER mps PASSWORD 'mps'"

# 2) 설치 + 데모 데이터
npm run install:all
npm run seed            # 스키마 초기화 + 데모 조직/계정/메뉴/7일치 주문

# 3) 실행 (터미널 2개)
npm run dev:server      # http://localhost:4000  (API + Socket.IO)
npm run dev:web         # http://localhost:5173  (관리 포털 / KDS)
```

데모 계정 (개발 모드 로그인 화면에 버튼으로 표시)

| 역할 | 아이디 / 비밀번호 |
|---|---|
| 개발팀 | `dev` / `dev1234` |
| 가맹본부 | `hq` / `hq1234` |
| 가맹지점 | `branch` / `branch1234` (서울지사) |
| 가맹점 점주 | `owner` / `owner1234` (강남점) |
| 매니저 | `manager` / `manager1234` |
| 스텝 | `staff` / `staff1234` |

## 운영 배포 (Docker)

```bash
cp .env.example .env            # JWT_SECRET, DB_PASSWORD 변경
docker compose up -d --build
docker compose exec app node src/db/seed.js     # (선택) 데모 데이터
```

서버 시작 시 마이그레이션이 자동 적용됩니다. HTTPS는 `deploy/nginx.conf`를 참고하세요 (KDS 실시간 연결을 위해 WebSocket 업그레이드 설정이 필요합니다).

## 매장 연결: POS를 고치지 않는 방법

1. 관리 포털 → **POS · 프린터 연결** → 연결 키 발급(유형: 프린터 브릿지)
2. 매장 PC에서 에이전트 실행
   ```bash
   MPS_SERVER=https://mps.example.com MPS_DEVICE_KEY=mps_xxx \
   FORWARD_PRINTER=192.168.0.50:9100 node agent/printer-agent.js
   ```
3. POS 설정에서 주방프린터 IP를 매장 PC 주소(포트 9100)로 변경

에이전트는 ESC/POS 원본을 서버로 보내고(서버가 제어 명령 제거 → CP949 디코딩 → 테이블/주문번호/메뉴/수량/옵션/요청사항/포장·배달/취소 전표 해석), `FORWARD_PRINTER`가 설정되면 실제 프린터로도 그대로 출력해 종이 백업을 유지합니다. 서버 장애 시 전표를 로컬에 저장했다가 재전송하며, 같은 전표의 중복 주문은 서버가 막습니다.
POS사가 API 연동을 지원하면 `POST /api/pos/orders`로 직접 보낼 수도 있습니다 ([docs/API.md](docs/API.md)).

전표 해석 결과는 **POS 연동 · 테스트 → 주방프린터 전표 테스트**에서 미리 확인할 수 있습니다. 해석하지 못한 줄은 버리지 않고 `[미확인]` 메모로 주방에 그대로 보여 줍니다.

## 주방 흐름

1. 주문 수신 → 메뉴별 **조리 파트**로 자동 분배 (매장 재지정 > 본부 조리 파트 유형 > 기본 스테이션)
2. 스테이션 KDS: 품목 탭으로 `대기 → 조리중 → 완료`, **BUMP**로 티켓 일괄 완료, **리콜**로 되돌리기
   - 경과시간/표준시간 비율로 색상 표시 (70% 미만 초록, 70% 이상 주황, 초과 시 빨강 깜빡임), 긴급 주문 상단 고정
   - **레시피** 버튼으로 본부 표준 레시피 확인
3. 모든 파트가 완료되면 패스(Expo) 화면의 **서빙 대기**로 이동 → **서빙 완료**
4. 접수·조리시작·완료·서빙 시각이 모두 기록되어 **운영 품질 분석**(평균 조리완료 시간, 패스 대기, 표준시간 초과율, 스테이션·메뉴·시간대·매장별)에 반영됩니다.

## 테스트

```bash
npm test     # server: 파서 단위 테스트 + API 통합 테스트 (로컬 PostgreSQL 필요, DB를 초기화함)
```

## 디렉터리

```
server/  src/{routes,services,auth,realtime,db}  db/migrations  test/
web/     src/{pages,components}
agent/   printer-agent.js
deploy/  nginx.conf
docs/    ARCHITECTURE.md  API.md
```
