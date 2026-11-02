/* =========================================
   offline.js
   IndexedDB + Queue for Offline-First
   ========================================= */

const DB_NAME = "maccabi_reports_db";
const DB_VERSION = 1;

const STORE_REPORTS = "reports";     // כל הדוחות (כולל טיוטות)
const STORE_QUEUE = "queue";         // תור פעולות (שליחת דוח/העלאת תמונות)
const STORE_FILES = "files";         // תמונות/קבצים (Blob)

/**
 * report object example:
 * {
 *   id: "local-uuid",
 *   status: "draft|queued|synced|failed",
 *   createdAt, updatedAt,
 *   payload: {...form fields...},
 *   files: ["fileKey1","fileKey2"]
 * }
 */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORE_REPORTS)) {
        const store = db.createObjectStore(STORE_REPORTS, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const store = db.createObjectStore(STORE_QUEUE, { keyPath: "qid" });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function genId(prefix = "local") {
  // UUID-lite בלי תלות בספריות
  return `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2)}`;
}

/* =========================
   Reports
   ========================= */

export async function createDraftReport(payload = {}, files = []) {
  const db = await openDB();
  const now = new Date().toISOString();

  const report = {
    id: genId("report"),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    payload,
    files, // array of file keys in STORE_FILES
  };

  await new Promise((resolve, reject) => {
    const store = tx(db, STORE_REPORTS, "readwrite");
    const req = store.put(report);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });

  db.close();
  return report;
}

export async function updateReport(reportId, patch = {}) {
  const db = await openDB();

  const existing = await getReport(reportId);
  if (!existing) {
    db.close();
    throw new Error("Report not found");
  }

  const updated = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await new Promise((resolve, reject) => {
    const store = tx(db, STORE_REPORTS, "readwrite");
    const req = store.put(updated);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });

  db.close();
  return updated;
}

export async function getReport(reportId) {
  const db = await openDB();

  const report = await new Promise((resolve, reject) => {
    const store = tx(db, STORE_REPORTS, "readonly");
    const req = store.get(reportId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });

  db.close();
  return report;
}

export async function listReports({ status = null } = {}) {
  const db = await openDB();

  const result = await new Promise((resolve, reject) => {
    const store = tx(db, STORE_REPORTS, "readonly");
    const req = store.getAll();
    req.onsuccess = () => {
      const arr = req.result || [];
      const filtered = status ? arr.filter((r) => r.status === status) : arr;
      // newest first
      filtered.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      resolve(filtered);
    };
    req.onerror = () => reject(req.error);
  });

  db.close();
  return result;
}

export async function deleteReport(reportId) {
  const db = await openDB();

  // מחיקת קבצים משויכים
  const report = await getReport(reportId);
  if (report?.files?.length) {
    await Promise.all(report.files.map((k) => deleteFile(k)));
  }

  await new Promise((resolve, reject) => {
    const store = tx(db, STORE_REPORTS, "readwrite");
    const req = store.delete(reportId);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });

  db.close();
}

/* =========================
   Files (Images)
   ========================= */

export async function saveFiles(fileList) {
  // fileList: File[] or Blob[] (File preferred)
  const db = await openDB();
  const keys = [];

  for (const f of Array.from(fileList || [])) {
    const key = genId("file");
    const fileObj = {
      key,
      name: f.name || "image",
      type: f.type || "application/octet-stream",
      size: f.size || null,
      blob: f, // Blob/File is storable
      createdAt: new Date().toISOString(),
    };

    await new Promise((resolve, reject) => {
      const store = tx(db, STORE_FILES, "readwrite");
      const req = store.put(fileObj);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });

    keys.push(key);
  }

  db.close();
  return keys;
}

export async function getFile(fileKey) {
  const db = await openDB();

  const fileObj = await new Promise((resolve, reject) => {
    const store = tx(db, STORE_FILES, "readonly");
    const req = store.get(fileKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });

  db.close();
  return fileObj;
}

export async function deleteFile(fileKey) {
  const db = await openDB();

  await new Promise((resolve, reject) => {
    const store = tx(db, STORE_FILES, "readwrite");
    const req = store.delete(fileKey);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });

  db.close();
}

/* =========================
   Queue (Sync)
   ========================= */

export async function enqueue(type, payload) {
  const db = await openDB();
  const item = {
    qid: genId("q"),
    type, // "SYNC_REPORT" | "UPLOAD_FILE" | etc.
    payload,
    createdAt: new Date().toISOString(),
    tries: 0,
    lastError: null,
  };

  await new Promise((resolve, reject) => {
    const store = tx(db, STORE_QUEUE, "readwrite");
    const req = store.put(item);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });

  db.close();
  return item;
}

export async function listQueue() {
  const db = await openDB();

  const items = await new Promise((resolve, reject) => {
    const store = tx(db, STORE_QUEUE, "readonly");
    const req = store.getAll();
    req.onsuccess = () => {
      const arr = req.result || [];
      arr.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      resolve(arr);
    };
    req.onerror = () => reject(req.error);
  });

  db.close();
  return items;
}

export async function dequeue(qid) {
  const db = await openDB();

  await new Promise((resolve, reject) => {
    const store = tx(db, STORE_QUEUE, "readwrite");
    const req = store.delete(qid);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });

  db.close();
}

export async function bumpQueueError(qid, errorMessage = "Unknown error") {
  const db = await openDB();

  const item = await new Promise((resolve, reject) => {
    const store = tx(db, STORE_QUEUE, "readonly");
    const req = store.get(qid);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });

  if (!item) {
    db.close();
    return;
  }

  const updated = {
    ...item,
    tries: (item.tries || 0) + 1,
    lastError: errorMessage,
  };

  await new Promise((resolve, reject) => {
    const store = tx(db, STORE_QUEUE, "readwrite");
    const req = store.put(updated);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
  });

  db.close();
}

/* =========================
   High-level helpers for report flow
   ========================= */

/**
 * Save a report as draft (and store files if provided)
 * returns { report, fileKeys }
 */
export async function saveDraftWithFiles(payload, files) {
  const fileKeys = await saveFiles(files || []);
  const report = await createDraftReport(payload, fileKeys);
  return { report, fileKeys };
}

/**
 * Mark report for sending (queue it)
 */
export async function queueReportForSync(reportId) {
  await updateReport(reportId, { status: "queued" });
  return enqueue("SYNC_REPORT", { reportId });
}

/**
 * Simple network online check
 */
export function isNavigatorOnline() {
  return navigator.onLine;
}
