import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ADMIN_PIN = Deno.env.get("ADMIN_PIN") ?? "";
const ADMIN_JWT_SECRET = Deno.env.get("ADMIN_JWT_SECRET") ?? "";

// base64url encode
function b64url(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  const b64 = btoa(s);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signJwt(payload: Record<string, any>) {
  const header = { alg: "HS256", typ: "JWT" };

  const enc = (obj: any) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const h = enc(header);
  const p = enc(payload);
  const data = `${h}.${p}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(ADMIN_JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const sig = b64url(new Uint8Array(sigBuf));

  return `${data}.${sig}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    if (!ADMIN_PIN || !ADMIN_JWT_SECRET) {
      return json(
        { ok: false, error: "Missing ENV: ADMIN_PIN / ADMIN_JWT_SECRET" },
        500
      );
    }

    const body = await req.json().catch(() => ({}));
    const pin = String(body?.pin ?? "").replace(/\D/g, "");

    if (!/^\d{9}$/.test(pin)) {
      return json({ ok: false, error: "Invalid PIN format" }, 400);
    }

    if (pin !== ADMIN_PIN) {
      return json({ ok: false, error: "Wrong PIN" }, 401);
    }

    const expSeconds = Math.floor(Date.now() / 1000) + 60 * 60 * 12; // 12 שעות
    const token = await signJwt({ role: "admin", exp: expSeconds });

    return json(
      {
        ok: true,
        token,
        expires_at: new Date(expSeconds * 1000).toISOString(),
      },
      200
    );
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
});
