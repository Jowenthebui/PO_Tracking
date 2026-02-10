PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS months (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_key TEXT UNIQUE NOT NULL,         -- e.g. 2026-02
  label TEXT NOT NULL,                    -- e.g. Jan 2026
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS po_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_id INTEGER NOT NULL,
  folder_name TEXT NOT NULL,              -- e.g. 2026-02-IT-001_Capex_Hello World
  capex_opex TEXT CHECK (capex_opex IN ('CAPEX','OPEX')) NOT NULL,
  it_ref_no TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (month_id) REFERENCES months(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_po_unique_in_month
ON po_folders(month_id, folder_name);

CREATE TABLE IF NOT EXISTS po_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL,
  step_no INTEGER NOT NULL,               -- 1..9
  step_title TEXT NOT NULL,
  step_desc TEXT NOT NULL,

  is_done INTEGER NOT NULL DEFAULT 0,      -- 0/1 (computed)
  action_done INTEGER NOT NULL DEFAULT 0,  -- checkbox for steps 4/5/6/8/9

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  FOREIGN KEY (po_id) REFERENCES po_folders(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_step_unique
ON po_steps(po_id, step_no);

-- NEW: Multiple files per step
CREATE TABLE IF NOT EXISTS po_step_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,

  FOREIGN KEY (step_id) REFERENCES po_steps(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_files_step
ON po_step_files(step_id);
