-- ============================================================================
--  D1 数据库建表脚本（处方表迁移 P0）
--
--  执行：wrangler d1 execute tcm-prescriptions-db --file=functions/api/_lib/schema.sql
--  本地：wrangler d1 execute tcm-prescriptions-db --local --file=functions/api/_lib/schema.sql
-- ============================================================================

-- 处方主表（替代 KV clinic:{id}:prescriptions:{yymmdd} 多 key）
CREATE TABLE IF NOT EXISTS prescriptions (
  id              TEXT PRIMARY KEY,
  clinic_id       TEXT NOT NULL,
  patient_name    TEXT,
  doctor_name     TEXT,
  created_by      TEXT NOT NULL,
  date            TEXT NOT NULL,           -- YYYY-MM-DD
  prescription_no TEXT,                    -- 处方编号（yyyymmdd + 序号）
  outpatient_no   TEXT,
  diagnosis       TEXT,
  items           TEXT,                    -- JSON 药材列表
  total_amount    REAL DEFAULT 0,
  fee_status      TEXT DEFAULT 'unpaid',   -- unpaid / paid
  paid_at         TEXT,
  paid_by         TEXT,
  pay_method      TEXT,
  media_files     TEXT,                    -- JSON
  extra           TEXT,                    -- JSON 扩展字段
  created_at      TEXT NOT NULL,
  updated_at      TEXT,
  deleted_at      TEXT,                    -- 软删除（回收站），NULL=正常
  deleted_by      TEXT
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_rx_clinic_date    ON prescriptions(clinic_id, date);
CREATE INDEX IF NOT EXISTS idx_rx_clinic_created ON prescriptions(clinic_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rx_clinic_doctor  ON prescriptions(clinic_id, created_by);
CREATE INDEX IF NOT EXISTS idx_rx_clinic_fee     ON prescriptions(clinic_id, fee_status);
CREATE INDEX IF NOT EXISTS idx_rx_clinic_deleted ON prescriptions(clinic_id, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rx_no_unique ON prescriptions(clinic_id, prescription_no) WHERE prescription_no IS NOT NULL;

-- 处方编号序号表（替代 KV clinic:{id}:prescription_seq:{yymmdd}）
CREATE TABLE IF NOT EXISTS prescription_seq (
  clinic_id TEXT NOT NULL,
  yymmdd    TEXT NOT NULL,
  seq       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (clinic_id, yymmdd)
);

-- ============================================================================
--  P1：审计日志表（替代 KV audit_log:{cid}:{date}:{ts} 多 key）
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id   TEXT NOT NULL,
  username    TEXT,
  role        TEXT,
  action      TEXT,
  target      TEXT,
  ip          TEXT,
  user_agent  TEXT,
  extra       TEXT,                    -- JSON
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_clinic_time ON audit_logs(clinic_id, created_at);
