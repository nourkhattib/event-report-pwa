import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-pin",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ADMIN_PIN = Deno.env.get("ADMIN_PIN") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    if (!ADMIN_PIN) return json({ ok: false, error: "Missing ENV: ADMIN_PIN" }, 500);
    if (!SUPABASE_URL || !SERVICE_ROLE)
      return json({ ok: false, error: "Missing ENV: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);

    // ✅ PIN מגיע מה-Header
    const pin = (req.headers.get("x-admin-pin") || "").replace(/\D/g, "");
    if (!/^\d{9}$/.test(pin)) return json({ ok: false, error: "Missing/Invalid admin pin" }, 401);
    if (pin !== ADMIN_PIN) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body?.limit ?? 200) || 200, 500);

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // ✅ לפי העמודות האמיתיות בטבלה שלך (אין payload!)
    const { data, error } = await supabase
      .from("reports")
      .select(
        "id, local_id, user_pin, created_at, report_type, fan_name, fan_phone"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, data: data || [] }, 200);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
});
