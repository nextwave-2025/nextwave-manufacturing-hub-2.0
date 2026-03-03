import { NextResponse } from "next/server";
import crypto from "crypto";

const ADMIN_EMAIL = process.env.NEXTWAVE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.NEXTWAVE_ADMIN_PASSWORD;
const SESSION_SECRET = process.env.NEXTWAVE_SESSION_SECRET;

function sign(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export async function POST(req: Request) {
  const { email, password } = await req.json();

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !SESSION_SECRET) {
    return NextResponse.json({ success: false, error: "Server not configured" }, { status: 500 });
  }

  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return NextResponse.json({ success: false, error: "Invalid credentials" }, { status: 401 });
  }

  const payload = JSON.stringify({ email, ts: Date.now() });
  const signature = sign(payload, SESSION_SECRET);
  const token = Buffer.from(payload).toString("base64") + "." + signature;

  const response = NextResponse.json({ success: true });

  response.cookies.set("nextwave_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
  });

  return response;
}
