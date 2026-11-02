import { checkOnline } from "./supabase.js";
import {
  saveFiles,
  createDraftReport,
  updateReport,
  getReport,
  queueReportForSync,
  listQueue,
  dequeue,
  bumpQueueError,
  getFile,
} from "./offline.js";
import { supabase, TENANT } from "./supabase.js";

const REPORTS_TABLE = "reports";

const SESSION_KEY = "user_session_pin";
const CURRENT_REPORT_ID_KEY = "current_report_id";

const msgBox = document.getElementById("msg");
const netPill = document.getElementById("netPill");
const netText = document.getElementById("netText");

const btnExit = document.getElementById("btnExit");
const btnBack = document.getElementById("btnBack");
const btnNext = document.getElementById("btnNext");
const btnSaveDraft = document.getElementById("btnSaveDraft");
const btnFinish = document.getElementById("btnFinish");
const btnGoAdmin = document.getElementById("btnGoAdmin");

const reportHeaderTitle = document.getElementById("reportHeaderTitle");
const dateBadge = document.getElementById("dateBadge");

const stages = Array.from(document.querySelectorAll("[data-stage]"));
const stepBoxes = Array.from(document.querySelectorAll(".step"));

/* ===== Stage 2 ===== */
const adultMinor = document.getElementById("adultMinor");
const parentsBlock = document.getElementById("parentsBlock");

const fanId = document.getElementById("fanId");
fanId?.addEventListener("input", (e) => {
  e.target.value = (e.target.value || "").replace(/\D/g, "").slice(0, 9);
});

/* Files */
const idPhoto = document.getElementById("idPhoto");
const ticketPhoto = document.getElementById("ticketPhoto");

/* ===== Stage 3 location fields ===== */
const standEl = document.getElementById("stand");
const gateEl = document.getElementById("gate");
const blockEl = document.getElementById("block");

/* ===== Time fields ===== */
const reportFilledTimeEl = document.getElementById("reportFilledTime");
const approxTimeEl = document.getElementById("approxTime");

/* ===== CLUB + Police fields ===== */
const clubEl = document.getElementById("club"); // hidden input in HTML
const policeInterventionEl = document.getElementById("policeIntervention");
const policeActionEl = document.getElementById("policeAction");
const banBlock = document.getElementById("banBlock");
const fineBlock = document.getElementById("fineBlock");
const banDurationDaysEl = document.getElementById("banDurationDays");
const fineAmountIlsEl = document.getElementById("fineAmountIls");

// helper: clean numeric text
function onlyNum(v) {
  return String(v ?? "").replace(/[^\d]/g, "");
}

/** UI controller for police section */
function applyPoliceUI() {
  if (!policeInterventionEl || !policeActionEl) return;

  const isYes = policeInterventionEl.value === "true";
  policeActionEl.disabled = !isYes;

  if (!isYes) {
    policeActionEl.value = "";
    if (banDurationDaysEl) banDurationDaysEl.value = "";
    if (fineAmountIlsEl) fineAmountIlsEl.value = "";
    banBlock?.classList.add("hidden");
    fineBlock?.classList.add("hidden");
    return;
  }

  const action = policeActionEl.value || "";
  banBlock?.classList.toggle("hidden", action !== "ban");
  fineBlock?.classList.toggle("hidden", action !== "fine");

  if (action === "arrest") {
    if (banDurationDaysEl) banDurationDaysEl.value = "";
    if (fineAmountIlsEl) fineAmountIlsEl.value = "";
  }
  if (action === "ban") {
    if (fineAmountIlsEl) fineAmountIlsEl.value = "";
  }
  if (action === "fine") {
    if (banDurationDaysEl) banDurationDaysEl.value = "";
  }
}

policeInterventionEl?.addEventListener("change", applyPoliceUI);
policeActionEl?.addEventListener("change", applyPoliceUI);
banDurationDaysEl?.addEventListener("input", (e) => {
  e.target.value = onlyNum(e.target.value).slice(0, 4);
});
fineAmountIlsEl?.addEventListener("input", (e) => {
  e.target.value = onlyNum(e.target.value).slice(0, 7);
});

/**
 * אם המשתמש לא נוגע בשעת ביצוע העבירה בכלל -> נשמור אותה כמו שעת מילוי הדוח.
 * ברגע שהמשתמש שינה/נגע בשדה approxTime -> נכבד את הערך שלו.
 */
let approxTimeTouched = false;
approxTimeEl?.addEventListener("input", () => (approxTimeTouched = true));
approxTimeEl?.addEventListener("change", () => (approxTimeTouched = true));

