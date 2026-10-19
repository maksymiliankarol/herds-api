const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type SiteverifyResponse = { success?: boolean; "error-codes"?: string[] };

// Sends the token to Cloudflare's Siteverify API. A token is valid for 5 minutes
// and can be validated only once. Any failure counts as "not verified".
export async function verifyTurnstile(token: string, secret: string, ip?: string): Promise<boolean> {
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);

  try {
    const res = await fetch(SITEVERIFY_URL, { method: "POST", body });
    const result = (await res.json()) as SiteverifyResponse;

    if (!result.success) console.warn("turnstile rejected:", result["error-codes"]);
    return result.success === true;
  } catch (err) {
    console.error("turnstile siteverify failed:", err);
    return false;
  }
}