"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const res = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    if (res.ok) {
      window.location.href = "/";
    } else {
      const data = await res.json().catch(() => null);
      alert(data?.error || "Login fehlgeschlagen");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-[360px] rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200"
      >
        <h1 className="mb-5 text-xl font-semibold text-gray-900">
          Login
        </h1>

        <input
          type="email"
          placeholder="E-Mail"
          className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-orange-500"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />

        <input
          type="password"
          placeholder="Passwort"
          className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-orange-500"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        <button
          type="submit"
          className="w-full rounded-lg bg-brand-orange py-2 text-sm font-medium text-white"
        >
          Einloggen
        </button>
      </form>
    </div>
  );
}