reportFilledTimeEl?.addEventListener("input", () => {
  if (!approxTimeEl) return;
  if (!approxTimeTouched || !String(approxTimeEl.value || "").trim()) {
    approxTimeEl.value = reportFilledTimeEl.value || "";
  }
});
reportFilledTimeEl?.addEventListener("change", () => {
  if (!approxTimeEl) return;
  if (!approxTimeTouched || !String(approxTimeEl.value || "").trim()) {
    approxTimeEl.value = reportFilledTimeEl.value || "";
  }
});

/* =========================================================
   Signature
   ========================================================= */
const sigCanvas = document.getElementById("sigCanvas");
const btnSigClear = document.getElementById("btnSigClear");

let sigCtx = null;
let drawing = false;
let lastPt = null;
let sigReady = false;
let sigHasInk = false;

function setupSignatureCanvas(force = false) {
  if (!sigCanvas) return;
  if (sigReady && sigCtx && !force) return;

  const rect = sigCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    setTimeout(() => setupSignatureCanvas(force), 120);
    return;
  }

  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  sigCanvas.width = Math.floor(rect.width * ratio);
  sigCanvas.height = Math.floor(rect.height * ratio);

  sigCtx = sigCanvas.getContext("2d", { willReadFrequently: true });

  sigCtx.setTransform(1, 0, 0, 1, 0, 0);
  sigCtx.scale(ratio, ratio);

  sigCtx.lineWidth = 3;
  sigCtx.lineCap = "round";
  sigCtx.lineJoin = "round";
  sigCtx.strokeStyle = "rgba(11,78,162,0.95)";

  sigReady = true;
}

function clearSignature() {
  if (!sigCanvas) return;
  if (!sigCtx) setupSignatureCanvas();
  if (!sigCtx) return;

  sigCtx.setTransform(1, 0, 0, 1, 0, 0);
  sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);

  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  sigCtx.scale(ratio, ratio);
  sigCtx.lineWidth = 3;
  sigCtx.lineCap = "round";
  sigCtx.lineJoin = "round";
  sigCtx.strokeStyle = "rgba(11,78,162,0.95)";

  sigHasInk = false;
}

function signatureToDataUrl() {
  if (!sigCanvas) return "";
  setupSignatureCanvas();
  try {
    return sigCanvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

function getPointFromPointer(e) {
  const rect = sigCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  return {
    x: Math.max(0, Math.min(rect.width, x)),
    y: Math.max(0, Math.min(rect.height, y)),
  };
}

function pointerDown(e) {
  if (!sigReady) setupSignatureCanvas();
  if (!sigCtx) return;

  drawing = true;
  sigCanvas.setPointerCapture(e.pointerId);
  lastPt = getPointFromPointer(e);
  e.preventDefault();
}

function pointerMove(e) {
  if (!drawing || !sigCtx) return;
  const pt = getPointFromPointer(e);

  sigCtx.beginPath();
  sigCtx.moveTo(lastPt.x, lastPt.y);
  sigCtx.lineTo(pt.x, pt.y);
  sigCtx.stroke();

  lastPt = pt;
  sigHasInk = true;
  e.preventDefault();
}

function pointerUp(e) {
  drawing = false;
  lastPt = null;
  try {
    sigCanvas.releasePointerCapture(e.pointerId);
  } catch {}
  e.preventDefault();
}

if (sigCanvas) {
  sigCanvas.style.cursor = "crosshair";
  sigCanvas.style.touchAction = "none";

  sigCanvas.addEventListener("pointerdown", pointerDown);
  sigCanvas.addEventListener("pointermove", pointerMove);
  sigCanvas.addEventListener("pointerup", pointerUp);
  sigCanvas.addEventListener("pointercancel", pointerUp);
  sigCanvas.addEventListener("pointerleave", pointerUp);
}

btnSigClear?.addEventListener("click", clearSignature);

btnGoAdmin?.addEventListener("click", () => {
  window.location.href = "./admin-login.html";
});

/* ===== UI helpers ===== */
function showMsg(text, type = "info") {
  msgBox.textContent = text;
  msgBox.classList.remove("hidden");
  msgBox.style.borderColor =
    type === "error" ? "rgba(180,35,24,.4)" : "rgba(11,78,162,.25)";
}
function hideMsg() {
  msgBox.classList.add("hidden");
}

/** Toast קטן (לא תלוי CSS) */
let toastTimer = null;
function showToast(text, type = "ok", ms = 1800) {
  const old = document.getElementById("appToast");
  if (old) old.remove();

  const t = document.createElement("div");
  t.id = "appToast";
  t.textContent = text;

  t.style.position = "fixed";
  t.style.left = "50%";
  t.style.transform = "translateX(-50%)";
  t.style.bottom = "18px";
  t.style.zIndex = "9999";
  t.style.padding = "10px 12px";
  t.style.borderRadius = "14px";
  t.style.fontFamily =
    "Heebo, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
  t.style.fontSize = "13px";
  t.style.fontWeight = "800";
  t.style.boxShadow = "0 10px 30px rgba(0,0,0,.18)";
  t.style.border = "1px solid rgba(2,6,23,.12)";
  t.style.maxWidth = "92vw";
  t.style.textAlign = "center";
  t.style.opacity = "0";
  t.style.transition = "opacity .18s ease, transform .18s ease";

  if (type === "error") {
    t.style.background = "rgba(255,240,240,.98)";
    t.style.color = "#7f1d1d";
  } else if (type === "warn") {
    t.style.background = "rgba(255,251,235,.98)";
    t.style.color = "#7c2d12";
  } else {
    t.style.background = "rgba(240,253,244,.98)";
    t.style.color = "#064e3b";
  }

  document.body.appendChild(t);
  requestAnimationFrame(() => {
    t.style.opacity = "1";
    t.style.transform = "translateX(-50%) translateY(-2px)";
  });

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateX(-50%) translateY(4px)";
    setTimeout(() => t.remove(), 250);
  }, ms);
}

