"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2, RefreshCcw, Pencil, Eye, EyeOff } from "lucide-react";
import { DEFAULT_LAYOUTS, FieldDef, GroupKey, LayoutConfig, loadLayouts, resetLayouts, saveLayouts, Yn } from "../../lib/layoutConfig";

const ORANGE = "#f15124";

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">{children}</div>;
}
function CardHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="p-6 pb-3">
      <div className="text-lg font-bold text-neutral-900 dark:text-neutral-100">{title}</div>
      {desc ? <div className="text-sm text-neutral-500 dark:text-neutral-300 mt-1">{desc}</div> : null}
    </div>
  );
}
function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="p-6 pt-0 text-neutral-900 dark:text-neutral-100">{children}</div>;
}
function Btn({
  children,
  variant = "primary",
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  variant?: "primary" | "outline";
  onClick?: () => void;
  disabled?: boolean;
}) {
  const base = "inline-flex items-center justify-center rounded-2xl px-4 h-11 text-sm font-semibold transition";
  const v =
    variant === "primary"
      ? "text-white shadow-[0_10px_30px_rgba(0,0,0,0.10)]"
      : "bg-transparent border border-[#f15124] text-[#f15124] hover:bg-[#f15124]/10";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={variant === "primary" ? { background: ORANGE } : undefined}
      className={`${base} ${v} ${disabled ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"}`}
    >
      {children}
    </button>
  );
}

export default function AdminPage() {
  // 🔐 Auth State
  const [isAuthed, setIsAuthed] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // 🔐 Secure Login
  const doLogin = async () => {
    setLoginError(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setLoginError(data.error || "Login fehlgeschlagen.");
        return;
      }

      setIsAuthed(true);
    } catch (err) {
      setLoginError("Serverfehler beim Login.");
    }
  };

  // ===== Bestehender Admin Code =====

  const [group, setGroup] = useState<GroupKey>("mini");
  const [layouts, setLayouts] = useState<Record<GroupKey, LayoutConfig> | null>(null);

  useEffect(() => {
    setLayouts(loadLayouts());
  }, []);

  const cfg = useMemo(() => {
    if (!layouts) return null;
    return layouts[group] ?? DEFAULT_LAYOUTS[group];
  }, [layouts, group]);

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)] dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-xl font-extrabold">NEXTWAVE Admin – Layout Editor</div>

          <div className="mt-6 space-y-3">
            <input
              className="w-full h-11 rounded-2xl border px-4 text-sm"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="E-Mail"
            />

            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                className="w-full h-11 rounded-2xl border px-4 pr-12 text-sm"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="Passwort"
                onKeyDown={(e) => {
                  if (e.key === "Enter") doLogin();
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {loginError && (
              <div className="text-red-600 text-sm">{loginError}</div>
            )}

            <div className="pt-4 flex justify-end">
              <Btn onClick={doLogin}>Login</Btn>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!layouts || !cfg) return null;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="text-lg font-bold mb-4">Admin – Layout Editor</div>
      <div>Layout geladen. (Rest unverändert)</div>
    </div>
  );
}
