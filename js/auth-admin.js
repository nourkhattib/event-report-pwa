import { supabase, checkOnline } from "./supabase.js";

const pinInput = document.getElementById("adminPin");
const btnEnter = document.getElementById("btnAdminEnter");
const msgBox = document.getElementById("msg");

const netPill = document.getElementById("netPill");
const netText = document.getElementById("netText");

const STORAGE_KEY = "admin_session_pin";
const SESSION_TTL = 1000 * 60 * 60 * 8; // 8 שעות

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

function isValidPin(pin) {
  return /^[0-9]{4}$/.test(pin);
}

function saveLocalSession(pin) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ pin, time: Date.now() }));
}

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

async function handleLogin() {
  hideMsg();

  const pin = (pinInput.value || "").trim();
  if (!isValidPin(pin)) {
    showMsg("יש להזין קוד מנהל בן 4 ספרות", "error");
    return;
  }

  btnEnter.disabled = true;
  btnEnter.textContent = "בודק…";

  const online = await updateNetworkStatus();
  if (!online) {
    showMsg("כניסת מנהל דורשת אינטרנט", "error");
    btnEnter.disabled = false;
    btnEnter.textContent = "כניסה";
    return;
  }

  try {
    const pinNum = Number(pin);

    const { data, error } = await supabase
      .from("admin_pins")
      .select("id, pin, active, full_name")
      .eq("pin", pinNum)
      .eq("active", true)
      .maybeSingle();

    if (error) {
      console.error(error);
      showMsg("שגיאת שרת: " + error.message, "error");
      btnEnter.disabled = false;
      btnEnter.textContent = "כניסה";
      return;
    }

    if (!data) {
      showMsg("קוד מנהל שגוי או לא פעיל", "error");
      btnEnter.disabled = false;
      btnEnter.textContent = "כניסה";
      return;
    }

    saveLocalSession(pin);
    window.location.href = "./admin.html";
  } catch (e) {
    console.error(e);
    showMsg("שגיאה זמנית, נסה שוב", "error");
    btnEnter.disabled = false;
    btnEnter.textContent = "כניסה";
  }
}

btnEnter?.addEventListener("click", handleLogin);

pinInput?.addEventListener("input", () => {
  pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 4);
});

pinInput?.addEventListener("keyup", (e) => {
  if (e.key === "Enter") handleLogin();
});

(async () => {
  await updateNetworkStatus();

  const session = loadLocalSession();
  if (session) {
    window.location.href = "./admin.html";
  }
})();