async function updateNetworkStatus() {
  const online = await checkOnline();
  if (online) {
    netPill.classList.remove("offline");
    netPill.classList.add("online");
    netText.textContent = "מחובר";
  } else {
    netPill.classList.remove("online");
    netPill.classList.add("offline");
    netText.textContent = "אופליין";
  }
  return online;
}

/* ===== Session ===== */
function loadSessionPin() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data?.pin || null;
  } catch {
    return null;
  }
}

function getCurrentReportId() {
  return localStorage.getItem(CURRENT_REPORT_ID_KEY) || null;
}
function setCurrentReportId(id) {
  localStorage.setItem(CURRENT_REPORT_ID_KEY, id);
}
function clearCurrentReportId() {
  localStorage.removeItem(CURRENT_REPORT_ID_KEY);
}

/* ===== Date/time header logic ===== */
function pad(n) {
  return String(n).padStart(2, "0");
}

function setHeaderDateAndTitle() {
  const now = new Date();
  const dateStr = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  dateBadge.textContent = `תאריך: ${dateStr} | שעה: ${timeStr}`;

  const reportType = document.getElementById("reportType")?.value || 'דו"ח אירוע';
  reportHeaderTitle.textContent = `${reportType} • ${dateStr}`;
}

/* ===== Steps ===== */
let currentStep = 1;

