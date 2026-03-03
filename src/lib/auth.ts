import crypto from "crypto";
import { cookies } from "next/headers";

const SESSION_SECRET = process.env.NEXTWAVE_SESSION_SECRET;

function sign(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export function getSessionEmail(): string | null {
  if (!SESSION_SECRET) return null;

  const token = cookies().get("nextwave_session")?.value;
  if (!token) return null;

  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;

  const payload = Buffer.from(b64, "base64").toString("utf8");
  const expected = sign(payload, SESSION_SECRET);
  if (sig !== expected) return null;

  try {
    const data = JSON.parse(payload) as { email?: string; ts?: number };
    if (!data.email || !data.ts) return null;

    // Optional: Session-Timeout (z.B. 7 Tage)
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - data.ts > maxAgeMs) return null;

    return data.email;
  } catch {
    return null;
  }
}

export function requireAuth(): { ok: true; email: string } | { ok: false } {
  const email = getSessionEmail();
  if (!email) return { ok: false };
  return { ok: true, email };
}
