import { supabase, TENANT } from "./supabase.js";

const REPORTS_TABLE = "reports";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);

function showMsg(text, type = "info") {
  const el = $("msg");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("hidden", "error");
  if (type === "error") el.classList.add("error");
}
function hideMsg() {
  const el = $("msg");
  if (!el) return;
  el.classList.add("hidden");
  el.classList.remove("error");
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function getIdFromQuery() {
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  const u = new URL(location.href);
  let id = u.searchParams.get("id");

  if (!id) {
    try { id = sessionStorage.getItem("report_view_id"); } catch {}
  }

  if (!id || !UUID_RE.test(id)) return null;

  if (!u.searchParams.get("id")) {
    u.searchParams.set("id", id);
    history.replaceState(null, "", u.toString());
  }

  return id;
}

function setImg(imgEl, emptyEl, url) {
  if (!imgEl || !emptyEl) return;
  if (!url) {
    imgEl.removeAttribute("src");
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  imgEl.src = url;
}

function extFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  return "bin";
}

async function uploadToBucket({ bucket, reportDbId, prefix, file }) {
  const ext = extFromMime(file.type);
  const path = `${reportDbId}/${prefix}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { path, publicUrl: data?.publicUrl || null };
}

// ---------- state ----------
let reportId = null;
let original = null;
let editMode = false;

// ---------- DOM ----------
const cardForm = $("cardForm");
const btnEdit = $("btnEdit");
const btnSave = $("btnSave");
const btnDelete = $("btnDelete");

const fileId = $("file_id");
const fileTicket = $("file_ticket");

const imgId = $("img_id");
const imgTicket = $("img_ticket");
const imgSig = $("img_sig");

const imgIdEmpty = $("img_id_empty");
const imgTicketEmpty = $("img_ticket_empty");
const imgSigEmpty = $("img_sig_empty");

const parentsWrap = $("parentsWrap");

// police dom
const policeInterventionEl = $("police_intervention");
const policeActionEl = $("police_action");
const banDaysWrap = $("banDaysWrap");
const fineAmountWrap = $("fineAmountWrap");
const banDaysEl = $("ban_duration_days");
const fineAmountEl = $("fine_amount_ils");

function applyPoliceUI() {
  const yes = (policeInterventionEl?.value === "true");
  if (policeActionEl) policeActionEl.disabled = !yes;

  if (!yes) {
    if (policeActionEl) policeActionEl.value = "";
    if (banDaysEl) banDaysEl.value = "";
    if (fineAmountEl) fineAmountEl.value = "";
  }

  const act = policeActionEl?.value || "";
  if (banDaysWrap) banDaysWrap.style.display = (yes && act === "ban") ? "" : "none";
  if (fineAmountWrap) fineAmountWrap.style.display = (yes && act === "fine") ? "" : "none";

  if (act !== "ban" && banDaysEl) banDaysEl.value = "";
  if (act !== "fine" && fineAmountEl) fineAmountEl.value = "";
}

// ---------- edit mode ----------
function setEditMode(on) {
  editMode = !!on;

  if (cardForm) cardForm.classList.toggle("viewOnly", !editMode);
  if (btnSave) btnSave.classList.toggle("hidden", !editMode);
  if (btnEdit) btnEdit.textContent = editMode ? "ביטול" : "עריכה";

  const rowIdFile = $("row_id_file");
  const rowTicketFile = $("row_ticket_file");
  if (rowIdFile) rowIdFile.style.display = editMode ? "flex" : "none";
  if (rowTicketFile) rowTicketFile.style.display = editMode ? "flex" : "none";

  // Police selects should also be readonly in view mode due to CSS, but keep UI consistent
  applyPoliceUI();
}

// ---------- hide parents if בגיר ----------
function applyParentsVisibility(r) {
  const isMinor = String(r?.adult_minor || "").trim() === "קטין";
  if (parentsWrap) parentsWrap.style.display = isMinor ? "" : "none";
}

// ---------- Self-heal signature if exists in bucket but DB empty ----------
async function selfHealSignatureIfNeeded(r) {
  try {
    if (!r) return r;

    // If path exists but url missing -> set url
    if (!r.signature_url && r.signature_path) {
      const { data: urlData } = supabase.storage.from("report-signature").getPublicUrl(r.signature_path);
      const publicUrl = urlData?.publicUrl || null;
      if (publicUrl) {
        const { error: upErr } = await supabase
          .from(REPORTS_TABLE)
          .update({ signature_url: publicUrl, updated_at: new Date().toISOString() })
          .eq("tenant", TENANT)
          .eq("id", r.id);

        if (!upErr) r.signature_url = publicUrl;
      }
      return r;
    }

    // No path and no url -> try list folder
    if (!r.signature_url && !r.signature_path) {
      const folder = String(r.id);
      const { data: files, error: listErr } = await supabase.storage
        .from("report-signature")
        .list(folder, { limit: 50, sortBy: { column: "name", order: "desc" } });

      if (listErr) return r;
      if (!Array.isArray(files) || !files.length) return r;

      const sigFile = files.find(f => String(f.name || "").startsWith("signature-")) || files[0];
      const path = `${folder}/${sigFile.name}`;

      const { data: urlData } = supabase.storage.from("report-signature").getPublicUrl(path);
      const publicUrl = urlData?.publicUrl || null;

      if (publicUrl) {
        const { error: upErr } = await supabase
          .from(REPORTS_TABLE)
          .update({ signature_path: path, signature_url: publicUrl, updated_at: new Date().toISOString() })
          .eq("tenant", TENANT)
          .eq("id", r.id);

        if (!upErr) {
          r.signature_path = path;
          r.signature_url = publicUrl;
        }
      }
    }
  } catch (e) {
    console.warn("selfHealSignatureIfNeeded failed:", e);
  }
  return r;
}

// ---------- fill ----------
function fillForm(r) {
  if (!r) return;

  const pageTitle = $("pageTitle");
  const meta = $("meta");
  if (pageTitle) pageTitle.textContent = `דוח אירוע • ${r.report_type || "ללא סוג"}`;
  if (meta) meta.textContent = `מספר דוח: ${r.id} • נוצר: ${fmtDate(r.created_at)} • עודכן: ${fmtDate(r.updated_at) || "—"}`;

  const statusBadge = $("statusBadge");
  if (statusBadge) statusBadge.textContent = `status: ${r.status || "new"}`;

  const set = (id, v) => {
    const el = $(id);
    if (el) el.value = v ?? "";
  };

  set("commander_name", r.commander_name);
  set("report_type", r.report_type);
  set("report_filled_time", r.report_filled_time);
  set("status", r.status || "new");

  set("fan_name", r.fan_name);
  set("fan_phone", r.fan_phone);
  set("fan_id", r.fan_id);
  set("fan_address", r.fan_address);
  set("ticket_type", r.ticket_type);
  set("birth_date", r.birth_date);
  set("adult_minor", r.adult_minor);

  set("father_name", r.father_name);
  set("mother_name", r.mother_name);
  set("parent_phone", r.parent_phone);
  set("parent_address", r.parent_address);

  set("stand", r.stand);
  set("gate", r.gate);
  set("block", r.block);
  set("approx_time", r.approx_time);

  set("offense_type", r.offense_type);
  set("fan_reaction", r.fan_reaction);
  set("offense_description", r.offense_description);
  set("general_notes", r.general_notes);

  // ✅ police fields
  if (policeInterventionEl) policeInterventionEl.value = String(!!r.police_intervention);
  if (policeActionEl) policeActionEl.value = r.police_action || "";
  if (banDaysEl) banDaysEl.value = (r.ban_duration_days ?? "");
  if (fineAmountEl) fineAmountEl.value = (r.fine_amount_ils ?? "");
  applyPoliceUI();

  applyParentsVisibility(r);

  // images
  setImg(imgId, imgIdEmpty, r.id_photo_url);
  setImg(imgTicket, imgTicketEmpty, r.ticket_photo_url);
  setImg(imgSig, imgSigEmpty, r.signature_url);
}

// ---------- collect ----------
function collectPayload() {
  const val = (id) => ($(id)?.value ?? "").trim();

  const police_intervention = (policeInterventionEl?.value === "true");
  const police_action = police_intervention ? (policeActionEl?.value || null) : null;

  const ban_duration_days =
    (police_intervention && police_action === "ban")
      ? (Number(String(banDaysEl?.value || "").replace(/[^\d]/g, "")) || null)
      : null;

  const fine_amount_ils =
    (police_intervention && police_action === "fine")
      ? (Number(String(fineAmountEl?.value || "").replace(/[^\d]/g, "")) || null)
      : null;

  return {
    commander_name: val("commander_name"),
    report_type: val("report_type"),
    report_filled_time: val("report_filled_time"),

    fan_name: val("fan_name"),
    fan_phone: val("fan_phone"),
    fan_id: val("fan_id") || null,
    fan_address: val("fan_address") || null,
    ticket_type: val("ticket_type") || null,
    birth_date: val("birth_date") || null,
    adult_minor: val("adult_minor") || null,

    father_name: val("father_name") || null,
    mother_name: val("mother_name") || null,
    parent_phone: val("parent_phone") || null,
    parent_address: val("parent_address") || null,

    stand: val("stand") || null,
    gate: val("gate") || null,
    block: val("block") || null,
    approx_time: val("approx_time") || null,

    offense_type: val("offense_type") || null,
    offense_description: val("offense_description") || null,
    fan_reaction: val("fan_reaction") || null,
    general_notes: val("general_notes") || null,

    // ✅ police
    police_intervention,
    police_action,
    ban_duration_days,
    fine_amount_ils,

    status: $("status")?.value || "new",
    updated_at: new Date().toISOString(),
  };
}

function validateEditPayload(p) {
  // police validation (same logic as report.js)
  if (p.police_intervention) {
    if (!p.police_action) return "חסר סוג התערבות משטרתית";
    if (p.police_action === "ban" && !p.ban_duration_days) return "חסר משך הרחקה (ימים)";
    if (p.police_action === "fine" && !p.fine_amount_ils) return "חסר סכום קנס (₪)";
  }
  return null;
}

// ---------- load ----------
async function load() {
  hideMsg();
  reportId = getIdFromQuery();

  if (!reportId) {
    showMsg("חסר ID בכתובת. חזור ל-Admin ופתח דוח דרך 'צפייה'.", "error");
    setEditMode(false);
    return;
  }

  const { data, error } = await supabase
    .from(REPORTS_TABLE)
    .select("*")
    .eq("tenant", TENANT)
    .eq("id", reportId)
    .single();

  if (error || !data) {
    console.error(error);
    showMsg("שגיאה בטעינת הדוח: " + (error?.message || "לא נמצא"), "error");
    return;
  }

  // ✅ self-heal signature if needed
  const healed = await selfHealSignatureIfNeeded(data);

  original = healed;
  fillForm(healed);
  setEditMode(false);
}

// ---------- save ----------
async function save() {
  hideMsg();
  if (!reportId) return;

  if (btnSave) {
    btnSave.disabled = true;
    btnSave.textContent = "שומר…";
  }

  try {
    const payload = collectPayload();
    const err = validateEditPayload(payload);
    if (err) {
      showMsg("לא ניתן לשמור: " + err, "error");
      return;
    }

    // ✅ If adult => clear parents fields (so DB stays clean)
    if (String(payload.adult_minor || "").trim() !== "קטין") {
      payload.father_name = null;
      payload.mother_name = null;
      payload.parent_phone = null;
      payload.parent_address = null;
    }

    const { error: upErr } = await supabase
      .from(REPORTS_TABLE)
      .update(payload)
      .eq("tenant", TENANT)
      .eq("id", reportId);

    if (upErr) throw upErr;

    // optional images replace (ID/Ticket only)
    const updates = {};

    if (fileId?.files?.[0]) {
      const f = fileId.files[0];
      const { path, publicUrl } = await uploadToBucket({
        bucket: "report-id",
        reportDbId: reportId,
        prefix: "id",
        file: f,
      });
      updates.id_photo_path = path;
      updates.id_photo_url = publicUrl;
    }

    if (fileTicket?.files?.[0]) {
      const f = fileTicket.files[0];
      const { path, publicUrl } = await uploadToBucket({
        bucket: "report-ticket",
        reportDbId: reportId,
        prefix: "ticket",
        file: f,
      });
      updates.ticket_photo_path = path;
      updates.ticket_photo_url = publicUrl;
    }

    if (Object.keys(updates).length) {
      updates.updated_at = new Date().toISOString();

      const { error: imgUpErr } = await supabase
        .from(REPORTS_TABLE)
        .update(updates)
        .eq("tenant", TENANT)
        .eq("id", reportId);

      if (imgUpErr) throw imgUpErr;
    }

    showMsg("נשמר ✅");
    if (fileId) fileId.value = "";
    if (fileTicket) fileTicket.value = "";

    await load();
  } catch (e) {
    console.error(e);
    showMsg("שגיאה בשמירה: " + (e?.message || e), "error");
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.textContent = "שמירה";
    }
  }
}

// ---------- delete (DB + Storage files) ----------
async function del() {
  const ok = confirm("למחוק דוח? פעולה בלתי הפיכה. (ימחק גם תמונות/חתימה)");
  if (!ok) return;

  try {
    // 1) get paths before delete (tenant guard)
    const { data: r, error: selErr } = await supabase
      .from(REPORTS_TABLE)
      .select("id, id_photo_path, ticket_photo_path, signature_path")
      .eq("tenant", TENANT)
      .eq("id", reportId)
      .single();

    if (selErr || !r) throw selErr || new Error("Report not found");

    // 2) remove from storage (best-effort)
    const tasks = [];
    const pushRemove = (bucket, path) => {
      const p = String(path || "").trim();
      if (!p) return;
      tasks.push(
        supabase.storage.from(bucket).remove([p]).then(({ error }) => {
          if (error) console.warn("STORAGE REMOVE FAILED:", { bucket, path: p, error });
        })
      );
    };

    pushRemove("report-id", r.id_photo_path);
    pushRemove("report-ticket", r.ticket_photo_path);
    pushRemove("report-signature", r.signature_path);

    await Promise.allSettled(tasks);

    // 3) delete row (tenant guard)
    const { error: delErr } = await supabase
      .from(REPORTS_TABLE)
      .delete()
      .eq("tenant", TENANT)
      .eq("id", reportId);

    if (delErr) throw delErr;

    showMsg("נמחק ✅");
    setTimeout(() => (location.href = "./admin.html"), 500);
  } catch (e) {
    console.error(e);
    showMsg("שגיאה במחיקה: " + (e?.message || e), "error");
  }
}

// ---------- events ----------
btnEdit?.addEventListener("click", () => {
  if (!original) return;

  if (!editMode) {
    setEditMode(true);
  } else {
    fillForm(original);
    if (fileId) fileId.value = "";
    if (fileTicket) fileTicket.value = "";
    setEditMode(false);
    hideMsg();
  }
});

btnSave?.addEventListener("click", save);
btnDelete?.addEventListener("click", del);

// police listeners
policeInterventionEl?.addEventListener("change", applyPoliceUI);
policeActionEl?.addEventListener("change", applyPoliceUI);
banDaysEl?.addEventListener("input", (e) => { e.target.value = String(e.target.value || "").replace(/[^\d]/g, "").slice(0, 4); });
fineAmountEl?.addEventListener("input", (e) => { e.target.value = String(e.target.value || "").replace(/[^\d]/g, "").slice(0, 7); });

load();