function setStep(step) {
  currentStep = Math.min(4, Math.max(1, step));

  for (const s of stages) {
    const n = Number(s.getAttribute("data-stage"));
    s.classList.toggle("hidden", n !== currentStep);
  }

  stepBoxes.forEach((box) => {
    const n = Number(box.getAttribute("data-step-ind"));
    box.classList.toggle("active", n === currentStep);
  });

  btnBack.disabled = currentStep === 1;
  btnNext.classList.toggle("hidden", currentStep === 4);
  btnFinish.classList.toggle("hidden", currentStep !== 4);

  if (currentStep === 4) {
    sigReady = false;
    setTimeout(() => setupSignatureCanvas(true), 120);
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ===== Dynamic fields ===== */
adultMinor?.addEventListener("change", () => {
  const val = adultMinor.value;
  parentsBlock?.classList.toggle("hidden", val !== "קטין");
});

/* =========================
   Stable localId helpers
   ========================= */
function ensureLocalId(payload, prevPayload) {
  if (prevPayload?.localId) return prevPayload.localId;
  if (payload?.localId) return payload.localId;
  return crypto?.randomUUID ? crypto.randomUUID() : String(Date.now());
}

/* =========================
   CLUB helper
   ========================= */
function getClubValue() {
  const v = String(clubEl?.value || "").trim();
  return v || "gen"; // ברירת מחדל אם חסר
}

/* ===== Form data ===== */
function getPayload() {
  const reportFilledTime = reportFilledTimeEl?.value || "";
  const approxTimeRaw = approxTimeEl?.value || "";

  const approxTimeFinal = !approxTimeTouched
    ? reportFilledTime
    : (approxTimeRaw || reportFilledTime);

  const generalNotesRaw =
    document.getElementById("generalNotes")?.value.trim() || "";

  const club = getClubValue();

  const police_intervention = policeInterventionEl
    ? policeInterventionEl.value === "true"
    : false;

  const police_action = police_intervention
    ? (policeActionEl?.value || null)
    : null;

  let ban_duration_days = null;
  let fine_amount_ils = null;

  if (police_intervention && police_action === "ban") {
    const v = Number(onlyNum(banDurationDaysEl?.value));
    ban_duration_days = Number.isFinite(v) && v > 0 ? v : null;
  }

  if (police_intervention && police_action === "fine") {
    const v = Number(onlyNum(fineAmountIlsEl?.value));
    fine_amount_ils = Number.isFinite(v) && v > 0 ? v : null;
  }

  if (!police_intervention) {
    ban_duration_days = null;
    fine_amount_ils = null;
  }

  return {
    tenant: TENANT,
    club,

    police_intervention,
    police_action,
    ban_duration_days,
    fine_amount_ils,

    localId: null,
    commanderName: document.getElementById("commanderName")?.value.trim() || "",
    reportType: document.getElementById("reportType")?.value || "",
    reportFilledTime,

    fanName: document.getElementById("fanName")?.value.trim() || "",
    fanPhone: document.getElementById("fanPhone")?.value.trim() || "",
    fanId: document.getElementById("fanId")?.value.trim() || "",
    fanAddress: document.getElementById("fanAddress")?.value.trim() || "",
    ticketType: document.getElementById("ticketType")?.value || "",
    birthDate: document.getElementById("birthDate")?.value || "",
    adultMinor: document.getElementById("adultMinor")?.value || "",

    fatherName: document.getElementById("fatherName")?.value.trim() || "",
    motherName: document.getElementById("motherName")?.value.trim() || "",
    parentPhone: document.getElementById("parentPhone")?.value.trim() || "",
    parentAddress: document.getElementById("parentAddress")?.value.trim() || "",

    stand: standEl?.value || "",
    gate: gateEl?.value || "",
    block: blockEl?.value || "",
    approxTime: approxTimeFinal,

    offenseType: document.getElementById("offenseType")?.value || "",
    offenseDesc: document.getElementById("offenseDesc")?.value.trim() || "",
    fanReaction: document.getElementById("fanReaction")?.value.trim() || "",

    generalNotes: generalNotesRaw || "אין",

    signature: signatureToDataUrl(),

    idPhotoKey: null,
    ticketPhotoKey: null,

    updatedAt: new Date().toISOString(),
  };
}

function setPayload(p) {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v ?? "";
  };

  set("commanderName", p.commanderName);
  set("reportType", p.reportType);
  set("reportFilledTime", p.reportFilledTime);

  set("fanName", p.fanName);
  set("fanPhone", p.fanPhone);
  set("fanId", p.fanId);
  set("fanAddress", p.fanAddress);
  set("ticketType", p.ticketType);
  set("birthDate", p.birthDate);
  set("adultMinor", p.adultMinor);

  parentsBlock?.classList.toggle("hidden", p.adultMinor !== "קטין");
  set("fatherName", p.fatherName);
  set("motherName", p.motherName);
  set("parentPhone", p.parentPhone);
  set("parentAddress", p.parentAddress);

  set("stand", p.stand);
  set("gate", p.gate);
  set("block", p.block);

  set("approxTime", p.approxTime);
  approxTimeTouched = !!String(p.approxTime || "").trim();

  set("offenseType", p.offenseType);
  set("offenseDesc", p.offenseDesc);
  set("fanReaction", p.fanReaction);
  set("generalNotes", p.generalNotes);

  // ✅ club שחזור לטופס
  if (clubEl) clubEl.value = String(p.club || clubEl.value || "").trim() || getClubValue();

  // ✅ police restore + UI
  if (policeInterventionEl) policeInterventionEl.value = String(!!p.police_intervention);
  if (policeActionEl) policeActionEl.value = p.police_action || "";
  if (banDurationDaysEl) banDurationDaysEl.value = p.ban_duration_days ?? "";
  if (fineAmountIlsEl) fineAmountIlsEl.value = p.fine_amount_ils ?? "";
  applyPoliceUI();

  if (p.signature && String(p.signature).startsWith("data:image")) {
    sigHasInk = true;
    const img = new Image();
    img.onload = () => {
      setupSignatureCanvas();
      if (!sigCtx) return;

      const rect = sigCanvas.getBoundingClientRect();
      clearSignature();
      sigCtx.drawImage(img, 0, 0, rect.width, rect.height);
      sigHasInk = true;
    };
    img.src = p.signature;
  }
}

/* ===== Validation ===== */
function isSignatureEmpty() {
  if (sigHasInk) return false;
  if (!sigCanvas || !sigCtx) return true;

  try {
    const w = Math.min(sigCanvas.width, 400);
    const h = Math.min(sigCanvas.height, 220);
    const data = sigCtx.getImageData(0, 0, w, h).data;

    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a !== 0) return false;
    }
    return true;
  } catch {
    return !sigHasInk;
  }
}

