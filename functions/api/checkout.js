/**
 * POST /api/checkout
 *
 * Creates a Stripe Checkout Session via the Stripe REST API (no SDK; the
 * Cloudflare Workers runtime does not provide Node built-ins).
 *
 * Request JSON:
 *   {
 *     "offering":    "inner-healing" | "deliverance-course" | "deliverance-course-plan"
 *                  | "gauntlet" | "gauntlet-plan"
 *                  | "ordination" | "ordination-installment" | "mentorship"
 *                  | "freewill",
 *     "priceIdRef":  e.g. "PRICE_INNER_HEALING"  (must appear in PRICE_REF_ALLOWLIST below),
 *     "sowStream":   "ally" | "swat" | "work"     (required only when offering === "freewill"),
 *     "email":       optional pre-fill for Stripe Checkout
 *   }
 *
 * Pricing (as of this build):
 *   PUBLIC PAGE shows only the free gift (email opt-in, NOT Stripe) and:
 *     66-Day Gauntlet:             $777 single-payment seed offering   (PRICE_GAUNTLET)
 *   OFFERED RELATIONALLY / BY EMAIL (not shown on the public page):
 *     Inner Healing Session:       $77                                 (PRICE_INNER_HEALING)
 *     Deliverance Course (self-paced): $497                            (PRICE_DELIVERANCE_COURSE)
 *     Bespoke Mentorship:          custom_unit_amount, by invitation   (PRICE_MENTORSHIP)
 *     Bespoke Ordination:          custom_unit_amount, by selection    (PRICE_ORDINATION)
 *   Price refs remain allow-listed so email-driven checkout links still work.
 *   No Pioneer pricing on this site.
 *
 * Response JSON:
 *   { "url": "https://checkout.stripe.com/..." }   on success
 *   { "error": "..." }                              on failure
 *
 * Tier 4 (Ordination) presumes application approval has already happened
 *   upstream; the frontend should gate the request behind that.
 * Tier 5 (Mentorship) is "By Selection Only" — the frontend must gate this
 *   checkout behind your written acceptance of the applicant. The Stripe
 *   Price for PRICE_MENTORSHIP must be configured with custom_unit_amount
 *   enabled so the bespoke negotiated rate is entered at checkout.
 *
 * Freewill price IDs must be configured in the Stripe dashboard with
 *   custom_unit_amount enabled so the donor chooses the amount.
 */

// Allow-list of priceIdRef values the frontend may pass in. Each maps to a
// Cloudflare Pages environment variable holding the actual Stripe Price ID.
// Anything not on this list is rejected before we ever talk to Stripe.
//
const PRICE_REF_ALLOWLIST = new Set([
  "PRICE_INNER_HEALING",
  "PRICE_DELIVERANCE_COURSE",
  "PRICE_GAUNTLET",
  "PRICE_ORDINATION",
  "PRICE_MENTORSHIP",
  "PRICE_FREEWILL_ALLY",
  "PRICE_FREEWILL_SWAT",
  "PRICE_FREEWILL_WORK",
]);

// Map sowStream value to the env var holding the freewill Stripe Price ID.
const FREEWILL_STREAM_TO_PRICE_REF = {
  ally: "PRICE_FREEWILL_ALLY",
  swat: "PRICE_FREEWILL_SWAT",
  work: "PRICE_FREEWILL_WORK",
};

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
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const { offering, priceIdRef, sowStream, email } = payload || {};

  if (!offering || typeof offering !== "string") {
    return jsonResponse({ error: "Missing or invalid 'offering'." }, 400);
  }

  // Resolve which env var to read for the Stripe Price ID.
  let resolvedRef = priceIdRef;
  if (offering === "freewill") {
    if (!sowStream || !FREEWILL_STREAM_TO_PRICE_REF[sowStream]) {
      return jsonResponse(
        { error: "Freewill offerings require a valid 'sowStream' (ally | swat | work)." },
        400
      );
    }
    resolvedRef = FREEWILL_STREAM_TO_PRICE_REF[sowStream];
  }

  if (!resolvedRef || !PRICE_REF_ALLOWLIST.has(resolvedRef)) {
    return jsonResponse({ error: "Invalid 'priceIdRef'." }, 400);
  }

  // The 66-Day Gauntlet uses INLINE pricing ($777 one-time) so it never depends
  // on a separately-created Stripe Price object. Every other offering resolves
  // to a Price ID stored in an environment variable.
  const isGauntlet = resolvedRef === "PRICE_GAUNTLET";
  const GAUNTLET_CENTS = 77700;

  let stripePriceId = null;
  if (!isGauntlet) {
    stripePriceId = env[resolvedRef];
    if (!stripePriceId) {
      return jsonResponse(
        { error: `Server is missing environment variable ${resolvedRef}.` },
        500
      );
    }
  }

  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ error: "Server is missing STRIPE_SECRET_KEY." }, 500);
  }

  const siteBase = env.SITE_BASE_URL || new URL(request.url).origin;

  // Build the application/x-www-form-urlencoded body that Stripe expects.
  const form = new URLSearchParams();
  form.append("mode", "payment");
  if (isGauntlet) {
    form.append("line_items[0][price_data][currency]", "usd");
    form.append("line_items[0][price_data][unit_amount]", String(GAUNTLET_CENTS));
    form.append("line_items[0][price_data][product_data][name]", "66-Day Gauntlet");
    form.append("line_items[0][quantity]", "1");
  } else {
    form.append("line_items[0][price]", stripePriceId);
    form.append("line_items[0][quantity]", "1");
  }
  form.append("success_url", `${siteBase}/thank-you.html?session_id={CHECKOUT_SESSION_ID}`);
  form.append("cancel_url", `${siteBase}/#offerings`);
  form.append("allow_promotion_codes", "true");
  form.append("billing_address_collection", "auto");

  // Metadata so stripe-webhook.js can route the completion event.
  form.append("metadata[offering]", offering);
  form.append("metadata[priceIdRef]", resolvedRef);
  if (sowStream) form.append("metadata[sowStream]", sowStream);

  // payment_intent metadata mirrors session metadata, useful for refund flows.
  form.append("payment_intent_data[metadata][offering]", offering);
  form.append("payment_intent_data[metadata][priceIdRef]", resolvedRef);
  if (sowStream) form.append("payment_intent_data[metadata][sowStream]", sowStream);

  if (typeof email === "string" && email.includes("@")) {
    form.append("customer_email", email);
  }

  const stripeResp = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const stripeJson = await stripeResp.json().catch(() => ({}));

  if (!stripeResp.ok) {
    const message =
      (stripeJson && stripeJson.error && stripeJson.error.message) ||
      "Stripe checkout session creation failed.";
    return jsonResponse({ error: message }, 502);
  }

  if (!stripeJson.url) {
    return jsonResponse({ error: "Stripe did not return a checkout URL." }, 502);
  }

  return jsonResponse({ url: stripeJson.url });
}

// Reject anything other than POST.
export async function onRequest({ request }) {
  if (request.method === "POST") {
    return onRequestPost(arguments[0]);
  }
  return jsonResponse({ error: "Method not allowed." }, 405);
}
