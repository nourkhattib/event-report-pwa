import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-pin",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_PIN = Deno.env.get("ADMIN_PIN") ?? "";

// allowlist columns we permit updating
const ALLOWED = new Set([
  "commander_name","report_type","report_filled_time",
  "fan_name","fan_phone","fan_id","fan_address","ticket_type","birth_date","adult_minor",
  "father_name","mother_name","parent_phone","parent_address",
  "stand","gate","block","approx_time","offense_type","offense_description","fan_reaction",
  "general_notes","signature","updated_at",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const pin = (req.headers.get("x-admin-pin") || "").replace(/\D/g, "");
    if (!ADMIN_PIN || pin !== ADMIN_PIN) return json({ ok: false, error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "");
    const patchIn = body?.patch || {};
    if (!id) return json({ ok: false, error: "Missing id" }, 400);

    const patch: Record<string, any> = {};
    for (const k of Object.keys(patchIn)) {
      if (ALLOWED.has(k)) patch[k] = patchIn[k];
    }
    patch.updated_at = new Date().toISOString();

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data, error } = await supabase
      .from("reports")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 400);
    if (!data) return json({ ok: false, error: "Not found" }, 404);

    return json({ ok: true, data }, 200);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
});
