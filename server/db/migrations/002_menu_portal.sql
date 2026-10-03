-- MENU PORTAL: 테이블 단위 관리, 수량 단위 진행(일부완료/부분취소), 호출 상태,
-- 조리 진행 이력(작업자), 인원수·유입경로, 직원 호출/고객 요청

-- 메뉴 기준 조리시간 범위 (예: 4~6분) — target_minutes 가 상한, min_minutes 가 하한
ALTER TABLE menu_items ADD COLUMN min_minutes INT;

-- 주문: 인원수, 테이블오더 유입경로
ALTER TABLE orders ADD COLUMN guest_count INT CHECK (guest_count IS NULL OR guest_count > 0);
ALTER TABLE orders DROP CONSTRAINT orders_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('pos','printer','manual','table_order'));

-- 주문 품목: 수량 단위 진행
--   pending(대기) → cooking(조리중) → partial(일부완료) → ready(호출: 조리완료·홀 픽업 호출) → served(완료: 제공)
--   cancelled(취소). 부분취소는 cancel_qty 로 표현
ALTER TABLE order_items DROP CONSTRAINT order_items_status_check;
UPDATE order_items i SET status = CASE WHEN o.status = 'served' THEN 'served' ELSE 'ready' END
  FROM orders o WHERE o.id = i.order_id AND i.status = 'done';
ALTER TABLE order_items ADD CONSTRAINT order_items_status_check
  CHECK (status IN ('pending','cooking','partial','ready','served','cancelled'));
ALTER TABLE order_items ADD COLUMN done_qty INT NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN cancel_qty INT NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN served_at TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN cancel_reason TEXT;
ALTER TABLE order_items ADD COLUMN min_minutes INT;
UPDATE order_items SET done_qty = qty WHERE status IN ('ready','served');
UPDATE order_items i SET served_at = o.served_at FROM orders o WHERE o.id = i.order_id AND i.status = 'served';
UPDATE order_items SET cancel_qty = qty WHERE status = 'cancelled';
ALTER TABLE order_items ADD CONSTRAINT order_items_progress_check
  CHECK (cancel_qty BETWEEN 0 AND qty AND done_qty BETWEEN 0 AND qty - cancel_qty);

-- 조리 진행 이력: 모든 상태 변경을 수량·작업자와 함께 기록 (분석의 원천 데이터)
CREATE TABLE order_item_events (
  id          BIGSERIAL PRIMARY KEY,
  store_id    INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  order_id    INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id     INT REFERENCES order_items(id) ON DELETE CASCADE,
  event       TEXT NOT NULL CHECK (event IN ('received','pending','cooking','partial','ready','served',
                                             'partial_cancel','cancelled','recall','rush')),
  qty         INT,
  user_id     INT REFERENCES users(id),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_item_events_item ON order_item_events (item_id, id);
CREATE INDEX idx_item_events_store_time ON order_item_events (store_id, created_at);

-- 직원 호출 / 고객 요청
CREATE TABLE service_requests (
  id          SERIAL PRIMARY KEY,
  store_id    INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  table_no    TEXT,
  order_id    INT REFERENCES orders(id) ON DELETE SET NULL,
  type        TEXT NOT NULL CHECK (type IN ('staff_call','customer_request')),
  category    TEXT,                 -- 물/앞접시/추가반찬/재촉/계산/기타 등
  message     TEXT,
  source      TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','table_order','pos')),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','ack','done','cancelled')),
  created_by  INT REFERENCES users(id),
  handled_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ack_at      TIMESTAMPTZ,
  done_at     TIMESTAMPTZ
);
CREATE INDEX idx_requests_store ON service_requests (store_id, status, created_at DESC);

-- 테이블오더 단말 (주문·고객 요청을 직접 전송)
ALTER TABLE devices DROP CONSTRAINT devices_type_check;
ALTER TABLE devices ADD CONSTRAINT devices_type_check CHECK (type IN ('pos','printer_agent','kds','table_order'));
