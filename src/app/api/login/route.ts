import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

const USER = {
  email: "admin@nextwave.de",
  passwordHash: "$2b$10$wQ2mW9Q0A2mFqk0lU2l7aOQ8m1x9m0mYdC0lY9m4xQx0v6K4T8k9K",
};

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "E-Mail und Passwort erforderlich" },
        { status: 400 }
      );
    }

    if (email !== USER.email) {
      return NextResponse.json(
        { error: "Ungültige Anmeldedaten" },
        { status: 401 }
      );
    }

    const valid = await bcrypt.compare(password, USER.passwordHash);

    if (!valid) {
      return NextResponse.json(
        { error: "Ungültige Anmeldedaten" },
        { status: 401 }
      );
    }

    const response = NextResponse.json({ ok: true });

    response.cookies.set("session", "loggedin", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 14,
      path: "/",
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: "Serverfehler beim Login" },
      { status: 500 }
    );
  }
}
