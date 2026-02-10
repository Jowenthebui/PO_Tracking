const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const db = require("./db");

const app = express();
app.use(express.json());

// Serve UI
app.use(express.static(path.join(__dirname, "public")));

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const nowISO = () => new Date().toISOString();

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Safe filename storage
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\- ]+/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  }
});
const upload = multer({ storage });

// Steps 1–9
const DEFAULT_STEPS = [
  { no: 1, title: "Quotations", desc: "Please upload quotations." },
  { no: 2, title: "Create Capex/Opex Form in Excel", desc: "Fill in the CAPEX/OPEX form and upload the file." },
  { no: 3, title: "Combine Capex/Opex Form with Quotations", desc: "Combine CAPEX/OPEX form with the quotations. If multiple vendor, put the chosen one first." },
  { no: 4, title: "Signed Combined File", desc: "Please upload the signed CAPEX/OPEX form here and tick the checkbox after signed." },
  { no: 5, title: "Update Signed Capex/Opex Form to Admin", desc: "Update to SharePoint and upload to Masterlist. Tick checkbox after done." },
  { no: 6, title: "PO", desc: "Get PO from Admin, send it back to manager on Outlook. Upload PO here and tick checkbox after sending." },
  { no: 7, title: "Invoice", desc: "Get invoice from vendor and upload here." },
  { no: 8, title: "Update Invoice to Admin", desc: "Upload invoice on Masterlist and SharePoint folder. Tick checkbox after done." },
  { no: 9, title: "Admin Make Payment", desc: "Tick checkbox when payment is made. Optional: upload proof of payment." }
];

function parsePOFolderName(folder_name) {
  const raw = String(folder_name || "").trim();
  const parts = raw.split("_").map(s => s.trim()).filter(Boolean);

  let capex_opex = "CAPEX";
  for (const p of parts) {
    const low = p.toLowerCase();
    if (low === "capex") capex_opex = "CAPEX";
    if (low === "opex") capex_opex = "OPEX";
  }

  const itMatch = raw.match(/\bIT-\d+\b/i);
  const it_ref_no = itMatch ? itMatch[0].toUpperCase() : "IT-UNKNOWN";

  let title = "Untitled";
  const capIndex = parts.findIndex(p => ["capex", "opex"].includes(p.toLowerCase()));
  if (capIndex >= 0 && parts[capIndex + 1]) {
    title = parts.slice(capIndex + 1).join(" ");
  } else if (parts.length) {
    title = parts.slice(1).join(" ") || raw;
  }

  return { capex_opex, it_ref_no, title };
}

function stepHasAnyFiles(stepId) {
  const row = db
    .prepare(`SELECT 1 AS ok FROM po_step_files WHERE step_id = ? LIMIT 1`)
    .get(stepId);
  return !!row;
}

// Completion rules (now based on: any files exist)
function computeStepDone(step_no, hasFiles, action_done) {
  // Auto done when file exists
  if ([1, 2, 3, 7].includes(step_no)) return hasFiles;

  // Need file + checkbox
  if ([4, 6].includes(step_no)) return hasFiles && !!action_done;

  // Checkbox only (file optional for 9)
  if ([5, 8, 9].includes(step_no)) return !!action_done;

  return false;
}

// ---- API ----

