CREATE TABLE slot_monitor_state (
  city         TEXT NOT NULL,
  exam_type    TEXT NOT NULL,
  slots        JSONB NOT NULL DEFAULT '[]',
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at  TIMESTAMPTZ,
  PRIMARY KEY (city, exam_type)
);
