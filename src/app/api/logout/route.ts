import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });

  response.cookies.set("session", "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    expires: new Date(0),
    path: "/",
  });

  return response;
}
