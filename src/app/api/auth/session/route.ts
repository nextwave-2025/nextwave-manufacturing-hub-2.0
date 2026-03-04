import { NextResponse } from "next/server";
import crypto from "crypto";

const SESSION_SECRET = process.env.NEXTWAVE_SESSION_SECRET;

function sign(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export async function GET(req: Request) {
  try {
    if (!SESSION_SECRET) {
      return NextResponse.json({ ok: false, error: "Server not configured" }, { status: 500 });
    }

    const cookieHeader = req.headers.get("cookie") || "";
    const match = cookieHeader.match(/(?:^|;\s*)nextwave_session=([^;]+)/);
    if (!match) {
      return NextResponse.json({ ok: false });
    }

    const token = decodeURIComponent(match[1]);
    const parts = token.split(".");
    if (parts.length !== 2) {
      return NextResponse.json({ ok: false });
    }

    const [payloadB64, signature] = parts;
    const payloadJson = Buffer.from(payloadB64, "base64").toString("utf8");

    const expectedSig = sign(payloadJson, SESSION_SECRET);
    if (signature !== expectedSig) {
      return NextResponse.json({ ok: false });
    }

    // Optional: TTL prüfen (z.B. 7 Tage)
    // const payload = JSON.parse(payloadJson);
    // if (payload?.ts && Date.now() - payload.ts > 7 * 24 * 60 * 60 * 1000) return NextResponse.json({ ok: false });

    const payload = JSON.parse(payloadJson);
    return NextResponse.json({ ok: true, user: { email: payload?.email || "" } });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
