/**
 * POST /api/give-monthly
 *
 * Creates a Stripe Checkout Session in SUBSCRIPTION mode using INLINE
 * price_data, so the giver names their own monthly amount on our page and we
 * build the recurring price at that amount. (Stripe's on-Stripe
 * "customer chooses price" does NOT support recurring; inline price_data does.)
 *
 * No SDK — the Cloudflare Workers runtime has no Node built-ins, so we call the
 * Stripe REST API directly, exactly like functions/api/checkout.js.
 *
 * Request JSON:
 *   {
 *     "amount": 25,            (required) dollars, the giver's chosen monthly gift
 *     "stream": "ally"         (required) "ally" | "swat" | "work"
 *   }
 *
 * Uses the same environment variables already configured for the Gauntlet:
 *   STRIPE_SECRET_KEY  (must be the LIVE key, sk_live_..., for real gifts)
 *   SITE_BASE_URL      (e.g. https://universalgospelfellowshipcenter.com)
 *
 * Response JSON:
 *   { "url": "https://checkout.stripe.com/..." }   on success
 *   { "error": "..." }                              on failure
 */

// Where the monthly gift is sown → the product name shown on Stripe + receipts.
const STREAM_TO_NAME = {
  ally: "Monthly Gift \u2014 Sowing into Ally",
  swat: "Monthly Gift \u2014 Sowing into SWAT",
  work: "Monthly Gift \u2014 Sowing into the Work",
};

const MIN_CENTS = 100;         // $1.00 floor (card fees would eat anything less)
const MAX_CENTS = 10000000;    // $100,000 ceiling — sanity guard, not a real cap

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

  const { amount, stream } = payload || {};

  // Validate the stream.
  const productName = STREAM_TO_NAME[stream];
  if (!productName) {
    return jsonResponse(
      { error: "Please choose where to sow (ally, swat, or work)." },
      400
    );
  }

  // Validate the amount (dollars → cents).
  const dollars = Number(amount);
  if (!isFinite(dollars) || dollars <= 0) {
    return jsonResponse({ error: "Please enter a valid monthly amount." }, 400);
  }
  const cents = Math.round(dollars * 100);
  if (cents < MIN_CENTS) {
    return jsonResponse({ error: "The smallest monthly gift is $1.00." }, 400);
  }
  if (cents > MAX_CENTS) {
    return jsonResponse(
      { error: "For a monthly gift larger than $100,000, please contact us directly." },
      400
    );
  }

  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ error: "Server is missing STRIPE_SECRET_KEY." }, 500);
  }

  const siteBase = env.SITE_BASE_URL || new URL(request.url).origin;

  // Build the application/x-www-form-urlencoded body Stripe expects.
  const form = new URLSearchParams();
  form.append("mode", "subscription");
  form.append("line_items[0][quantity]", "1");
  form.append("line_items[0][price_data][currency]", "usd");
  form.append("line_items[0][price_data][unit_amount]", String(cents));
  form.append("line_items[0][price_data][recurring][interval]", "month");
  form.append("line_items[0][price_data][product_data][name]", productName);
  form.append(
    "success_url",
    `${siteBase}/give-monthly-thank-you.html?session_id={CHECKOUT_SESSION_ID}`
  );
  form.append("cancel_url", `${siteBase}/give-monthly.html`);
  form.append("billing_address_collection", "auto");

  // Metadata for records / webhook routing.
  form.append("metadata[type]", "monthly-gift");
  form.append("metadata[sowStream]", stream);
  form.append("subscription_data[metadata][type]", "monthly-gift");
  form.append("subscription_data[metadata][sowStream]", stream);

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
      "Stripe subscription session creation failed.";
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
