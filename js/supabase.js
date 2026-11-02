/* =========================================
   Supabase Client
   Single source of truth
   ========================================= */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ====== CONFIG ======
export const SUPABASE_URL = "https://eaetlhzrlfrknnipmjtw.supabase.co";

export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhZXRsaHpybGZya25uaXBtanR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5ODIyMjQsImV4cCI6MjA4MzU1ODIyNH0.15EJb1uEOTJ81bxo3ZnOLwgpOAqoT8vXJxfp_FegmrQ";

// ✅ Tenant קבוע לפרויקט הזה (Meteor - General)
export const TENANT = "GEN";

// ====== CLIENT ======
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  global: {
    headers: {
      "x-client-info": "meteor-report-system",
      // לא חובה, אבל עוזר לדיבוג בלוגים/פונקציות אם תרצה בעתיד
      "x-tenant": TENANT,
    },
  },
});

// ====== CONNECTION HELPERS ======

/**
 * Check if Supabase is reachable (online).
 * This checks connectivity to the project (not DB/RLS).
 */
export async function checkOnline() {
  if (navigator.onLine === false) return false;

  const timedFetch = async (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        cache: "no-store",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          ...(options.headers || {}),
        },
      });
      return res;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const res = await timedFetch(`${SUPABASE_URL}/auth/v1/health`, { method: "GET" });
    if (res.ok) return true;
  } catch {}

  try {
    const res = await timedFetch(`${SUPABASE_URL}/rest/v1/`, { method: "HEAD" });
    return !!res;
  } catch {
    return false;
  }
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session;
}

export async function logout() {
  await supabase.auth.signOut();
}
