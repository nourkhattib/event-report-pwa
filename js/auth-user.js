/* =========================================
   auth-user.js
   User login with 4-digit PIN
   Offline-first
   ========================================= */

import { supabase, checkOnline } from "./supabase.js";

const pinInput = document.getElementById("pin4");
const btnEnter = document.getElementById("btnEnter");
const msgBox = document.getElementById("msg");

const netPill = document.getElementById("netPill");
const netText = document.getElementById("netText");

const STORAGE_KEY = "user_session_pin";
const SESSION_TTL = 1000 * 60 * 60 * 6; // 6 שעות

/* ---------- UI helpers ---------- */
function showMsg(text, type = "info") {
  msgBox.textContent = text;
  msgBox.classList.remove("hidden");
  msgBox.style.borderColor =
    type === "error" ? "rgba(180,35,24,.4)" : "rgba(11,78,162,.25)";
  msgBox.style.background =
    type === "error" ? "rgba(180,35,24,.06)" : "rgba(11,78,162,.06)";
}

function hideMsg() {
  msgBox.classList.add("hidden");
}

/* ---------- Network status ---------- */
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

/* ---------- PIN validation ---------- */
function isValidPin(pin) {
  return /^[0-9]{4}$/.test(pin);
}

/* ---------- Save local session ---------- */
function saveLocalSession(pin) {
  const payload = { pin, time: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

/* ---------- Load local session ---------- */
function loadLocalSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const data = JSON.parse(raw);
    if (!data?.pin || !data?.time) return null;

    if (Date.now() - data.time > SESSION_TTL) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/* ---------- Auth flow ---------- */
async function handleLogin() {
  hideMsg();

  const pin = (pinInput.value || "").trim();

  if (!isValidPin(pin)) {
    showMsg("יש להזין קוד בן 4 ספרות בלבד", "error");
    return;
  }

  btnEnter.disabled = true;
  btnEnter.textContent = "בודק קוד…";

  const online = await updateNetworkStatus();

  // ---- OFFLINE MODE ----
  if (!online) {
    saveLocalSession(pin);
    window.location.href = "./report.html";
    return;
  }

  // ---- ONLINE MODE ----
  try {
    const { data, error } = await supabase
      .from("user_pins")
      .select("id")
      .eq("pin", pin)
      .eq("active", true)
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      showMsg("קוד שגוי או לא פעיל", "error");
      btnEnter.disabled = false;
      btnEnter.textContent = "כניסה למילוי דוח";
      return;
    }

    saveLocalSession(pin);
    window.location.href = "./report.html";
  } catch (e) {
    console.error(e);
    showMsg("שגיאה זמנית, נסה שוב", "error");
    btnEnter.disabled = false;
    btnEnter.textContent = "כניסה למילוי דוח";
  }
}

/* ---------- Events ---------- */
btnEnter?.addEventListener("click", handleLogin);

pinInput?.addEventListener("input", () => {
  pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 4);
});

pinInput?.addEventListener("keyup", (e) => {
  if (e.key === "Enter") handleLogin();
});

// עדכון אוטומטי של סטטוס רשת
window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);

/* ---------- Init ---------- */
(async () => {
  await updateNetworkStatus();

  // auto-login if valid local session exists
  const session = loadLocalSession();
  if (session) {
    window.location.href = "./report.html";
  }
})();