function validateStep(step, payload) {
  if (step === 1) {
    if (!payload.commanderName) return "חסר שם מפקד";
    if (!payload.reportType) return 'חסר סוג הדו"ח';
    if (!payload.reportFilledTime) return 'חסרה שעת מילוי הדו"ח';
  }
  if (step === 2) {
    if (!payload.fanName) return "חסר שם אוהד";
    if (!payload.fanPhone) return "חסר טלפון אוהד";
    if (!payload.ticketType) return "חסר סוג כרטיס";
    if (!payload.birthDate) return "חסר תאריך לידה";
    if (!payload.adultMinor) return "חסר קטין/בגיר";

    if (payload.adultMinor === "קטין") {
      if (!payload.fatherName && !payload.motherName) return "חסר שם אב או אם";
      if (!payload.parentPhone) return "חסר טלפון הורה";
    }
  }
  if (step === 3) {
    if (!payload.stand) return "חסר יציע";
    if (!payload.gate) return "חסר שער";
    if (!payload.block) return "חסר גוש";
    if (!payload.offenseType) return "חסר סוג עבירה";
    if (!payload.offenseDesc) return "חסר תיאור עבירה";

    if (payload.police_intervention) {
      if (!payload.police_action) return "חסר סוג התערבות משטרתית";
      if (payload.police_action === "ban" && !payload.ban_duration_days)
        return "חסר משך הרחקה (ימים)";
      if (payload.police_action === "fine" && !payload.fine_amount_ils)
        return "חסר סכום קנס (₪)";
    }
  }
  if (step === 4) {
    if (isSignatureEmpty()) return "חסרה חתימה";
  }
  return null;
}

/* ===== Reset for new report ===== */
function resetFormForNewReport() {
  try { hideMsg(); } catch {}

  const IDS_TO_CLEAR = [
    "commanderName","reportType","reportFilledTime",
    "fanName","fanPhone","fanId","fanAddress","ticketType","birthDate","adultMinor",
    "fatherName","motherName","parentPhone","parentAddress",
    "stand","gate","block","approxTime","offenseType","offenseDesc","fanReaction",
    "generalNotes",
    "policeIntervention","policeAction","banDurationDays","fineAmountIls",
  ];

  for (const id of IDS_TO_CLEAR) {
    const el = document.getElementById(id);
    if (!el) continue;

    if (id === "policeIntervention") {
      el.value = "false";
      continue;
    }
    el.value = "";
  }

  approxTimeTouched = false;

  if (idPhoto) idPhoto.value = "";
  if (ticketPhoto) ticketPhoto.value = "";

  parentsBlock?.classList.add("hidden");

  // ✅ תיקון: אלה מוגדרים עכשיו למעלה (standEl/gateEl/blockEl)
  if (standEl) standEl.value = "";
  if (gateEl) gateEl.value = "";
  if (blockEl) blockEl.value = "";

  applyPoliceUI();

  try {
    setupSignatureCanvas();
    clearSignature();
  } catch {}

  if (reportFilledTimeEl) reportFilledTimeEl.value = "";
  if (approxTimeEl) approxTimeEl.value = "";

  try { setHeaderDateAndTitle(); } catch {}

  clearCurrentReportId();
  setStep(1);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* =========================
   Helpers: files + signature
   ========================= */
function dataUrlToBlob(dataUrl) {
  try {
    const [meta, b64] = String(dataUrl || "").split(",");
    const mime = (meta.match(/data:(.*?);base64/) || [])[1] || "image/png";
    const bin = atob(b64 || "");
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch {
    return null;
  }
}

function extFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  return "bin";
}

async function uploadBlobToBucket({ bucket, path, blob, contentType }) {
  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    upsert: true,
    contentType: contentType || blob.type || "application/octet-stream",
  });

  if (error) {
    console.error("STORAGE UPLOAD ERROR:", {
      bucket,
      path,
      message: error.message,
      statusCode: error.statusCode,
      error,
    });
    throw error;
  }

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
  return { publicUrl: urlData?.publicUrl || null };
}

