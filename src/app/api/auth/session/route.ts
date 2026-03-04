import { NextResponse } from "next/server";
import crypto from "crypto";

const SESSION_SECRET = process.env.NEXTWAVE_SESSION_SECRET;

function sign(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  if (!SESSION_SECRET) {
    return NextResponse.json({ ok: false, error: "Server not configured" }, { status: 500 });
  }

  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)nextwave_session=([^;]+)/);
  const token = match?.[1];

  if (!token) return NextResponse.json({ ok: false }, { status: 200 });

  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return NextResponse.json({ ok: false }, { status: 200 });

  const payloadStr = Buffer.from(payloadB64, "base64").toString("utf8");
  const expected = sign(payloadStr, SESSION_SECRET);

  if (signature !== expected) return NextResponse.json({ ok: false }, { status: 200 });

  const payload = safeJsonParse(payloadStr);
  if (!payload?.email) return NextResponse.json({ ok: false }, { status: 200 });

  return NextResponse.json({ ok: true, email: String(payload.email) }, { status: 200 });
}