// Create month folder
app.post("/api/months", (req, res) => {
  const { month_key, label } = req.body;

  if (!month_key || !/^\d{4}-\d{2}$/.test(month_key)) {
    return res.status(400).json({ error: "month_key must be YYYY-MM (e.g. 2026-02)" });
  }

  try {
    const info = db.prepare(`
      INSERT INTO months (month_key, label, created_at)
      VALUES (?, ?, ?)
    `).run(month_key, label || month_key, nowISO());

    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Tree with done summary
app.get("/api/tree", (_req, res) => {
  const months = db.prepare(`SELECT * FROM months ORDER BY month_key DESC`).all();

  const pos = db.prepare(`
    SELECT
      p.*,
      m.month_key,
      (SELECT COUNT(*) FROM po_steps s WHERE s.po_id = p.id) AS total_steps,
      (SELECT COUNT(*) FROM po_steps s WHERE s.po_id = p.id AND s.is_done = 1) AS done_steps
    FROM po_folders p
    JOIN months m ON m.id = p.month_id
    ORDER BY m.month_key DESC, p.created_at DESC
  `).all();

  const map = new Map();
  for (const m of months) map.set(m.id, { ...m, pos: [] });

  for (const p of pos) {
    const bucket = map.get(p.month_id);
    if (!bucket) continue;

    const total = Number(p.total_steps || 0);
    const done = Number(p.done_steps || 0);
    const is_all_done = total > 0 && done === total;

    bucket.pos.push({ ...p, total_steps: total, done_steps: done, is_all_done });
  }

  res.json([...map.values()]);
});

// Create PO (only month_id + folder_name)
app.post("/api/po", (req, res) => {
  const { month_id, folder_name } = req.body;

  if (!month_id || !folder_name) {
    return res.status(400).json({ error: "month_id and folder_name required" });
  }

  const { capex_opex, it_ref_no, title } = parsePOFolderName(folder_name);

  const created_at = nowISO();
  const updated_at = created_at;

  const trx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO po_folders (month_id, folder_name, capex_opex, it_ref_no, title, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(month_id, folder_name, capex_opex, it_ref_no, title, created_at, updated_at);

    const poId = info.lastInsertRowid;

    const ins = db.prepare(`
      INSERT INTO po_steps (po_id, step_no, step_title, step_desc, is_done, action_done, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, 0, ?, ?)
    `);

    for (const s of DEFAULT_STEPS) {
      const t = nowISO();
      ins.run(poId, s.no, s.title, s.desc, t, t);
    }

    return poId;
  });

  try {
    const poId = trx();
    res.json({ id: poId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Get PO + steps + files per step
app.get("/api/po/:id", (req, res) => {
  const id = Number(req.params.id);
  const po = db.prepare(`SELECT * FROM po_folders WHERE id = ?`).get(id);
  if (!po) return res.status(404).json({ error: "Not found" });

  const steps = db.prepare(`
    SELECT * FROM po_steps
    WHERE po_id = ?
    ORDER BY step_no ASC
  `).all(id);

  // attach files array to each step
  const filesByStep = new Map();
  const files = db.prepare(`
    SELECT * FROM po_step_files
    WHERE step_id IN (SELECT id FROM po_steps WHERE po_id = ?)
    ORDER BY uploaded_at DESC
  `).all(id);

  for (const f of files) {
    if (!filesByStep.has(f.step_id)) filesByStep.set(f.step_id, []);
    filesByStep.get(f.step_id).push(f);
  }

  const stepsWithFiles = steps.map(s => ({
    ...s,
    files: filesByStep.get(s.id) || []
  }));

  res.json({ po, steps: stepsWithFiles });
});

// Update checkbox action only
app.patch("/api/step/:id", (req, res) => {
  const id = Number(req.params.id);
  const step = db.prepare(`SELECT * FROM po_steps WHERE id = ?`).get(id);
  if (!step) return res.status(404).json({ error: "Not found" });

  const { action_done } = req.body;

  const newAction =
    typeof action_done === "boolean" ? (action_done ? 1 : 0) : step.action_done;

  const hasFiles = stepHasAnyFiles(id);
  const newIsDone = computeStepDone(step.step_no, hasFiles, newAction) ? 1 : 0;

  db.prepare(`
    UPDATE po_steps
    SET action_done = ?,
        is_done = ?,
        updated_at = ?
    WHERE id = ?
  `).run(newAction, newIsDone, nowISO(), id);

  db.prepare(`UPDATE po_folders SET updated_at = ? WHERE id = ?`).run(nowISO(), step.po_id);

  res.json({ ok: true });
});

// Upload file to a step (adds a NEW file row each time)
app.post("/api/step/:id/upload", upload.single("file"), (req, res) => {
  const stepId = Number(req.params.id);
  const step = db.prepare(`SELECT * FROM po_steps WHERE id = ?`).get(stepId);
  if (!step) return res.status(404).json({ error: "Not found" });
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const file_name = req.file.originalname;
  const file_path = `/uploads/${req.file.filename}`;

  const trx = db.transaction(() => {
    db.prepare(`
      INSERT INTO po_step_files (step_id, file_name, file_path, uploaded_at)
      VALUES (?, ?, ?, ?)
    `).run(stepId, file_name, file_path, nowISO());

    const hasFiles = true; // after insert, definitely has at least 1
    const newIsDone = computeStepDone(step.step_no, hasFiles, step.action_done) ? 1 : 0;

    db.prepare(`
      UPDATE po_steps
      SET is_done = ?, updated_at = ?
      WHERE id = ?
    `).run(newIsDone, nowISO(), stepId);

    db.prepare(`UPDATE po_folders SET updated_at = ? WHERE id = ?`).run(nowISO(), step.po_id);

    return { ok: true, file_name, file_path };
  });

  try {
    res.json(trx());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running: http://localhost:${PORT}`));