/* ===== Create new draft ===== */
async function startNewDraft(userPin) {
  const payload = getPayload();
  payload.userPin = userPin;
  payload.localId = ensureLocalId(payload, null);

  const report = await createDraftReport(payload, []);
  setCurrentReportId(report.id);
  return report.id;
}

/* ===== Save Draft ===== */
async function saveDraft() {
  hideMsg();
  const userPin = loadSessionPin();
  if (!userPin) {
    window.location.href = "./index.html";
    return;
  }

  setHeaderDateAndTitle();

  const payload = getPayload();
  payload.userPin = userPin;

  btnSaveDraft.disabled = true;
  btnSaveDraft.textContent = "שומר…";

  try {
    const rid = getCurrentReportId();

    let idKey = null;
    let ticketKey = null;
    const allKeys = [];

    if (idPhoto?.files?.[0]) {
      const keys = await saveFiles([idPhoto.files[0]]);
      idKey = keys?.[0] || null;
      if (idKey) allKeys.push(idKey);
    }
    if (ticketPhoto?.files?.[0]) {
      const keys = await saveFiles([ticketPhoto.files[0]]);
      ticketKey = keys?.[0] || null;
      if (ticketKey) allKeys.push(ticketKey);
    }

    if (!rid) {
      payload.localId = ensureLocalId(payload, null);
      payload.idPhotoKey = idKey || null;
      payload.ticketPhotoKey = ticketKey || null;

      const report = await createDraftReport(payload, allKeys);
      setCurrentReportId(report.id);
      showMsg("נשמרה טיוטה ✅");
    } else {
      const existing = await getReport(rid);
      const prev = existing?.payload || {};

      payload.localId = ensureLocalId(payload, prev);
      payload.idPhotoKey = idKey || prev.idPhotoKey || null;
      payload.ticketPhotoKey = ticketKey || prev.ticketPhotoKey || null;

      const mergedFiles = Array.from(
        new Set([...(existing?.files || []), ...allKeys])
      );
      await updateReport(rid, { payload, files: mergedFiles, status: "draft" });
      showMsg("טיוטה עודכנה ✅");
    }
  } catch (e) {
    console.error(e);
    showMsg("שגיאה בשמירה", "error");
  } finally {
    btnSaveDraft.disabled = false;
    btnSaveDraft.textContent = "שמירה";
  }
}

/* ===== Finish ===== */
async function finishReport() {
  hideMsg();
  const userPin = loadSessionPin();
  if (!userPin) {
    window.location.href = "./index.html";
    return;
  }

  setHeaderDateAndTitle();
  setupSignatureCanvas();

  const payload = getPayload();
  payload.userPin = userPin;

  for (let s = 1; s <= 4; s++) {
    const err = validateStep(s, payload);
    if (err) {
      setStep(s);
      showMsg(`לא ניתן לסיים: ${err}`, "error");
      return;
    }
  }

  btnFinish.disabled = true;
  btnFinish.textContent = "שומר…";

  try {
    let rid = getCurrentReportId();

    let idKey = null;
    let ticketKey = null;
    const allKeys = [];

    if (idPhoto?.files?.[0]) {
      const keys = await saveFiles([idPhoto.files[0]]);
      idKey = keys?.[0] || null;
      if (idKey) allKeys.push(idKey);
    }
    if (ticketPhoto?.files?.[0]) {
      const keys = await saveFiles([ticketPhoto.files[0]]);
      ticketKey = keys?.[0] || null;
      if (ticketKey) allKeys.push(ticketKey);
    }

    if (!rid) {
      payload.localId = ensureLocalId(payload, null);
      payload.idPhotoKey = idKey || null;
      payload.ticketPhotoKey = ticketKey || null;

      const report = await createDraftReport(payload, allKeys);
      rid = report.id;
      setCurrentReportId(rid);
    } else {
      const existing = await getReport(rid);
      const prev = existing?.payload || {};

      payload.localId = ensureLocalId(payload, prev);
      payload.idPhotoKey = idKey || prev.idPhotoKey || null;
      payload.ticketPhotoKey = ticketKey || prev.ticketPhotoKey || null;

      const mergedFiles = Array.from(
        new Set([...(existing?.files || []), ...allKeys])
      );
      await updateReport(rid, { payload, files: mergedFiles });
    }

    await queueReportForSync(rid);

    const isOnlineNow = await checkOnline();
    if (isOnlineNow) showToast("נשלח בהצלחה ✅", "ok", 1600);
    else showToast("נשמר ✅ יישלח אוטומטית כשיחזור אינטרנט", "warn", 2200);

    clearCurrentReportId();
    resetFormForNewReport();
    await startNewDraft(userPin);

    tryProcessQueue().catch((e) => console.warn("background sync failed", e));
  } catch (e) {
    console.error(e);
    showToast("שגיאה בסיום. הדוח נשמר מקומית.", "error", 2200);
    showMsg("שגיאה בסיום. הדוח נשמר מקומית.", "error");
  } finally {
    btnFinish.disabled = false;
    btnFinish.textContent = "שמירה וסיום";
  }
}

