/**
 * POST /api/stripe-webhook
 *
 * Receives Stripe webhook events. Verifies the signature using the Web Crypto
 * API (HMAC-SHA256) — the Cloudflare Workers runtime has no Node `crypto`
 * library, so we cannot use the stripe-node SDK's constructEvent helper.
 *
 * On a verified `checkout.session.completed` event:
 *   - Reads metadata.offering and metadata.priceIdRef
 *   - Routes the customer email into the appropriate MailerLite group
 *   - For freewill streams, logs only (no list enrollment)
 *
 * Always returns 200 to Stripe after we've decided the signature is valid
 *   and we've finished routing, so Stripe does not retry. We return 4xx
 *   only for signature / parsing failures.
 *
 * Required env vars:
 *   STRIPE_WEBHOOK_SECRET
 *   MAILERLITE_API_KEY
 *   MAILERLITE_GROUP_*   (mirrors subscribe.js)
 */

// Maps the value passed in session.metadata.offering to the env var that
// holds the MailerLite group ID for that program. Both hyphenated forms
// (sent by the front-end buttons, e.g. "deliverance-course-plan") and
// underscored forms are accepted — the lookup function normalizes
// hyphens to underscores before reading from this map.

const OFFERING_TO_GROUP_ENV = {
  inner_healing: "MAILERLITE_GROUP_INNER_HEALING",
  deliverance_course: "MAILERLITE_GROUP_DELIVERANCE_COURSE",
  gauntlet: "MAILERLITE_GROUP_GAUNTLET",
  ordination: "MAILERLITE_GROUP_ORDINATION",
  mentorship: "MAILERLITE_GROUP_MENTORSHIP",
  // freewill handled separately — log only
};

// Convert an incoming offering value to the canonical key used in
// OFFERING_TO_GROUP_ENV. Lowercases and replaces hyphens with underscores
// so the front-end ("deliverance-course") matches the underscored map keys.
function normalizeOffering(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase().replace(/-/g, "_");
}

const SIGNATURE_TOLERANCE_SECONDS = 300; // Stripe default: 5 minutes

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
}

/**
 * Convert an ArrayBuffer to lowercase hex.
 */
function bufToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Constant-time string comparison. Both inputs must be the same length;
 * if not, returns false without leaking length via timing.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verify a Stripe signature header against the raw request body.
 * Returns { valid: boolean, reason?: string }.
 */
async function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || typeof signatureHeader !== "string") {
    return { valid: false, reason: "Missing Stripe-Signature header." };
  }
  if (!secret) {
    return { valid: false, reason: "Server missing STRIPE_WEBHOOK_SECRET." };
  }

  const parts = {};
  for (const piece of signatureHeader.split(",")) {
    const [k, v] = piece.split("=");
    if (!k || !v) continue;
    if (parts[k]) {
      // Multiple v1 entries are allowed; collect them as an array.
      parts[k] = Array.isArray(parts[k]) ? [...parts[k], v] : [parts[k], v];
    } else {
      parts[k] = v;
    }
  }

  const timestamp = parts.t;
  let v1List = parts.v1 || [];
  if (typeof v1List === "string") v1List = [v1List];

  if (!timestamp || v1List.length === 0) {
    return { valid: false, reason: "Malformed Stripe-Signature header." };
  }

  const tsNum = parseInt(timestamp, 10);
  if (!Number.isFinite(tsNum)) {
    return { valid: false, reason: "Non-numeric timestamp." };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > SIGNATURE_TOLERANCE_SECONDS) {
    return { valid: false, reason: "Timestamp outside tolerance window." };
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const expected = bufToHex(sigBuf);

  for (const candidate of v1List) {
    if (timingSafeEqual(expected, candidate)) {
      return { valid: true };
    }
  }
  return { valid: false, reason: "No v1 signature matched." };
}

/**
 * Add a subscriber to a single MailerLite group. Best-effort: on failure we
 * log and continue so we still return 200 to Stripe (Stripe will not retry
 * if we don't ask it to).
 */
async function addToMailerLiteGroup(env, email, groupId, name) {
  if (!env.MAILERLITE_API_KEY || !groupId || !email) return { ok: false };

  const body = { email, status: "active", groups: [String(groupId)] };
  if (name) {
    const [first, ...rest] = name.trim().split(/\s+/);
    body.fields = { name: first, last_name: rest.join(" ") };
  }

  try {
    const r = await fetch("https://connect.mailerlite.com/api/subscribers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MAILERLITE_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.log("MailerLite group enroll failed:", r.status, txt);
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.log("MailerLite group enroll exception:", err && err.message);
    return { ok: false };
  }
}

export async function onRequestPost({ request, env }) {
  // We must read the body as raw text for signature verification. Do NOT
  // call request.json() here — that would consume the stream and we'd lose
  // the exact bytes Stripe signed.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("stripe-signature");

  const verify = await verifyStripeSignature(rawBody, signatureHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!verify.valid) {
    return textResponse(`Webhook signature verification failed: ${verify.reason}`, 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return textResponse("Webhook payload not valid JSON.", 400);
  }

  const eventType = event && event.type;
  if (eventType !== "checkout.session.completed") {
    // Acknowledge other event types so Stripe stops sending them.
    return textResponse(`Ignored event type: ${eventType}`, 200);
  }

  const session = (event.data && event.data.object) || {};
  const metadata = session.metadata || {};
  const offering = normalizeOffering(metadata.offering || "");
  const sowStream = metadata.sowStream || "";
  const email =
    session.customer_details?.email ||
    session.customer_email ||
    null;
  const name = session.customer_details?.name || null;

  if (offering === "freewill") {
    // Log only — no list enrollment for freewill gifts.
    console.log(`[freewill] stream=${sowStream} email=${email || "(none)"} session=${session.id}`);
    return textResponse("ok", 200);
  }

  const groupEnvKey = OFFERING_TO_GROUP_ENV[offering];
  if (!groupEnvKey) {
    console.log(`[checkout.completed] unmapped offering=${offering} session=${session.id}`);
    return textResponse("ok", 200);
  }

  const groupId = env[groupEnvKey];
  if (!groupId) {
    console.log(`[checkout.completed] env var ${groupEnvKey} not set; skipping enroll`);
    return textResponse("ok", 200);
  }

  if (!email) {
    console.log(`[checkout.completed] no email on session ${session.id}; cannot enroll`);
    return textResponse("ok", 200);
  }

  await addToMailerLiteGroup(env, email, groupId, name);
  return textResponse("ok", 200);
}

export async function onRequest({ request }) {
  if (request.method === "POST") return onRequestPost(arguments[0]);
  return textResponse("Method not allowed.", 405);
}
