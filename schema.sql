PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS po_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Identity
  it_ref_no TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  capex_opex TEXT CHECK (capex_opex IN ('CAPEX','OPEX')) NOT NULL,
  form_name TEXT,
  vendor TEXT,
  amount REAL,
  currency TEXT DEFAULT 'MYR',
  requestor TEXT,
  manager TEXT,

  -- Workflow
  stage TEXT NOT NULL,
  next_action TEXT,
  owner_role TEXT CHECK (owner_role IN ('INTERN','ADMIN','MANAGER','VENDOR')) NOT NULL DEFAULT 'INTERN',
  priority TEXT CHECK (priority IN ('LOW','MED','HIGH')) NOT NULL DEFAULT 'MED',

  -- Dates (ISO strings)
  quote_requested_at TEXT,
  quote_received_at TEXT,
  signed_at TEXT,
  uploaded_at TEXT,
  po_received_at TEXT,
  invoice_received_at TEXT,
  payment_requested_at TEXT,
  payment_completed_at TEXT,

  -- Links
  sharepoint_folder_url TEXT,
  signed_pdf_url TEXT,
  po_doc_url TEXT,
  invoice_url TEXT,
  payment_slip_url TEXT,

  -- Meta
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS po_activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_request_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  from_stage TEXT,
  to_stage TEXT,
  note TEXT,
  changed_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (po_request_id) REFERENCES po_requests(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_po_stage ON po_requests(stage);
CREATE INDEX IF NOT EXISTS idx_po_vendor ON po_requests(vendor);
CREATE INDEX IF NOT EXISTS idx_po_updated ON po_requests(updated_at);
CREATE INDEX IF NOT EXISTS idx_po_created ON po_requests(created_at);
