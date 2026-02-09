async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function el(html) {
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstChild;
}

function monthKey(dateStr) {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`; // 2026-02
}

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function groupByMonth(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = monthKey(r.created_at || r.updated_at);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  // newest month first
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function daysSince(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

async function loadMeta() {
  const meta = await api("/api/meta");

  const stageSel = document.querySelector("#stage");
  stageSel.innerHTML = `<option value="">All stages</option>` +
    meta.stages.map(s => `<option value="${s}">${s}</option>`).join("");

  const vendorSel = document.querySelector("#vendor");
  vendorSel.innerHTML = `<option value="">All vendors</option>` +
    meta.vendors.map(v => `<option value="${v}">${v}</option>`).join("");
}

async function loadList() {
  const q = document.querySelector("#q").value.trim();
  const stage = document.querySelector("#stage").value;
  const capex = document.querySelector("#capex").value;
  const vendor = document.querySelector("#vendor").value;

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (stage) params.set("stage", stage);
  if (capex) params.set("capex_opex", capex);
  if (vendor) params.set("vendor", vendor);
  params.set("sort", "updated_at");
  params.set("dir", "desc");

  const rows = await api("/api/po?" + params.toString());
  const grouped = groupByMonth(rows);

  const container = document.querySelector("#monthGroups");
  container.innerHTML = "";

  if (grouped.length === 0) {
    container.appendChild(el(`<div class="muted">No records found.</div>`));
    return;
  }

  const newestMonthKey = grouped[0][0];

  for (const [key, items] of grouped) {
    const details = document.createElement("details");
    if (key === newestMonthKey) details.setAttribute("open", "");

    // totals
    const total = items.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const count = items.length;

    // simple stuck count (updated > 7 days ago, not closed)
    const stuck = items.filter(r => r.stage !== "CLOSED" && daysSince(r.updated_at) >= 7).length;

    const summaryHtml = `
      <summary>
        <b>${monthLabel(key)}</b>
        <span class="pill">${count} requests</span>
        <span class="pill">Total: ${total.toFixed(2)}</span>
        ${stuck ? `<span class="pill danger">Stuck: ${stuck}</span>` : ``}
      </summary>
    `;

    details.appendChild(el(summaryHtml));

    const body = document.createElement("div");
    body.className = "month-body";
    body.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>IT Ref</th>
            <th>Title</th>
            <th>Vendor</th>
            <th>Amount</th>
            <th>Stage</th>
            <th>Owner</th>
            <th>Updated</th>
            <th>Next Action</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    `;

    const tbody = body.querySelector("tbody");
    for (const r of items) {
      const tr = document.createElement("tr");
      tr.style.cursor = "pointer";
      tr.innerHTML = `
        <td>${r.it_ref_no}</td>
        <td>${r.title}</td>
        <td>${r.vendor || ""}</td>
        <td>${r.amount ?? ""} ${r.currency || ""}</td>
        <td>${r.stage}</td>
        <td>${r.owner_role}</td>
        <td>${new Date(r.updated_at).toLocaleString()}</td>
        <td>${r.next_action || ""}</td>
      `;
      tr.onclick = () => showDetail(r.id);
      tbody.appendChild(tr);
    }

    details.appendChild(body);
    container.appendChild(details);
  }
}

