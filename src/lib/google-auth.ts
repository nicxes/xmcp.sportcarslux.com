import { createSign } from "node:crypto";

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Service-account OAuth for Google APIs (no SDK): signs a JWT with the
 * service account key and exchanges it for an access token. Cached until
 * shortly before expiry.
 */
export async function getGoogleAccessToken(scope: string): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const email = process.env.GOOGLE_SA_EMAIL;
  const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) {
    throw new Error("Google is not configured: set GOOGLE_SA_EMAIL and GOOGLE_SA_PRIVATE_KEY (ask IT).");
  }

  const now = Math.floor(Date.now() / 1000);
  const b64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const body = (await res.json()) as { access_token?: string; error_description?: string; error?: string };
  if (!body.access_token) {
    throw new Error(`Google auth failed: ${body.error_description ?? body.error ?? "unknown error"}`);
  }

  cachedToken = { token: body.access_token, expiresAt: Date.now() + 50 * 60 * 1000 };
  return body.access_token;
}
