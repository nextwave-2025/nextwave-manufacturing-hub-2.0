import { NextResponse } from "next/server";
import crypto from "crypto";

const ADMIN_EMAIL = process.env.NEXTWAVE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.NEXTWAVE_ADMIN_PASSWORD;

const USER1_EMAIL = process.env.NEXTWAVE_USER1_EMAIL;
const USER1_PASSWORD = process.env.NEXTWAVE_USER1_PASSWORD;

const USER2_EMAIL = process.env.NEXTWAVE_USER2_EMAIL;
const USER2_PASSWORD = process.env.NEXTWAVE_USER2_PASSWORD;

const SESSION_SECRET = process.env.NEXTWAVE_SESSION_SECRET;

function sign(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export async function POST(req: Request) {
  const { email, password } = await req.json();

  if (!SESSION_SECRET) {
    return NextResponse.json({ success: false, error: "Server not configured" }, { status: 500 });
  }

  // Admin vars are optional if you only want user login (but you said admin already works)
  const adminConfigured = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);
  const user1Configured = Boolean(USER1_EMAIL && USER1_PASSWORD);
  const user2Configured = Boolean(USER2_EMAIL && USER2_PASSWORD);

  if (!adminConfigured && !user1Configured && !user2Configured) {
    return NextResponse.json({ success: false, error: "Server not configured" }, { status: 500 });
  }

  const e = String(email || "").trim().toLowerCase();
  const pw = String(password || "");

  const isAdmin = adminConfigured && e === ADMIN_EMAIL!.toLowerCase() && pw === ADMIN_PASSWORD;
  const isUser1 = user1Configured && e === USER1_EMAIL!.toLowerCase() && pw === USER1_PASSWORD;
  const isUser2 = user2Configured && e === USER2_EMAIL!.toLowerCase() && pw === USER2_PASSWORD;

  if (!isAdmin && !isUser1 && !isUser2) {
    return NextResponse.json({ success: false, error: "Invalid credentials" }, { status: 401 });
  }

  const payload = JSON.stringify({ email: e, ts: Date.now() });
  const signature = sign(payload, SESSION_SECRET);
  const token = Buffer.from(payload).toString("base64") + "." + signature;

  const response = NextResponse.json({ success: true });

 response.cookies.set("nextwave_session", token, {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/",
  maxAge: 60 * 60 * 24 * 7, // 7 Tage
});

  return response;
}