async function showDetail(id) {
  const { po, logs } = await api(`/api/po/${id}`);
  const meta = await api("/api/meta");

  const detail = document.querySelector("#detail");
  if (!po) {
    detail.innerHTML = `<div class="muted">Select a record…</div>`;
    return;
  }

  const stageOptions = meta.stages
    .map(s => `<option value="${s}" ${s === po.stage ? "selected" : ""}>${s}</option>`)
    .join("");

  detail.innerHTML = `
    <h3 style="margin-top:0;">Detail: ${po.it_ref_no}</h3>

    <div class="row">
      <label>Title</label>
      <input id="d_title" value="${po.title || ""}" size="40" />
      <label>Vendor</label>
      <input id="d_vendor" value="${po.vendor || ""}" />
      <label>Amount</label>
      <input id="d_amount" value="${po.amount ?? ""}" placeholder="Amount" />
      <label>Currency</label>
      <input id="d_currency" value="${po.currency || "MYR"}" size="6" />
      <button id="save_basic">Save</button>
    </div>

    <div class="row">
      <label>CAPEX/OPEX</label>
      <select id="d_capex">
        <option value="CAPEX" ${po.capex_opex === "CAPEX" ? "selected" : ""}>CAPEX</option>
        <option value="OPEX" ${po.capex_opex === "OPEX" ? "selected" : ""}>OPEX</option>
      </select>

      <label>Form Name</label>
      <input id="d_form" value="${po.form_name || ""}" size="35" placeholder="year-month-IT-no_Capex/Opex_name" />
      <button id="save_form">Save Form</button>
    </div>

    <div class="row">
      <label>Stage</label>
      <select id="d_stage">${stageOptions}</select>
      <input id="d_stage_note" placeholder="Note (optional) e.g. waiting admin PO" size="45" />
      <button id="move_stage">Move Stage</button>
    </div>

    <div class="row">
      <label>Next Action</label>
      <input id="d_next" value="${po.next_action || ""}" placeholder="What to do next" size="55" />
      <label>Owner</label>
      <select id="d_owner">
        <option value="INTERN" ${po.owner_role === "INTERN" ? "selected" : ""}>INTERN</option>
        <option value="ADMIN" ${po.owner_role === "ADMIN" ? "selected" : ""}>ADMIN</option>
        <option value="MANAGER" ${po.owner_role === "MANAGER" ? "selected" : ""}>MANAGER</option>
        <option value="VENDOR" ${po.owner_role === "VENDOR" ? "selected" : ""}>VENDOR</option>
      </select>
      <button id="save_next">Save</button>
    </div>

    <div class="row">
      <label>SharePoint Folder URL</label>
      <input id="d_folder" value="${po.sharepoint_folder_url || ""}" size="70" placeholder="https://..." />
      <button id="save_folder">Save Link</button>
    </div>

    <div class="row">
      <label>Signed PDF URL</label>
      <input id="d_signed" value="${po.signed_pdf_url || ""}" size="50" placeholder="https://..." />
      <label>PO URL</label>
      <input id="d_po" value="${po.po_doc_url || ""}" size="35" placeholder="https://..." />
      <button id="save_links">Save Links</button>
    </div>

    <div class="row">
      <label>Invoice URL</label>
      <input id="d_invoice" value="${po.invoice_url || ""}" size="45" placeholder="https://..." />
      <label>Payment Slip URL</label>
      <input id="d_slip" value="${po.payment_slip_url || ""}" size="35" placeholder="https://..." />
      <button id="save_links2">Save Links</button>
    </div>

    <h4>Activity Log</h4>
    <ul>
      ${logs.map(l => `
        <li>
          <b>${l.action}</b>
          ${l.from_stage ? ` (${l.from_stage} → ${l.to_stage})` : ""}
          ${l.note ? ` — ${l.note}` : ""}
          <span class="muted">[${new Date(l.created_at).toLocaleString()}]</span>
        </li>
      `).join("")}
    </ul>
  `;

  document.querySelector("#save_basic").onclick = async () => {
    await api(`/api/po/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: document.querySelector("#d_title").value,
        vendor: document.querySelector("#d_vendor").value || null,
        amount: document.querySelector("#d_amount").value,
        currency: document.querySelector("#d_currency").value || "MYR",
        changed_by: "ui"
      })
    });
    await loadMeta();
    await loadList();
    await showDetail(id);
  };

  document.querySelector("#save_form").onclick = async () => {
    await api(`/api/po/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        capex_opex: document.querySelector("#d_capex").value,
        form_name: document.querySelector("#d_form").value || null,
        changed_by: "ui"
      })
    });
    await loadList();
    await showDetail(id);
  };

  document.querySelector("#move_stage").onclick = async () => {
    await api(`/api/po/${id}/move-stage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to_stage: document.querySelector("#d_stage").value,
        note: document.querySelector("#d_stage_note").value || null,
        changed_by: "ui"
      })
    });
    await loadList();
    await showDetail(id);
  };

  document.querySelector("#save_next").onclick = async () => {
    await api(`/api/po/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        next_action: document.querySelector("#d_next").value || null,
        owner_role: document.querySelector("#d_owner").value,
        changed_by: "ui"
      })
    });
    await loadList();
    await showDetail(id);
  };

  document.querySelector("#save_folder").onclick = async () => {
    await api(`/api/po/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sharepoint_folder_url: document.querySelector("#d_folder").value || null,
        changed_by: "ui"
      })
    });
    await loadList();
    await showDetail(id);
  };

  document.querySelector("#save_links").onclick = async () => {
    await api(`/api/po/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signed_pdf_url: document.querySelector("#d_signed").value || null,
        po_doc_url: document.querySelector("#d_po").value || null,
        changed_by: "ui"
      })
    });
    await loadList();
    await showDetail(id);
  };

  document.querySelector("#save_links2").onclick = async () => {
    await api(`/api/po/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoice_url: document.querySelector("#d_invoice").value || null,
        payment_slip_url: document.querySelector("#d_slip").value || null,
        changed_by: "ui"
      })
    });
    await loadList();
    await showDetail(id);
  };
}

async function createPO() {
  const it_ref_no = document.querySelector("#it_ref_no").value.trim();
  const title = document.querySelector("#title").value.trim();
  const capex_opex = document.querySelector("#capex_new").value;

  if (!it_ref_no || !title) {
    alert("Please fill IT Ref No and Title");
    return;
  }

  const out = await api("/api/po", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ it_ref_no, title, capex_opex, changed_by: "ui" })
  });

  document.querySelector("#it_ref_no").value = "";
  document.querySelector("#title").value = "";

  await loadMeta();
  await loadList();
  await showDetail(out.id);
}

document.querySelector("#refresh").onclick = loadList;
document.querySelector("#create").onclick = () => createPO().catch(e => alert(e.message));

// auto refresh when typing search (small debounce)
let t = null;
document.querySelector("#q").addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(() => loadList().catch(() => {}), 250);
});
document.querySelector("#stage").addEventListener("change", () => loadList().catch(() => {}));
document.querySelector("#capex").addEventListener("change", () => loadList().catch(() => {}));
document.querySelector("#vendor").addEventListener("change", () => loadList().catch(() => {}));

(async function init() {
  document.querySelector("#detail").innerHTML = `<div class="muted">Select a record to see details…</div>`;
  await loadMeta();
  await loadList();
})();