/* ===== Sync + Upload to Storage ===== */
async function tryProcessQueue() {
  const online = await updateNetworkStatus();
  if (!online) return { synced: 0, failed: 0 };

  const items = await listQueue();
  let synced = 0;
  let failed = 0;

  const nullIfEmpty = (v) => {
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
  };

  for (const item of items) {
    if (item.type !== "SYNC_REPORT") continue;

    const reportId = item.payload?.reportId;
    if (!reportId) {
      await dequeue(item.qid);
      continue;
    }

    const report = await getReport(reportId);
    if (!report) {
      await dequeue(item.qid);
      continue;
    }

    try {
      const p = report.payload || {};
      const localId =
        p.localId ||
        report.id ||
        (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()));

      const serverRow = {
        tenant: TENANT,
        local_id: localId,
        user_pin: nullIfEmpty(p.userPin),

        // ✅ CLUB חזר לשרת
        club: nullIfEmpty(p.club) ?? "gen",

        police_intervention: !!p.police_intervention,
        police_action: p.police_intervention ? (p.police_action || null) : null,
        ban_duration_days:
          p.police_intervention && p.police_action === "ban"
            ? (p.ban_duration_days ?? null)
            : null,
        fine_amount_ils:
          p.police_intervention && p.police_action === "fine"
            ? (p.fine_amount_ils ?? null)
            : null,

        commander_name: nullIfEmpty(p.commanderName) ?? "",
        report_type: nullIfEmpty(p.reportType) ?? "",
        report_filled_time: nullIfEmpty(p.reportFilledTime) ?? "",

        fan_name: nullIfEmpty(p.fanName) ?? "",
        fan_phone: nullIfEmpty(p.fanPhone) ?? "",
        fan_id: nullIfEmpty(p.fanId),
        fan_address: nullIfEmpty(p.fanAddress),
        ticket_type: nullIfEmpty(p.ticketType),
        birth_date: nullIfEmpty(p.birthDate),

        adult_minor: nullIfEmpty(p.adultMinor),
        father_name: nullIfEmpty(p.fatherName),
        mother_name: nullIfEmpty(p.motherName),
        parent_phone: nullIfEmpty(p.parentPhone),
        parent_address: nullIfEmpty(p.parentAddress),

        stand: nullIfEmpty(p.stand),
        gate: nullIfEmpty(p.gate),
        block: nullIfEmpty(p.block),

        approx_time: nullIfEmpty(p.approxTime),

        offense_type: nullIfEmpty(p.offenseType),
        offense_description: String(p.offenseDesc || "").trim(),
        fan_reaction: nullIfEmpty(p.fanReaction),

        general_notes: nullIfEmpty(p.generalNotes),
        updated_at: p.updatedAt || new Date().toISOString(),
      };

      Object.keys(serverRow).forEach((k) => {
        if (serverRow[k] === null || serverRow[k] === undefined) delete serverRow[k];
      });

      const { data: upData, error: upErr } = await supabase
        .from(REPORTS_TABLE)
        .upsert(serverRow, { onConflict: "local_id" })
        .select("*")
        .single();

      if (upErr) {
        console.error("SUPABASE UPSERT ERROR:", upErr);
        await bumpQueueError(
          item.qid,
          `${upErr.code || ""} ${upErr.message || "Sync error"}`
        );
        failed++;
        continue;
      }

      const reportDbId = upData?.id;
      if (!reportDbId) {
        await bumpQueueError(item.qid, "Missing upserted report id");
        failed++;
        continue;
      }

      const tasks = [];

      if (p.idPhotoKey && !upData.id_photo_url) {
        tasks.push((async () => {
          const f = await getFile(p.idPhotoKey);
          if (!f?.blob) return null;
          const ext = extFromMime(f.type);
          const path = `${reportDbId}/id-${Date.now()}.${ext}`;
          const { publicUrl } = await uploadBlobToBucket({
            bucket: "report-id",
            path,
            blob: f.blob,
            contentType: f.type,
          });
          return { id_photo_path: path, id_photo_url: publicUrl };
        })());
      }

      if (p.ticketPhotoKey && !upData.ticket_photo_url) {
        tasks.push((async () => {
          const f = await getFile(p.ticketPhotoKey);
          if (!f?.blob) return null;
          const ext = extFromMime(f.type);
          const path = `${reportDbId}/ticket-${Date.now()}.${ext}`;
          const { publicUrl } = await uploadBlobToBucket({
            bucket: "report-ticket",
            path,
            blob: f.blob,
            contentType: f.type,
          });
          return { ticket_photo_path: path, ticket_photo_url: publicUrl };
        })());
      }

      if (p.signature && String(p.signature).startsWith("data:image") && !upData.signature_url) {
        tasks.push((async () => {
          const sigBlob = dataUrlToBlob(p.signature);
          if (!sigBlob) return null;
          const path = `${reportDbId}/signature-${Date.now()}.png`;
          const { publicUrl } = await uploadBlobToBucket({
            bucket: "report-signature",
            path,
            blob: sigBlob,
            contentType: "image/png",
          });
          return { signature_path: path, signature_url: publicUrl };
        })());
      }

      const results = await Promise.allSettled(tasks);
      const updates = {};
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) Object.assign(updates, r.value);
      }

      if (Object.keys(updates).length) {
        updates.updated_at = new Date().toISOString();
        const { error: imgUpErr } = await supabase
          .from(REPORTS_TABLE)
          .update(updates)
          .eq("id", reportDbId);
        if (imgUpErr) console.warn("DB UPDATE (paths/urls) failed:", imgUpErr);
      }

      await dequeue(item.qid);
      await updateReport(reportId, { status: "synced" });
      synced++;
    } catch (e) {
      console.error("SYNC EXCEPTION:", e);
      await bumpQueueError(item.qid, String(e?.message || e));
      failed++;
    }
  }

  return { synced, failed };
}

