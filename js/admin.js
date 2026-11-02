import { supabase, TENANT } from "./supabase.js";

const REPORTS_TABLE = "reports";

// ===== DOM =====
const elQ = document.getElementById("q");
const elFrom = document.getElementById("dateFrom");
const elTo = document.getElementById("dateTo");
const elStatus = document.getElementById("status");

const btnSearch = document.getElementById("btnSearch");
const btnSearchTop = document.getElementById("btnSearchTop");
const btnRefresh = document.getElementById("btnRefresh");
const btnLogout = document.getElementById("btnLogout");

const tbody = document.getElementById("tbody");
const countPill = document.getElementById("countPill");
const empty = document.getElementById("empty");

const msg = document.getElementById("msg");
const pdfStatus = document.getElementById("pdfStatus");

// Drawer
const btnPins = document.getElementById("btnPins");
const overlay = document.getElementById("overlay");
const drawer = document.getElementById("drawer");
const btnCloseDrawer = document.getElementById("btnCloseDrawer");
const btnCloseDrawer2 = document.getElementById("btnCloseDrawer2");

const adminPinCurrent = document.getElementById("adminPinCurrent");
const adminPinNew = document.getElementById("adminPinNew");
const btnChangeAdminPin = document.getElementById("btnChangeAdminPin");

const userPinVal = document.getElementById("userPinVal");
const userPinActive = document.getElementById("userPinActive");
const btnUpsertUserPin = document.getElementById("btnUpsertUserPin");
const btnListPins = document.getElementById("btnListPins");
const pinsBox = document.getElementById("pinsBox");

