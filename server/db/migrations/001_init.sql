-- MPS (Menu Portal Solution) - Kitchen Control System 초기 스키마
-- 조직 계층: platform(개발팀) > hq(가맹본부) > branch(가맹지점/지사) > store(가맹점)

CREATE TABLE organizations (
  id          SERIAL PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('platform','hq','branch','store')),
  parent_id   INT REFERENCES organizations(id) ON DELETE RESTRICT,
  path        TEXT NOT NULL DEFAULT '',          -- '/1/3/7/' 형태의 조상 경로 (권한 범위 계산용)
  name        TEXT NOT NULL,
  code        TEXT UNIQUE,
  address     TEXT,
  phone       TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_org_path ON organizations (path text_pattern_ops);
CREATE INDEX idx_org_parent ON organizations (parent_id);

CREATE FUNCTION org_set_path() RETURNS trigger AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path := '/' || NEW.id || '/';
  ELSE
    SELECT path || NEW.id || '/' INTO NEW.path FROM organizations WHERE id = NEW.parent_id;
    IF NEW.path IS NULL THEN
      RAISE EXCEPTION 'parent organization % not found', NEW.parent_id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_org_path BEFORE INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION org_set_path();

CREATE TABLE users (
  id             SERIAL PRIMARY KEY,
  org_id         INT NOT NULL REFERENCES organizations(id),
  role           TEXT NOT NULL CHECK (role IN ('developer','hq_admin','branch_admin','store_owner','manager','staff')),
  login_id       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  name           TEXT NOT NULL,
  phone          TEXT,
  active         BOOLEAN NOT NULL DEFAULT true,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_org ON users (org_id);

-- 매장 주방 파트(스테이션): 그릴, 국/찌개, 튀김, 찬, 음료, 패스(expo) 등
CREATE TABLE stations (
  id          SERIAL PRIMARY KEY,
  store_id    INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#3b82f6',
  is_expo     BOOLEAN NOT NULL DEFAULT false,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  sort_order  INT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stations_store ON stations (store_id);

-- 가맹본부 마스터 메뉴
CREATE TABLE menu_categories (
  id          SERIAL PRIMARY KEY,
  hq_id       INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  UNIQUE (hq_id, name)
);

CREATE TABLE menu_items (
  id              SERIAL PRIMARY KEY,
  hq_id           INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category_id     INT REFERENCES menu_categories(id) ON DELETE SET NULL,
  code            TEXT NOT NULL,                     -- POS 상품코드
  name            TEXT NOT NULL,
  aliases         TEXT[] NOT NULL DEFAULT '{}',      -- 주방프린터 출력명 변형(약칭 등)
  price           INT NOT NULL DEFAULT 0,
  station_type    TEXT NOT NULL DEFAULT 'main',      -- 기본 조리 파트
  target_minutes  INT NOT NULL DEFAULT 10,           -- 표준 조리시간(품질 SLA)
  recipe          JSONB NOT NULL DEFAULT '[]'::jsonb,-- 조리 매뉴얼 단계
  allergens       TEXT[] NOT NULL DEFAULT '{}',
  description     TEXT,
  active          BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hq_id, code)
);

-- 가맹점별 메뉴 운영값(품절, 스테이션 라우팅, 가격)
CREATE TABLE store_menu_items (
  store_id      INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  menu_item_id  INT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  sold_out      BOOLEAN NOT NULL DEFAULT false,
  station_id    INT REFERENCES stations(id) ON DELETE SET NULL,
  price         INT,
  PRIMARY KEY (store_id, menu_item_id)
);

CREATE TABLE orders (
  id              SERIAL PRIMARY KEY,
  store_id        INT NOT NULL REFERENCES organizations(id),
  display_no      TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('pos','printer','manual')),
  external_id     TEXT,                              -- POS 주문 고유키(중복 수신 방지)
  pos_order_no    TEXT,
  table_no        TEXT,
  order_type      TEXT NOT NULL DEFAULT 'dine_in' CHECK (order_type IN ('dine_in','takeout','delivery')),
  status          TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','cooking','ready','served','cancelled')),
  rush            BOOLEAN NOT NULL DEFAULT false,
  memo            TEXT,
  target_minutes  INT NOT NULL DEFAULT 10,
  raw_ticket      TEXT,
  created_by      INT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  ready_at        TIMESTAMPTZ,
  served_at       TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ
);
CREATE INDEX idx_orders_store_created ON orders (store_id, created_at DESC);
CREATE INDEX idx_orders_store_status ON orders (store_id, status);
CREATE UNIQUE INDEX uq_orders_external ON orders (store_id, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE order_items (
  id              SERIAL PRIMARY KEY,
  order_id        INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id    INT REFERENCES menu_items(id) ON DELETE SET NULL,
  station_id      INT REFERENCES stations(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  qty             INT NOT NULL DEFAULT 1 CHECK (qty > 0),
  options         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cooking','done','cancelled')),
  target_minutes  INT NOT NULL DEFAULT 10,
  started_at      TIMESTAMPTZ,
  done_at         TIMESTAMPTZ,
  done_by         INT REFERENCES users(id)
);
CREATE INDEX idx_order_items_order ON order_items (order_id);
CREATE INDEX idx_order_items_station ON order_items (station_id, status);

-- POS / 프린터 브릿지 에이전트 / KDS 단말
CREATE TABLE devices (
  id            SERIAL PRIMARY KEY,
  store_id      INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('pos','printer_agent','kds')),
  key_prefix    TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  active        BOOLEAN NOT NULL DEFAULT true,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notices (
  id          SERIAL PRIMARY KEY,
  org_id      INT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_id   INT REFERENCES users(id),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  pinned      BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id),
  org_id      INT REFERENCES organizations(id),
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  detail      JSONB,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_logs (created_at DESC);
