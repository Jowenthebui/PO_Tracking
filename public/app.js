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

function matchesSearch(text, q) {
  if (!q) return true;
  return (text || "").toLowerCase().includes(q.toLowerCase());
}

/* ============================
   QUICK LINKS (EDIT THESE)
============================ */
const QUICK_LINKS = {
  NOTION: "https://your-notion-link-here",
  MASTERLIST: "https://your-masterlist-link-here",
  SHAREPOINT: "https://your-sharepoint-link-here",
  CAPEX_OPEX_TEMPLATE: "https://your-capex-opex-template-link-here"
};

// Which steps should show hint links
const STEP_HINTS = {
  5: [
    { label: "SharePoint", url: QUICK_LINKS.SHAREPOINT },
    { label: "Masterlist", url: QUICK_LINKS.MASTERLIST }
  ],
  8: [
    { label: "SharePoint", url: QUICK_LINKS.SHAREPOINT },
    { label: "Masterlist", url: QUICK_LINKS.MASTERLIST }
  ]
};

function renderHintLinks(stepNo) {
  const hints = STEP_HINTS[stepNo] || [];
  const usable = hints.filter(h => h.url && !h.url.includes("your-"));
  if (!usable.length) return "";
  return `
    <div class="links">
      <span class="pill">Quick links</span>
      ${usable.map(h => `<a class="pill" href="${h.url}" target="_blank" rel="noreferrer">${h.label}</a>`).join("")}
    </div>
  `;
}