// ===== helpers UI =====
function showMsg(text, type = "info") {
  msg.textContent = text;
  msg.className = "msg show" + (type === "error" ? " error" : "");
}
function hideMsg() {
  msg.className = "msg";
  msg.textContent = "";
}
function setPdfStatus(text) {
  if (!pdfStatus) return;
  pdfStatus.textContent = text || "";
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildLocation(r) {
  const parts = [];
  if (r.stand) parts.push(`יציע ${r.stand}`);
  if (r.gate) parts.push(`שער ${r.gate}`);
  if (r.block) parts.push(`גוש ${r.block}`);
  return parts.join(" • ");
}

function statusBadge(status) {
  const s = status || "new";
  return `<span class="badge"><span class="dot"></span>${s}</span>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function rowHtml(r) {
  const loc = buildLocation(r);
  return `
    <tr>
      <td data-label="תאריך">${fmtDate(r.created_at)}</td>
      <td data-label="שם אוהד">${escapeHtml(r.fan_name || "")}</td>
      <td data-label="טלפון">${escapeHtml(r.fan_phone || "")}</td>
      <td data-label="סוג עבירה">${escapeHtml(r.offense_type || "")}</td>
      <td data-label="מיקום">${escapeHtml(loc)}</td>
      <td data-label="סטטוס">${statusBadge(r.status)}</td>
      <td data-label="פעולות">
        <div class="actions">
          <button class="btn link" data-act="view" data-id="${r.id}">צפייה</button>
          <button class="mini" data-act="pdf" data-id="${r.id}">PDF</button>
          <button class="mini danger" data-act="delete" data-id="${r.id}">מחיקה</button>
        </div>
      </td>
    </tr>
  `;
}

// ===== Fetch reports =====
async function fetchReports() {
  hideMsg();

  const q = (elQ.value || "").trim();
  const from = elFrom.value || "";
  const to = elTo.value || "";
  const status = elStatus.value || "";

  // ✅ מסננים לפי tenant תמיד
  let query = supabase
    .from(REPORTS_TABLE)
    .select("id, created_at, fan_name, fan_phone, offense_type, stand, gate, block, status")
    .eq("tenant", TENANT)
    .order("created_at", { ascending: false })
    .limit(200);

  if (status) query = query.eq("status", status);
  if (from) query = query.gte("created_at", new Date(from + "T00:00:00").toISOString());
  if (to) query = query.lte("created_at", new Date(to + "T23:59:59").toISOString());

  if (q) {
    const like = `%${q}%`;
    query = query.or(`fan_name.ilike.${like},fan_phone.ilike.${like}`);
  }

  const { data, error } = await query;
  if (error) {
    console.error(error);
    showMsg("שגיאה בשליפת דוחות: " + error.message, "error");
    return [];
  }
  return data || [];
}

function render(list) {
  tbody.innerHTML = "";
  countPill.textContent = `${list.length} דוחות`;

  if (!list.length) {
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  tbody.innerHTML = list.map(rowHtml).join("");
  window.__lastList = list;
}

// ===== Delete report (DB + Storage files) =====
async function deleteReport(id) {
  const ok = confirm("למחוק דוח? פעולה בלתי הפיכה. (ימחק גם תמונות/חתימה)");
  if (!ok) return;

  try {
    // 1) bring paths BEFORE deleting the row
    // ✅ tenant guard כדי שלא תמחק בטעות דוח של טננט אחר
    const { data: r, error: selErr } = await supabase
      .from(REPORTS_TABLE)
      .select("id, id_photo_path, ticket_photo_path, signature_path")
      .eq("tenant", TENANT)
      .eq("id", id)
      .single();

    if (selErr || !r) {
      console.error(selErr);
      showMsg("שגיאה בשליפת נתוני הדוח לפני מחיקה: " + (selErr?.message || "לא נמצא"), "error");
      return;
    }

    // 2) delete files from Storage (best-effort)
    const removeTasks = [];

    const safePushRemove = (bucket, path) => {
      const p = String(path || "").trim();
      if (!p) return;

      removeTasks.push(
        supabase.storage.from(bucket).remove([p]).then(({ error }) => {
          if (error) console.warn("STORAGE REMOVE FAILED:", { bucket, path: p, error });
        })
      );
    };

    safePushRemove("report-id", r.id_photo_path);
    safePushRemove("report-ticket", r.ticket_photo_path);
    safePushRemove("report-signature", r.signature_path);

    await Promise.allSettled(removeTasks);

    // 3) delete DB row (tenant guard)
    const { error: delErr } = await supabase
      .from(REPORTS_TABLE)
      .delete()
      .eq("tenant", TENANT)
      .eq("id", id);

    if (delErr) {
      console.error(delErr);
      showMsg("שגיאה במחיקה: " + delErr.message, "error");
      return;
    }

    showMsg("נמחק ✅ (כולל תמונות/חתימה)");
    await load();
  } catch (e) {
    console.error(e);
    showMsg("שגיאה במחיקה: " + (e?.message || e), "error");
  }
}

// ===== PDF Export (2 pages: details + attachments) =====
async function exportPdf(id) {
  showMsg("מכין PDF… ⏳");

  // ✅ tenant guard
  const { data: r, error } = await supabase
    .from(REPORTS_TABLE)
    .select("*")
    .eq("tenant", TENANT)
    .eq("id", id)
    .single();

  if (error || !r) {
    showMsg("שגיאה בשליפת דוח ל-PDF", "error");
    return;
  }

  const html2canvas = window.html2canvas;
  const jsPDF = window.jspdf?.jsPDF;
  if (!html2canvas || !jsPDF) {
    showMsg("PDF לא זמין: חסרים סקריפטים (html2canvas/jspdf).", "error");
    return;
  }

  // =========================
  // ✅ Self-heal: אם יש קובץ חתימה ב-Bucket אבל DB ריק
  // (זה פותר מצב ש"ריק למרות שיש בבאקט")
  // =========================
  try {
    // 1) אם יש path ואין URL -> הפק URL
    if (!r.signature_url && r.signature_path) {
      const { data: urlData } = supabase.storage
        .from("report-signature")
        .getPublicUrl(r.signature_path);
      const publicUrl = urlData?.publicUrl || null;
      if (publicUrl) {
        const { error: upErr } = await supabase
          .from(REPORTS_TABLE)
          .update({ signature_url: publicUrl })
          .eq("tenant", TENANT)
          .eq("id", r.id);
        if (!upErr) r.signature_url = publicUrl;
      }
    }

    // 2) אם אין path ואין url -> נסה למצוא חתימה בתיקיית הדוח
    if (!r.signature_url && !r.signature_path) {
      const folder = String(r.id);
      const { data: files } = await supabase.storage
        .from("report-signature")
        .list(folder, { limit: 50, sortBy: { column: "name", order: "desc" } });

      if (Array.isArray(files) && files.length) {
        const sigFile =
          files.find((f) => String(f.name || "").startsWith("signature-")) || files[0];
        const path = `${folder}/${sigFile.name}`;

        const { data: urlData } = supabase.storage
          .from("report-signature")
          .getPublicUrl(path);
        const publicUrl = urlData?.publicUrl || null;

        if (publicUrl) {
          const { error: upErr } = await supabase
            .from(REPORTS_TABLE)
            .update({ signature_path: path, signature_url: publicUrl })
            .eq("tenant", TENANT)
            .eq("id", r.id);

          if (!upErr) {
            r.signature_path = path;
            r.signature_url = publicUrl;
          }
        }
      }
    }
  } catch (e) {
    console.warn("Self-heal signature failed:", e);
  }

  // =========================
  // Helpers
  // =========================
  const safe = (v) => (v === null || v === undefined) ? "" : String(v);
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDate = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const locParts = [];
  if (r.stand) locParts.push(`יציע ${r.stand}`);
  if (r.gate) locParts.push(`שער ${r.gate}`);
  if (r.block) locParts.push(`גוש ${r.block}`);
  const location = locParts.join(" • ");

  const isMinor = String(r.adult_minor || "").trim() === "קטין";

  // Police section (from your report.js fields)
  const policeYes = !!r.police_intervention;
  const policeActionMap = { arrest: "מעצר", ban: "הרחקה", fine: "קנס מנהלי" };
  const policeActionText = policeYes ? (policeActionMap[r.police_action] || safe(r.police_action) || "—") : "לא";
  let policeExtra = "";
  if (policeYes && r.police_action === "ban") {
    policeExtra = ` • משך: <b>${safe(r.ban_duration_days || "—")}</b> ימים`;
  }
  if (policeYes && r.police_action === "fine") {
    policeExtra = ` • סכום: <b>${safe(r.fine_amount_ils || "—")}</b> ₪`;
  }

  // Logo (change path if needed)
  const LOGO_SRC = "./assets/logos/mta.png";

  // =========================
  // ✅ PAGE 1: DETAILS (no images at all)
  // =========================
  const page1 = document.createElement("div");
  page1.dir = "rtl";
  page1.lang = "he";
  page1.style.cssText = `
    position: fixed; left: -99999px; top: 0;
    width: 794px;
    background:#fff;
    font-family: Heebo, Arial, sans-serif;
    color:#0f172a;
    padding:0;
  `;

  page1.innerHTML = `
    <div style="padding:22px 24px 16px; border-bottom:6px solid #0B4EA2; background:linear-gradient(180deg, rgba(108, 163, 239, 0.55), #fff);">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px;">
        <div style="display:flex; gap:12px; align-items:center;">
          <img src="${LOGO_SRC}" crossOrigin="anonymous"
               style="width:54px;height:54px;object-fit:contain;border-radius:12px;background:rgba(255,255,255,.75);padding:6px;border:1px solid rgba(2,6,23,.10);" />
          <div>
            <div style="font-size:26px; font-weight:900;">דוח אירוע</div>
            <div style="margin-top:6px; font-size:13px; color:#334155;">
              סוג דוח: <b>${safe(r.report_type) || "—"}</b> • תאריך: <b>${safe(fmtDate(r.created_at)) || "—"}</b> • סטטוס: <b>${safe(r.status) || "new"}</b>
            </div>
          </div>
        </div>

        <div style="min-width:200px; text-align:left; font-size:12px; color:#475569;">
          <div><b>מספר דוח:</b> ${safe(r.id)}</div>
          <div><b>עודכן:</b> ${safe(fmtDate(r.updated_at)) || "—"}</div>
        </div>
      </div>
    </div>

    <div style="padding:18px 24px 8px;">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">

        <div style="border:1px solid rgba(2,6,23,.12); border-radius:14px; padding:12px;">
          <div style="font-weight:900; color:#0B4EA2; margin-bottom:8px;">פרטי דוח</div>
          <div style="font-size:13px; line-height:1.75">
            <div><b>מפקד:</b> ${safe(r.commander_name) || "—"}</div>
            <div><b>שעת מילוי:</b> ${safe(r.report_filled_time) || "—"}</div>
            <div><b>מיקום:</b> ${safe(location) || "—"}</div>
            <div><b>שעה משוערת:</b> ${safe(r.approx_time) || "—"}</div>
            <div><b>סוג עבירה:</b> ${safe(r.offense_type) || "—"}</div>
          </div>

          <div style="margin-top:10px; border-top:1px dashed rgba(2,6,23,.14); padding-top:10px;">
            <div style="font-weight:900; color:#0B4EA2; margin-bottom:6px;">התערבות משטרתית</div>
            <div style="font-size:13px; line-height:1.75">
              <div><b>האם בוצעה:</b> ${policeYes ? "כן" : "לא"}</div>
              ${policeYes ? `<div><b>סוג:</b> ${policeActionText}${policeExtra}</div>` : ``}
            </div>
          </div>
        </div>

        <div style="border:1px solid rgba(2,6,23,.12); border-radius:14px; padding:12px;">
          <div style="font-weight:900; color:#0B4EA2; margin-bottom:8px;">פרטי אוהד</div>
          <div style="font-size:13px; line-height:1.75">
            <div><b>שם:</b> ${safe(r.fan_name) || "—"}</div>
            <div><b>טלפון:</b> ${safe(r.fan_phone) || "—"}</div>
            <div><b>ת״ז:</b> ${safe(r.fan_id) || "—"}</div>
            <div><b>כתובת:</b> ${safe(r.fan_address) || "—"}</div>
            <div><b>סוג כרטיס:</b> ${safe(r.ticket_type) || "—"}</div>
            <div><b>תאריך לידה:</b> ${safe(r.birth_date) || "—"}</div>
            <div><b>קטין/בגיר:</b> ${safe(r.adult_minor) || "—"}</div>

            ${
              isMinor
                ? `
                <div style="margin-top:10px; border-top:1px dashed rgba(2,6,23,.14); padding-top:10px;">
                  <div style="font-weight:900; color:#0B4EA2; margin-bottom:6px;">פרטי הורים (קטין)</div>
                  <div><b>אב:</b> ${safe(r.father_name) || "—"}</div>
                  <div><b>אם:</b> ${safe(r.mother_name) || "—"}</div>
                  <div><b>טלפון הורה:</b> ${safe(r.parent_phone) || "—"}</div>
                  <div><b>כתובת הורים:</b> ${safe(r.parent_address) || "—"}</div>
                </div>
              `
                : ``
            }
          </div>
        </div>
      </div>

      <div style="margin-top:12px; border:1px solid rgba(2,6,23,.12); border-radius:14px; padding:12px;">
        <div style="font-weight:900; color:#0B4EA2; margin-bottom:8px;">תיאור עבירה</div>
        <div style="font-size:13px; line-height:1.85; white-space:pre-wrap;">${safe(r.offense_description) || "—"}</div>
      </div>

      <div style="margin-top:12px; border:1px solid rgba(2,6,23,.12); border-radius:14px; padding:12px;">
        <div style="font-weight:900; color:#0B4EA2; margin-bottom:8px;">תגובת האוהד</div>
        <div style="font-size:13px; line-height:1.85; white-space:pre-wrap;">${safe(r.fan_reaction) || "—"}</div>
      </div>

      <div style="margin-top:12px; border:1px solid rgba(2,6,23,.12); border-radius:14px; padding:12px;">
        <div style="font-weight:900; color:#0B4EA2; margin-bottom:8px;">הערות</div>
        <div style="font-size:13px; line-height:1.85; white-space:pre-wrap;">${safe(r.general_notes) || "—"}</div>
      </div>

      <div style="margin-top:14px; font-size:11px; color:#64748b;">
        נוצר במערכת דוחות מטאור אבטחה• הפקה אוטומטית
      </div>
    </div>
  `;

  // =========================
  // ✅ PAGE 2: ATTACHMENTS ONLY (no split)
  // =========================
  const page2 = document.createElement("div");
  page2.dir = "rtl";
  page2.lang = "he";
  page2.style.cssText = `
    position: fixed; left: -99999px; top: 0;
    width: 794px;
    background:#fff;
    font-family: Heebo, Arial, sans-serif;
    color:#0f172a;
  `;

  const hasAnyMedia = !!(r.id_photo_url || r.ticket_photo_url || r.signature_url);

  page2.innerHTML = `
    <div style="padding:22px 24px 16px; border-bottom:6px solid #0B4EA2; background:linear-gradient(180deg, rgba(108, 163, 239, 0.55), #fff);">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;">
        <div style="display:flex; gap:12px; align-items:center;">
          <img src="${LOGO_SRC}" crossOrigin="anonymous"
               style="width:44px;height:44px;object-fit:contain;border-radius:12px;background:rgba(255,255,255,.75);padding:6px;border:1px solid rgba(2,6,23,.10);" />
          <div>
            <div style="font-size:20px; font-weight:900;">מצורפים — תמונות וחתימה</div>
            <div style="margin-top:4px; font-size:12px; color:#334155;">
              מספר דוח: <b>${safe(r.id)}</b> • תאריך: <b>${safe(fmtDate(r.created_at)) || "—"}</b>
            </div>
          </div>
        </div>
        <div style="font-size:12px; color:#475569;">עמוד מצורפים</div>
      </div>
    </div>

    <div style="padding:18px 24px 22px;">
      ${
        hasAnyMedia
          ? `
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              ${
                r.id_photo_url
                  ? `
                <div style="border:1px solid rgba(2,6,23,.12); border-radius:14px; overflow:hidden;">
                  <div style="padding:8px 10px; background:rgba(108, 163, 239, 0.55); font-weight:900;">ת״ז</div>
                  <div style="height:310px; display:flex; align-items:center; justify-content:center; background:#fff;">
                    <img crossOrigin="anonymous" src="${r.id_photo_url}" style="max-width:100%; max-height:100%; object-fit:contain;" />
                  </div>
                </div>`
                  : ``
              }

              ${
                r.ticket_photo_url
                  ? `
                <div style="border:1px solid rgba(2,6,23,.12); border-radius:14px; overflow:hidden;">
                  <div style="padding:8px 10px; background:rgba(108, 163, 239, 0.55); font-weight:900;">כרטיס</div>
                  <div style="height:310px; display:flex; align-items:center; justify-content:center; background:#fff;">
                    <img crossOrigin="anonymous" src="${r.ticket_photo_url}" style="max-width:100%; max-height:100%; object-fit:contain;" />
                  </div>
                </div>`
                  : ``
              }

              ${
                r.signature_url
                  ? `
                <div style="border:1px solid rgba(2,6,23,.12); border-radius:14px; overflow:hidden;">
                  <div style="padding:8px 10px; background:rgba(108, 163, 239, 0.55); font-weight:900;">חתימה</div>
                  <div style="height:310px; display:flex; align-items:center; justify-content:center; background:#fff;">
                    <img crossOrigin="anonymous" src="${r.signature_url}" style="max-width:100%; max-height:100%; object-fit:contain;" />
                  </div>
                </div>`
                  : ``
              }
            </div>
          `
          : `
            <div style="border:1px dashed rgba(2,6,23,.20); border-radius:14px; padding:16px; color:#475569;">
              אין תמונות/חתימה לדוח זה.
            </div>
          `
      }

      <div style="margin-top:14px; font-size:11px; color:#64748b;">
        נבנה על־ידי נור חטיב בשיתוף־פעולה עם מטאור אבטחה. כל הזכויות שמורות.
      </div>
    </div>
  `;

  document.body.appendChild(page1);
  document.body.appendChild(page2);

  // =========================
  // Render helper (per page -> no split)
  // =========================
  async function renderPageToPdf(pdf, node, addNewPage = false) {
    // wait images to load (logo + attachments)
    const imgs = Array.from(node.querySelectorAll("img"));
    await Promise.allSettled(
      imgs.map((img) => new Promise((res) => {
        if (img.complete) return res();
        img.onload = () => res();
        img.onerror = () => res();
      }))
    );

    const canvas = await html2canvas(node, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
    });

    const imgData = canvas.toDataURL("image/jpeg", 0.95);

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    // Fit full page with margins
    const margin = 22;
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2;

    const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;

    if (addNewPage) pdf.addPage("a4", "portrait");
    pdf.addImage(imgData, "JPEG", (pageW - w) / 2, margin, w, h);
  }

  try {
    const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });

    // page 1
    await renderPageToPdf(pdf, page1, false);

    // page 2 (only if there is any media OR always show attachments page)
    // אם אתה רוצה תמיד עמוד 2 גם בלי מדיה — תשאיר כמו עכשיו (מומלץ).
    await renderPageToPdf(pdf, page2, true);

    pdf.save(`report-${id}.pdf`);
    showMsg("PDF ירד ✅");
  } catch (e) {
    console.error(e);
    showMsg("PDF לא הופק. בדוק אינטרנט/תמונות Private/CORS. " + (e?.message || e), "error");
  } finally {
    page1.remove();
    page2.remove();
  }
}



// ===== load =====
async function load() {
  const list = await fetchReports();
  render(list);
}

// ===== table actions =====
tbody.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;

  const act = el.getAttribute("data-act");
  const id = el.getAttribute("data-id");

  if (act === "view") {
    try { sessionStorage.setItem("report_view_id", id); } catch {}
    location.href = `./report-view.html?id=${encodeURIComponent(id)}`;
    return;
  }

  if (act === "delete") await deleteReport(id);
  if (act === "pdf") await exportPdf(id);
});

// ===== search/refresh =====
btnSearch.addEventListener("click", load);
btnSearchTop.addEventListener("click", load);
btnRefresh.addEventListener("click", load);

elQ.addEventListener("keydown", (e) => {
  if (e.key === "Enter") load();
});

// ===== logout (local only) =====
btnLogout?.addEventListener("click", () => {
  try { localStorage.removeItem("admin_session_pin"); } catch {}
  window.location.href = "./admin-login.html";
});

// ===== Drawer logic =====
function openDrawer() {
  drawer.classList.add("open");
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}
function closeDrawer() {
  drawer.classList.remove("open");
  overlay.classList.remove("open");
  document.body.style.overflow = "";
}

btnPins.addEventListener("click", openDrawer);
btnCloseDrawer.addEventListener("click", closeDrawer);
btnCloseDrawer2.addEventListener("click", closeDrawer);
overlay.addEventListener("click", closeDrawer);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});

// helper: digits only
function only4Digits(el) {
  el.addEventListener("input", () => {
    el.value = (el.value || "").replace(/\D/g, "").slice(0, 4);
  });
}
only4Digits(adminPinCurrent);
only4Digits(adminPinNew);
only4Digits(userPinVal);

// ===== PIN management =====
async function listPins() {
  pinsBox.textContent = "טוען רשימה…";
  const { data, error } = await supabase
    .from("user_pins")
    .select("pin, active, updated_at")
    .eq("tenant", TENANT)
    .order("pin", { ascending: true })
    .limit(200);

  if (error) {
    console.error(error);
    pinsBox.textContent = "שגיאה בשליפה: " + error.message;
    return;
  }

  if (!data?.length) {
    pinsBox.textContent = "אין PINים במערכת עדיין.";
    return;
  }

  pinsBox.innerHTML = data.map(x => {
    const st = x.active ? "active" : "inactive";
    return `<div style="display:flex;justify-content:space-between;gap:10px;border:1px solid rgba(0,0,0,.08);border-radius:12px;background:#fff;padding:10px 12px;margin-top:8px">
      <div><b>${escapeHtml(x.pin)}</b> <span style="opacity:.7;font-size:12px">(${st})</span></div>
      <div style="opacity:.7;font-size:12px">${escapeHtml(x.updated_at ? fmtDate(x.updated_at) : "")}</div>
    </div>`;
  }).join("");
}

btnListPins.addEventListener("click", listPins);

btnUpsertUserPin.addEventListener("click", async () => {
  const pin = (userPinVal.value || "").trim();
  const active = (userPinActive.value || "true") === "true";

  if (!/^\d{4}$/.test(pin)) {
    showMsg("PIN משתמש חייב להיות 4 ספרות", "error");
    return;
  }

  showMsg("שומר PIN משתמש…");
  const { error } = await supabase
    .from("user_pins")
    .upsert({ tenant: TENANT, pin, active, updated_at: new Date().toISOString() }, { onConflict: "tenant,pin" });

  if (error) {
    console.error(error);
    showMsg("שגיאה בשמירה: " + error.message, "error");
    return;
  }

  showMsg("נשמר ✅");
  await listPins();
});

btnChangeAdminPin.addEventListener("click", async () => {
  const current = (adminPinCurrent.value || "").trim();
  const next = (adminPinNew.value || "").trim();

  if (!/^\d{4}$/.test(current) || !/^\d{4}$/.test(next)) {
    showMsg("PIN מנהל נוכחי/חדש חייבים להיות 4 ספרות", "error");
    return;
  }
  if (current === next) {
    showMsg("PIN חדש חייב להיות שונה מהנוכחי", "error");
    return;
  }

  showMsg("מאמת PIN מנהל…");
  const { data, error } = await supabase
    .from("admin_pins")
    .select("id")
    .eq("tenant", TENANT)
    .eq("pin", current)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) {
    showMsg("PIN מנהל נוכחי שגוי/לא פעיל", "error");
    return;
  }

  const now = new Date().toISOString();

  const { error: offErr } = await supabase
    .from("admin_pins")
    .update({ active: false, updated_at: now })
    .eq("tenant", TENANT)
    .eq("pin", current);

  if (offErr) {
    showMsg("שגיאה בביטול הישן: " + offErr.message, "error");
    return;
  }

  const { error: upErr } = await supabase
    .from("admin_pins")
    .upsert({ tenant: TENANT, pin: next, active: true, updated_at: now }, { onConflict: "tenant,pin" });

  if (upErr) {
    showMsg("שגיאה בשמירת החדש: " + upErr.message, "error");
    return;
  }

  showMsg("PIN מנהל עודכן ✅");
  adminPinCurrent.value = "";
  adminPinNew.value = "";
});

// ===== init =====
load();
