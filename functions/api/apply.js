/**
 * POST /api/apply
 *
 * Receives a contact / application form payload from the frontend and
 * forwards it to Formspree. Used for:
 *   - General contact inquiries
 *   - Tier 4 (Ordination) application intake
 *   - Tier 5 (Mentorship) "By Selection Only" application intake
 *
 * Request JSON:
 *   {
 *     "name":      "Full Name",         (required)
 *     "email":     "you@example.com",   (required)
 *     "phone":     "+1 555 0100",       (optional)
 *     "reason":    "Free-form label, e.g. 'Inner Healing', 'Ordination',
 *                   'Mentorship', 'General Question'",   (required)
 *     "message":   "Body of the message.",               (required)
 *     "consent":   true                                  (required; must be true)
 *   }
 *
 * Response JSON:
 *   { "ok": true }                  on success
 *   { "ok": false, "error": "..." } on failure
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.FORMSPREE_FORM_ID) {
    return jsonResponse({ ok: false, error: "Server is missing FORMSPREE_FORM_ID." }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const { name, email, phone, reason, message, consent } = payload || {};

  if (typeof name !== "string" || !name.trim()) {
    return jsonResponse({ ok: false, error: "'name' is required." }, 400);
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return jsonResponse({ ok: false, error: "A valid 'email' is required." }, 400);
  }
  if (typeof reason !== "string" || !reason.trim()) {
    return jsonResponse({ ok: false, error: "'reason' is required." }, 400);
  }
  if (typeof message !== "string" || !message.trim()) {
    return jsonResponse({ ok: false, error: "'message' is required." }, 400);
  }
  if (consent !== true) {
    return jsonResponse(
      { ok: false, error: "Consent (consent: true) is required to submit." },
      400
    );
  }

  const formspreeBody = {
    name: name.trim(),
    email: email.trim(),
    phone: typeof phone === "string" ? phone.trim() : "",
    reason: reason.trim(),
    message: message.trim(),
    _subject: `UGFC inquiry — ${reason.trim()}`,
    consent: "Yes (acknowledged on form)",
    submitted_at: new Date().toISOString(),
  };

  const fsResp = await fetch(`https://formspree.io/f/${env.FORMSPREE_FORM_ID}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(formspreeBody),
  });

  if (!fsResp.ok) {
    const fsJson = await fsResp.json().catch(() => ({}));
    const message =
      (fsJson && (fsJson.error || (fsJson.errors && fsJson.errors[0] && fsJson.errors[0].message))) ||
      "Formspree submission failed.";
    return jsonResponse({ ok: false, error: message }, 502);
  }

  return jsonResponse({ ok: true });
}

export async function onRequest({ request }) {
  if (request.method === "POST") return onRequestPost(arguments[0]);
  return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
}