function monthKeyFromLabel(label) {
  // Accepts "Jan 2026" / "January 2026" etc.
  const d = new Date(`1 ${label}`);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function daysBetween(aISO, bISO) {
  const a = new Date(aISO).getTime();
  const b = new Date(bISO).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

function needsCheckbox(stepNo) {
  // 4,5,6,8,9 require checkbox action
  return [4, 5, 6, 8, 9].includes(stepNo);
}

function needsUpload(stepNo) {
  // All steps can upload EXCEPT 5 and 8 which are checkbox-only
  return ![5, 8].includes(stepNo);
}

function extraInfoHTML(stepNo) {
  if (stepNo === 2) {
    const ok = QUICK_LINKS.CAPEX_OPEX_TEMPLATE && !QUICK_LINKS.CAPEX_OPEX_TEMPLATE.includes("your-");
    return ok
      ? `<div class="links"><a class="pill" href="${QUICK_LINKS.CAPEX_OPEX_TEMPLATE}" target="_blank" rel="noreferrer">Capex/Opex Template</a></div>`
      : "";
  }
  return "";
}

function renderStepsHTML(steps) {
  const now = new Date().toISOString();

  return `
    <div class="steps">
      ${steps
        .map(s => {
          const isOverdue =
            s.step_no === 9 && !s.is_done && s.created_at && daysBetween(s.created_at, now) >= 14;

          return `
          <div class="step ${s.is_done ? "done" : ""} ${isOverdue ? "overdue" : ""}" data-step-id="${s.id}">
            <div class="step-head">
              <div style="flex:1;">
                <div class="step-title">
                  <b>${s.step_no}. ${s.step_title}</b>
                  ${s.is_done ? `<span class="pill donepill">Done</span>` : ``}
                  ${
                    isOverdue
                      ? `<span class="pill overduepill">Overdue > 2 weeks</span>`
                      : ``
                  }
                </div>

                <div class="muted">${s.step_desc}</div>

                ${extraInfoHTML(s.step_no)}
                ${renderHintLinks(s.step_no)}
              </div>

              ${
                needsCheckbox(s.step_no)
                  ? `<label class="pill">
                      <input type="checkbox" data-action ${s.action_done ? "checked" : ""} />
                      Done
                    </label>`
                  : ``
              }
            </div>

            ${
              needsUpload(s.step_no)
                ? `
                  <div class="fileline">
                    <input type="file" data-file />
                    <button data-upload>Upload</button>
                    ${
                      s.file_path
                        ? `<a href="${s.file_path}" target="_blank" rel="noreferrer">Open file</a>`
                        : `<span class="muted">No file</span>`
                    }
                  </div>
                `
                : ``
            }
          </div>
        `;
        })
        .join("")}
    </div>
  `;
}

function wireSteps(container, steps) {
  for (const s of steps) {
    const card = container.querySelector(`[data-step-id="${s.id}"]`);
    const action = card.querySelector("[data-action]");
    const fileInput = card.querySelector("[data-file]");
    const uploadBtn = card.querySelector("[data-upload]");

    if (action) {
      action.onchange = async () => {
        await api(`/api/step/${s.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action_done: !!action.checked })
        });
        await loadTree();
      };
    }

    if (uploadBtn) {
      uploadBtn.onclick = async () => {
        const f = fileInput.files?.[0];
        if (!f) return alert("Choose a file first");

        const form = new FormData();
        form.append("file", f);

        await api(`/api/step/${s.id}/upload`, { method: "POST", body: form });
        await loadTree();
      };
    }
  }
}

async function loadTree() {
  const q = document.querySelector("#q").value.trim();
  const tree = await api("/api/tree");
  const root = document.querySelector("#tree");
  root.innerHTML = "";

  for (const m of tree) {
    const filteredPOs = m.pos.filter(p => {
      const hay = `${p.folder_name} ${p.it_ref_no} ${p.title} ${p.capex_opex}`.trim();
      return matchesSearch(hay, q) || matchesSearch(m.label, q) || matchesSearch(m.month_key, q);
    });

    if (q && filteredPOs.length === 0 && !matchesSearch(m.label, q) && !matchesSearch(m.month_key, q)) {
      continue;
    }

    const monthDetails = document.createElement("details");
    monthDetails.className = "month";
    monthDetails.innerHTML = `
      <summary>
        <b>${m.label}</b>
        <span class="pill">${m.month_key}</span>
        <span class="pill">${filteredPOs.length} PO</span>
      </summary>
    `;

    const monthBox = document.createElement("div");
    monthBox.className = "box";

    const addRow = el(`
      <div class="row">
        <button data-addpo>+ PO</button>
      </div>
    `);
    monthBox.appendChild(addRow);

    const poList = document.createElement("div");
    poList.style.marginTop = "10px";

    for (const p of filteredPOs) {
      const poDetails = document.createElement("details");
      poDetails.className = `po ${p.is_all_done ? "all-done" : ""}`;

      poDetails.innerHTML = `
        <summary>
          <span>${p.folder_name}</span>
          <span class="pill">${p.capex_opex}</span>
          <span class="pill">${p.done_steps}/${p.total_steps} done</span>
          <span class="pill">${new Date(p.updated_at).toLocaleString()}</span>
        </summary>
      `;

      const poBox = document.createElement("div");
      poBox.className = "box";
      poBox.innerHTML = `<div class="muted">Loading…</div>`;
      poDetails.appendChild(poBox);

      poDetails.addEventListener("toggle", async () => {
        if (!poDetails.open) return;
        const { steps } = await api(`/api/po/${p.id}`);
        poBox.innerHTML = renderStepsHTML(steps);
        wireSteps(poBox, steps);
      });

      poList.appendChild(poDetails);
    }

    monthBox.appendChild(poList);
    monthDetails.appendChild(monthBox);

    // Add PO handler (ONLY one prompt)
    addRow.querySelector("[data-addpo]").onclick = async () => {
      const folder_name = prompt("PO Folder Name\nExample: 2025-01-IT-001_Capex_Name");
      if (!folder_name) return;

      await api("/api/po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month_id: m.id, folder_name: folder_name.trim() })
      });

      await loadTree();
      monthDetails.open = true;
    };

    root.appendChild(monthDetails);
  }

  if (!root.childElementCount) {
    root.appendChild(el(`<div class="muted">No results.</div>`));
  }
}

// New Month button (ONLY one prompt)
document.querySelector("#newMonthBtn").onclick = async () => {
  const label = prompt("Month folder name\nExample: Jan 2026");
  if (!label) return;

  const month_key = monthKeyFromLabel(label.trim());
  if (!month_key) return alert("Invalid month format. Try: Jan 2026");

  await api("/api/months", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ month_key, label: label.trim() })
  });

  await loadTree();
};

let t = null;
document.querySelector("#q").addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(() => loadTree().catch(() => {}), 200);
});

loadTree().catch(e => alert(e.message));