/* ===== Nav controls ===== */
btnBack?.addEventListener("click", () => setStep(currentStep - 1));

btnNext?.addEventListener("click", async () => {
  hideMsg();
  const payload = getPayload();
  const err = validateStep(currentStep, payload);
  if (err) {
    showMsg(`לא ניתן להמשיך: ${err}`, "error");
    return;
  }
  setStep(currentStep + 1);
});

btnSaveDraft?.addEventListener("click", saveDraft);
btnFinish?.addEventListener("click", finishReport);

btnExit?.addEventListener("click", () => {
  localStorage.removeItem(SESSION_KEY);
  clearCurrentReportId();
  window.location.href = "./index.html";
});

window.addEventListener("online", tryProcessQueue);
window.addEventListener("offline", updateNetworkStatus);

document.getElementById("reportType")?.addEventListener("change", setHeaderDateAndTitle);
document.getElementById("reportFilledTime")?.addEventListener("change", setHeaderDateAndTitle);

window.addEventListener("resize", () => {
  if (currentStep === 4) {
    sigReady = false;
    setTimeout(() => setupSignatureCanvas(), 80);
  }
});

/* ===== Init ===== */
(async () => {
  const userPin = loadSessionPin();
  if (!userPin) {
    window.location.href = "./index.html";
    return;
  }

  // ✅ אם אין club ב-HTML (בטעות) — ננסה להוציא מ-data-club של main
  if (clubEl && !String(clubEl.value || "").trim()) {
    const fromMain = document.querySelector("main[data-club]")?.getAttribute("data-club");
    clubEl.value = String(fromMain || "").trim() || "gen";
  }

  const now = new Date();
  const t = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (reportFilledTimeEl && !reportFilledTimeEl.value) reportFilledTimeEl.value = t;

  if (approxTimeEl && !approxTimeTouched && !String(approxTimeEl.value || "").trim()) {
    approxTimeEl.value = reportFilledTimeEl?.value || "";
  }

  if (policeInterventionEl && !policeInterventionEl.value) {
    policeInterventionEl.value = "false";
  }
  applyPoliceUI();

  setHeaderDateAndTitle();
  await updateNetworkStatus();

  const rid = getCurrentReportId();
  if (rid) {
    const report = await getReport(rid);
    if (report?.payload) {
      setPayload(report.payload);
      showMsg("נטענה טיוטה מהזיכרון 📝");
    }
  } else {
    await startNewDraft(userPin);
  }

  setStep(1);
  await tryProcessQueue();
})();
