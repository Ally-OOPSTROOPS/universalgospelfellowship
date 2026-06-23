/**
 * POST /api/subscribe
 *
 * Subscribes an email address to MailerLite via the MailerLite v2 ("Connect")
 * API, optionally assigning the subscriber to one or more groups.
 *
 * Request JSON:
 *   {
 *     "email":   "person@example.com",   (required)
 *     "name":    "First Last",            (optional)
 *     "groups":  ["general", "deliverance_course"]    (optional logical names)
 *   }
 *
 * The frontend passes logical group names (lowercase tokens). This handler
 * translates them into MailerLite Group IDs via env vars (see GROUP_NAME_TO_ENV
 * below). Unknown group names are dropped, not echoed back as IDs.
 *
 * Response JSON:
 *   { "ok": true,  "id": "MailerLite subscriber id" }    on success
 *   { "ok": false, "error": "..." }                       on failure
 */

const GROUP_NAME_TO_ENV = {
  general: "MAILERLITE_GROUP_GENERAL",
  inner_healing: "MAILERLITE_GROUP_INNER_HEALING",
  deliverance_course: "MAILERLITE_GROUP_DELIVERANCE_COURSE",
  gauntlet: "MAILERLITE_GROUP_GAUNTLET",
  ordination: "MAILERLITE_GROUP_ORDINATION",
  mentorship: "MAILERLITE_GROUP_MENTORSHIP",
  freewill: "MAILERLITE_GROUP_FREEWILL",
};

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
  if (!env.MAILERLITE_API_KEY) {
    return jsonResponse({ ok: false, error: "Server is missing MAILERLITE_API_KEY." }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const { email, name, groups } = payload || {};

  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return jsonResponse({ ok: false, error: "A valid 'email' is required." }, 400);
  }

  // Resolve logical group names to env-var Group IDs.
  let groupIds = [];
  if (Array.isArray(groups)) {
    for (const g of groups) {
      if (typeof g !== "string") continue;
      const envKey = GROUP_NAME_TO_ENV[g.trim().toLowerCase()];
      if (!envKey) continue;
      const gid = env[envKey];
      if (gid) groupIds.push(String(gid));
    }
  }

  // Always include the general list if no specific group resolved AND the env
  // var is defined. This prevents subscribers from being orphaned.
  if (groupIds.length === 0 && env.MAILERLITE_GROUP_GENERAL) {
    groupIds.push(String(env.MAILERLITE_GROUP_GENERAL));
  }

  const body = {
    email: email.trim(),
    status: "active",
  };

  if (typeof name === "string" && name.trim()) {
    // MailerLite splits names into first / last via the `fields` object.
    const trimmed = name.trim();
    const [first, ...rest] = trimmed.split(/\s+/);
    body.fields = {
      name: first,
      last_name: rest.join(" "),
    };
  }

  if (groupIds.length) {
    body.groups = groupIds;
  }

  const mlResp = await fetch("https://connect.mailerlite.com/api/subscribers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.MAILERLITE_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const mlJson = await mlResp.json().catch(() => ({}));

  if (!mlResp.ok) {
    const message =
      (mlJson && (mlJson.message || (mlJson.error && mlJson.error.message))) ||
      "MailerLite subscription failed.";
    return jsonResponse({ ok: false, error: message }, 502);
  }

  return jsonResponse({
    ok: true,
    id: (mlJson && mlJson.data && mlJson.data.id) || null,
  });
}

export async function onRequest({ request }) {
  if (request.method === "POST") return onRequestPost(arguments[0]);
  return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
}
