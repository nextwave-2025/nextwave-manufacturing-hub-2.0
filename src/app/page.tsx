"use client";

import Image from "next/image";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, AlertTriangle, Search, ArrowLeft, ArrowRight, Eye, EyeOff, Download } from "lucide-react";
import jsPDF from "jspdf";

// ✅ Relativer Import, damit kein @/ Alias nötig ist
// Wenn deine Datei anders heißt: ../lib/layoutConfig
import { loadLayouts } from "../lib/layoutConfig";

/** =========================
 * Types (tolerant & robust)
 * ========================= */

// Yn value used in UI
type Yn = "unset" | "yes" | "no";

// device type
type DeviceType = "mini" | "rugged";

// showWhen structure (optional)
type ShowWhen =
  | { key: string; eqYn: Yn }
  | { key: string; eqBool: boolean };

// field types supported
type FieldType = "yn" | "boolean" | "text";

// field definition (tolerant: admin may add properties)
type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;

  // optional: conditional visibility
  showWhen?: ShowWhen;

  // optional helpers (if you later extend)
  requiresCommentWhenNo?: boolean;
};

// sections config
type SectionDef = {
  title: string;
  fields: FieldDef[];
};

type LayoutConfig = {
  version: number;
  group: DeviceType;
  sections: SectionDef[];
};

type Layouts = Record<DeviceType, LayoutConfig>;

type Step = "delivery" | "checks" | "summary";

// ✅ Row: fixed core fields + dynamic custom fields
type Row = {
  sn: string;
  confirmed: boolean;

  // shared
  visual: Yn;
  visualComment: string;
  shake: Yn;

  // Mini relevant
  osInstalled: Yn;
  ssdDetected: Yn;

  // Rugged relevant
  iotInstalled: Yn;

  // allow custom fields (added via admin)
  [key: string]: any;
};

const ORANGE = "#f15124";
const DEMO_UNITS = 2; // ✅ quickly switch (2 / 8 / 20)

/** =========================
 * Helpers
 * ========================= */

function normalizeSn(v: string) {
  return (v || "").trim().replace(/\s+/g, "").toUpperCase();
}

function inferDeviceTypeFromDeliveryNote(dn: string): DeviceType {
  const s = (dn || "").toUpperCase();
  if (s.includes("RUG") || s.includes("WAVETAB") || s.includes("TAB")) return "rugged";
  return "mini";
}

function emptyRow(sn: string): Row {
  return {
    sn,
    confirmed: false,

    // shared
    visual: "unset",
    visualComment: "",
    shake: "unset",

    // mini core
    osInstalled: "unset",
    ssdDetected: "unset",

    // rugged core
    iotInstalled: "unset",
  };
}

function ynLabel(v: Yn) {
  if (v === "yes") return "Ja";
  if (v === "no") return "Nein";
  return "—";
}
function boolLabel(v: boolean) {
  return v ? "Ja" : "Nein";
}

/**
 * ✅ Central visibility logic:
 * 1) if field has showWhen -> apply it
 * 2) else apply known production rules (compat to your workflow)
 */
function shouldShowField(row: Row, f: FieldDef): boolean {
  // (1) showWhen from admin
  if (f.showWhen && typeof f.showWhen === "object" && "key" in f.showWhen) {
    const cond = f.showWhen as any;
    const val: any = (row as any)[cond.key];
    if ("eqYn" in cond) return val === cond.eqYn;
    if ("eqBool" in cond) return Boolean(val) === cond.eqBool;
  }

  // (2) fallback production rules (classic)
  // - ssdDetected only when osInstalled=no
  if (f.key === "ssdDetected") return row.osInstalled === "no";

  // - OS checks only when osInstalled=yes
  if (["driversOk", "updatesDone", "powerPlanSet", "windowsActivated"].includes(f.key)) {
    return row.osInstalled === "yes";
  }

  // - Rugged IoT sub-checks only when iotInstalled=yes
  if (["cameraAppInstalled", "controlCenterInstalled"].includes(f.key)) {
    return row.iotInstalled === "yes";
  }

  return true;
}

function isFieldComplete(row: Row, f: FieldDef): boolean {
  if (!shouldShowField(row, f)) return true; // hidden fields don't block

  const v: any = (row as any)[f.key];

  if (f.type === "yn") {
    if (v === "unset") return false;

    // special: visual comment required when "no"
    if (f.key === "visual" && v === "no") {
      return (row.visualComment || "").trim().length > 0;
    }

    return true;
  }

  if (f.type === "boolean") {
    if (!f.required) return true; // optional boolean can stay false
    return v === true;
  }

  // text
  if (!f.required) return true;
  return String(v ?? "").trim().length > 0;
}

/** =========================
 * UI components
 * ========================= */

function Chip({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "blue" | "green" }) {
  const cls =
    tone === "green"
      ? "bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-200"
      : tone === "blue"
      ? "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-green-200"
      : "bg-neutral-500/10 text-neutral-700 border-neutral-500/20 dark:text-neutral-200";
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>{children}</span>;
}

function Btn({
  children,
  variant = "primary",
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  variant?: "primary" | "outline";
  disabled?: boolean;
  onClick?: () => void;
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

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.06)] dark:border-neutral-800 dark:bg-neutral-900">
      {children}
    </div>
  );
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

function SelectYN({ value, onChange }: { value: Yn; onChange: (v: Yn) => void }) {
  return (
    <select
      className="w-full h-11 rounded-2xl border border-neutral-200 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
      value={value}
      onChange={(e) => onChange(e.target.value as Yn)}
    >
      <option value="unset">—</option>
      <option value="yes">Ja</option>
      <option value="no">Nein</option>
    </select>
  );
}

function CheckToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`w-full flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
        checked
          ? "border-green-500 bg-green-500/10 dark:bg-green-500/15"
          : "border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800"
      }`}
      onClick={() => onChange(!checked)}
    >
      <span className="text-left">{label}</span>
      <span
        className={`inline-flex items-center justify-center w-7 h-7 rounded-full border ${
          checked
            ? "bg-green-500 text-white border-green-500"
            : "bg-white text-neutral-400 border-neutral-200 dark:bg-neutral-900 dark:border-neutral-800"
        }`}
      >
        {checked ? <Check className="w-4 h-4" /> : null}
      </span>
    </button>
  );
}

/**
 * ✅ SignaturePad (stable)
 */
function SignaturePad({
  value,
  onChange,
  dark,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  dark: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const setupCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.9)";
  };

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setupCanvas();
    drawingRef.current = true;
    lastRef.current = getPos(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const p = getPos(e);
    const last = lastRef.current ?? p;

    ctx.strokeStyle = dark ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.9)";
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    lastRef.current = p;
  };

  const end = () => {
    drawingRef.current = false;
    lastRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange("");
  };

  useEffect(() => {
    setupCanvas();
    const onResize = () => setupCanvas();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  useEffect(() => {
    if (!value) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setupCanvas();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new window.Image();
    img.onload = () => {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      ctx.drawImage(img, 0, 0, rect.width, rect.height);
    };
    img.src = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">Unterschrift (Finger/Stift)</div>

      <div className="rounded-2xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
        <canvas
          ref={canvasRef}
          className="w-full h-[220px] rounded-xl bg-transparent block touch-none"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={clear}
            className="h-10 px-4 rounded-2xl border border-[#f15124] text-[#f15124] hover:bg-[#f15124]/10 text-sm font-semibold"
          >
            Unterschrift löschen
          </button>
        </div>
      </div>

      <div className="text-xs text-neutral-500 dark:text-neutral-300">Tipp: Am Tablet im Querformat unterschreiben.</div>
    </div>
  );
}

/** =========================
 * Page
 * ========================= */

export default function Page() {
  const steps: { key: Step; label: string }[] = [
    { key: "delivery", label: "Lieferschein" },
    { key: "checks", label: "Fertigung" },
    { key: "summary", label: "Zusammenfassung" },
  ];

  // ✅ localStorage keys (MÜSSEN vor useEffect stehen)
  const LS_USER_STATE = "nextwave_user_state_v1";
  const LS_USER_OPERATOR = "nextwave_user_operator_v1";

  // ✅ layouts from lib (admin saves into LocalStorage, loadLayouts reads it)
  const [layouts, setLayouts] = useState<Layouts>(() => loadLayouts() as any);

  // ✅ State: MUSS vor useEffects stehen, die es benutzen
  const [step, setStep] = useState<Step>("delivery");
  const [deviceType, setDeviceType] = useState<DeviceType>("mini");

  // login gate
  const [operator, setOperator] = useState<string>("");
  const USERS: { name: string; email: string; password: string }[] = [
    { name: "Mustafa Ergin", email: "mustafa@next-wave.tech", password: "NEXTWAVE123" },
    { name: "Jonas Harlacher", email: "jonas@next-wave.tech", password: "NEXTWAVE123" },
  ];
  const [isAuthed, setIsAuthed] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // delivery / workflow state
  const [dnInput, setDnInput] = useState("DN-2026-001");
  const [dnLoaded, setDnLoaded] = useState(false);
  const [customerName, setCustomerName] = useState<string>("");
  const [productNames, setProductNames] = useState<string[]>([]);

  const [expectedSerials, setExpectedSerials] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(-1);

  const [search, setSearch] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(false);

  // UI
  const [dark, setDark] = useState(false);

  // summary / pdf
  const [signatureInitials, setSignatureInitials] = useState<string>("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string>("");
  const [showPdfPreview, setShowPdfPreview] = useState(false);

  useEffect(() => {
    const onFocus = () => setLayouts(loadLayouts() as any);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // ✅ Restore UI + Session after reload (keine Abmeldung durch Reload)
  useEffect(() => {
    // 1) State restore (Arbeitsstand)
    try {
      const raw = localStorage.getItem(LS_USER_STATE);
      if (raw) {
        const s = JSON.parse(raw);

        if (typeof s.step === "string") setStep(s.step as Step);
        if (typeof s.deviceType === "string") setDeviceType(s.deviceType as DeviceType);

        if (typeof s.dnInput === "string") setDnInput(s.dnInput);
        if (typeof s.dnLoaded === "boolean") setDnLoaded(s.dnLoaded);
        if (typeof s.customerName === "string") setCustomerName(s.customerName);
        if (Array.isArray(s.productNames)) setProductNames(s.productNames);

        if (Array.isArray(s.expectedSerials)) setExpectedSerials(s.expectedSerials);
        if (Array.isArray(s.rows)) setRows(s.rows);
        if (typeof s.activeIdx === "number") setActiveIdx(s.activeIdx);

        if (typeof s.search === "string") setSearch(s.search);
        if (typeof s.autoAdvance === "boolean") setAutoAdvance(s.autoAdvance);

        if (typeof s.dark === "boolean") setDark(s.dark);

        if (typeof s.signatureInitials === "string") setSignatureInitials(s.signatureInitials);
        if (typeof s.signatureDataUrl === "string") setSignatureDataUrl(s.signatureDataUrl);
        if (typeof s.showPdfPreview === "boolean") setShowPdfPreview(s.showPdfPreview);
      }
    } catch {
      // ignore
    }

    // 2) Session restore (Cookie prüfen)
    (async () => {
      try {
        const r = await fetch("/api/auth/session", { method: "GET", cache: "no-store" });
        const j = await r.json();

        if (j?.ok) {
          setIsAuthed(true);

          // Operator-Name aus localStorage wiederherstellen (wir speichern den beim Login)
          const op = localStorage.getItem(LS_USER_OPERATOR) || "";
          if (op) setOperator(op);
        }
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Persist Arbeitsstand automatisch (nur Reset darf löschen)
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const snapshot = {
          step,
          deviceType,

          dnInput,
          dnLoaded,
          customerName,
          productNames,

          expectedSerials,
          rows,
          activeIdx,

          search,
          autoAdvance,

          dark,

          signatureInitials,
          signatureDataUrl,
          showPdfPreview,
        };
        localStorage.setItem(LS_USER_STATE, JSON.stringify(snapshot));
      } catch {
        // ignore
      }
    }, 250);

    return () => window.clearTimeout(t);
  }, [
    step,
    deviceType,
    dnInput,
    dnLoaded,
    customerName,
    productNames,
    expectedSerials,
    rows,
    activeIdx,
    search,
    autoAdvance,
    dark,
    signatureInitials,
    signatureDataUrl,
    showPdfPreview,
  ]);

  const todayStr = useMemo(() => new Date().toLocaleDateString("de-DE"), []);

  const scanFocusRef = useRef<HTMLInputElement | null>(null);
  const activeUnitRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add("dark");
    else root.classList.remove("dark");
  }, [dark]);

  const stepIdx = steps.findIndex((s) => s.key === step);
  const activeRow = activeIdx >= 0 ? rows[activeIdx] : undefined;
  const totalExpected = expectedSerials.length;

  // ✅ dynamic fields from selected device layout
  const deviceSections: SectionDef[] = useMemo(() => {
    const cfg = (layouts as any)?.[deviceType] as LayoutConfig | undefined;
    return cfg?.sections?.length ? (cfg.sections as any) : [];
  }, [layouts, deviceType]);

  const deviceFields: FieldDef[] = useMemo(() => {
    return deviceSections.flatMap((s) => (s?.fields ?? []) as any);
  }, [deviceSections]);

  const isRowComplete = (r: Row) => deviceFields.every((f) => isFieldComplete(r, f));

  const doneCount = useMemo(() => rows.filter(isRowComplete).length, [rows, deviceFields]);
  const confirmedCount = useMemo(() => rows.filter((r) => r.confirmed).length, [rows]);
  const isChecksComplete = rows.length > 0 && rows.every(isRowComplete);

  const filteredRows = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return rows;
    return rows.filter((r) => r.sn.includes(q));
  }, [rows, search]);

  const focusScan = () => {
    window.setTimeout(() => {
      scanFocusRef.current?.focus();
      scanFocusRef.current?.select();
    }, 0);
  };

  const selectBySn = (sn: string) => {
    const idx = rows.findIndex((r) => r.sn === sn);
    if (idx < 0) return;
    setActiveIdx(idx);
    window.setTimeout(() => {
      activeUnitRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const confirmByScan = (raw: string) => {
    const sn = normalizeSn(raw);
    if (!sn) return;

    setScanError(null);

    if (!expectedSerials.includes(sn)) {
      setScanError(`Achtung! Diese S/N wurde im Lieferschein ${dnInput} nicht erfasst: ${sn}`);
      return;
    }

    setRows((prev) => prev.map((r) => (r.sn === sn ? { ...r, confirmed: true } : r)));
    selectBySn(sn);
  };

  const goNextUnit = () => {
    if (isChecksComplete) {
      setStep("summary");
      return;
    }
    setActiveIdx(-1);
    focusScan();
  };

  useEffect(() => {
    if (!autoAdvance) return;
    if (step !== "checks") return;
    if (!activeRow) return;
    if (!isRowComplete(activeRow)) return;

    const t = window.setTimeout(() => {
      setActiveIdx(-1);
      focusScan();
    }, 250);

    return () => window.clearTimeout(t);
  }, [autoAdvance, step, activeRow, deviceFields, rows]);

  useEffect(() => {
    if (step === "checks") focusScan();
  }, [step]);

  const resetAll = () => {
    // ✅ gespeicherten Arbeitsstand wirklich löschen
    try {
      localStorage.removeItem("nextwave_user_state_v1");
      localStorage.removeItem("nextwave_user_operator_v1");
    } catch {
      // ignore
    }

    setStep("delivery");

    setDnLoaded(false);
    setCustomerName("");
    setExpectedSerials([]);
    setRows([]);
    setActiveIdx(-1);
    setSearch("");
    setScanError(null);
    setAutoAdvance(false);

    setProductNames([]);
    setSignatureInitials("");
    setSignatureDataUrl("");
    setShowPdfPreview(false);

    setDeviceType("mini");
  };

  const doLogin = async () => {
    const email = loginEmail.trim().toLowerCase();
    const pw = loginPassword;

   const u = USERS.find((x) => x.email.toLowerCase() === email);
if (!u) {
  setLoginError("Login fehlgeschlagen. Bitte E-Mail prüfen.");
  return;
}

    try {
      // ✅ Serverseitig Cookie setzen
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: u.email, password: pw }),
      });

      const j = await r.json();
      if (!j?.success) {
        setLoginError(j?.error || "Login fehlgeschlagen.");
        return;
      }

      setLoginError(null);
      setIsAuthed(true);
      setOperator(u.name);
      localStorage.setItem(LS_USER_OPERATOR, u.name);
      setStep("delivery");
    } catch {
      setLoginError("Login fehlgeschlagen (Netzwerk).");
    }
  };

  const setFieldValue = (key: string, value: any) => {
    setRows((prev) => prev.map((x, i) => (i === activeIdx ? { ...x, [key]: value } : x)));
  };

  const downloadPdf = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const margin = 40;
    let y = 50;

    const writeLine = (text: string, fontSize = 11, gap = 16) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(fontSize);
      const lines = doc.splitTextToSize(text, 515);
      doc.text(lines, margin, y);
      y += lines.length * gap;
      if (y > 770) {
        doc.addPage();
        y = 50;
      }
    };

    const renderFieldToPdf = (r: Row, f: FieldDef) => {
      if (!shouldShowField(r, f)) return;

      const v: any = (r as any)[f.key];

      if (f.type === "yn") {
        if (f.key === "visual") {
          writeLine(`${f.label}: ${ynLabel(r.visual)}${r.visual === "no" ? ` (Kommentar: ${r.visualComment || "—"})` : ""}`);
          return;
        }
        writeLine(`${f.label}: ${ynLabel((v as Yn) ?? "unset")}`);
        return;
      }

      if (f.type === "boolean") {
        writeLine(`${f.label}: ${boolLabel(Boolean(v))}`);
        return;
      }

      writeLine(`${f.label}: ${String(v ?? "").trim() || "—"}`);
    };

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("NEXTWAVE – Fertigungsprotokoll (Demo)", margin, y);
    y += 22;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    writeLine(`Kunde: ${customerName || "—"}`);
    writeLine(`Lieferschein: ${dnInput || "—"}`);
    writeLine(`Gerätetyp: ${deviceType === "mini" ? "Barebone Mini-PC" : "Rugged Tablet"}`);
    writeLine(`Bearbeiter: ${operator || "—"}`);
    writeLine(`Datum: ${todayStr}`);
    y += 8;

    doc.setDrawColor(220);
    doc.line(margin, y, 555, y);
    y += 18;

    doc.setFont("helvetica", "bold");
    doc.text("Einheiten", margin, y);
    y += 18;

    rows.forEach((r, idx) => {
      doc.setFont("helvetica", "bold");
      doc.text(`${idx + 1}. ${r.sn}`, margin, y);
      y += 14;

      doc.setFont("helvetica", "normal");
      writeLine(`Scan: ${r.confirmed ? "Durchgeführt" : "Nicht durchgeführt"}`);

      deviceFields.forEach((f) => renderFieldToPdf(r, f));

      y += 8;
      doc.setDrawColor(235);
      doc.line(margin, y, 555, y);
      y += 16;
    });

    if (signatureDataUrl) {
      try {
        if (y > 680) {
          doc.addPage();
          y = 50;
        }
        doc.setFont("helvetica", "bold");
        doc.text("Unterschrift", margin, y);
        y += 12;

        doc.addImage(signatureDataUrl, "PNG", margin, y, 250, 90);
        y += 110;
      } catch {
        // ignore
      }
    }

    const safeDn = (dnInput || "DN").replace(/[^\w\-]+/g, "_");
    doc.save(`NEXTWAVE_Fertigungsprotokoll_${safeDn}.pdf`);
  };

  const renderField = (f: FieldDef, r: Row) => {
    if (!shouldShowField(r, f)) return null;

    // yn
    if (f.type === "yn") {
      if (f.key === "visual") {
        return (
          <div key={f.key} className="space-y-2">
            <div className="text-sm font-semibold">{f.label}</div>
            <SelectYN
              value={r.visual}
              onChange={(v) => {
                // visual comment resets when not "no"
                setRows((prev) =>
                  prev.map((x, i) =>
                    i === activeIdx ? { ...x, visual: v, visualComment: v === "no" ? (x.visualComment || "") : "" } : x,
                  ),
                );
              }}
            />
            {r.visual === "no" && (
              <textarea
                className="w-full min-h-[96px] rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                placeholder="Kommentar bei NEIN"
                value={r.visualComment}
                onChange={(e) => setFieldValue("visualComment", e.target.value)}
              />
            )}
          </div>
        );
      }

      const current = ((r as any)[f.key] as Yn) ?? "unset";

      return (
        <div key={f.key} className="space-y-2">
          <div className="text-sm font-semibold">{f.label}</div>
          <SelectYN
            value={current}
            onChange={(v) => {
              // ✅ keep classic OS/IoT reset behaviors
              if (f.key === "osInstalled") {
                setRows((prev) =>
                  prev.map((x, i) => {
                    if (i !== activeIdx) return x;
                    if (v === "no") {
                      return {
                        ...x,
                        osInstalled: v,
                        // clear OS check booleans if present
                        driversOk: false,
                        updatesDone: false,
                        powerPlanSet: false,
                        windowsActivated: false,
                      };
                    }
                    if (v === "yes") {
                      return { ...x, osInstalled: v, ssdDetected: "unset" };
                    }
                    return { ...x, osInstalled: v };
                  }),
                );
                return;
              }

              if (f.key === "iotInstalled") {
                setRows((prev) =>
                  prev.map((x, i) => {
                    if (i !== activeIdx) return x;
                    if (v === "no") return { ...x, iotInstalled: v, cameraAppInstalled: false, controlCenterInstalled: false };
                    return { ...x, iotInstalled: v };
                  }),
                );
                return;
              }

              setFieldValue(f.key, v);
            }}
          />
        </div>
      );
    }

    // boolean
    if (f.type === "boolean") {
      const current = Boolean((r as any)[f.key]);
      return (
        <div key={f.key} className="space-y-2">
          <div className="text-sm font-semibold">Checks (Haken setzen)</div>
          <CheckToggle label={f.label} checked={current} onChange={(v) => setFieldValue(f.key, v)} />
        </div>
      );
    }

    // text
    const current = String((r as any)[f.key] ?? "");
    return (
      <div key={f.key} className="space-y-2">
        <div className="text-sm font-semibold">{f.label}</div>
        <input
          className="w-full h-11 rounded-2xl border border-neutral-200 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
          value={current}
          onChange={(e) => setFieldValue(f.key, e.target.value)}
        />
      </div>
    );
  };

  // =========================
  // LOGIN SCREEN
  // =========================
  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)] dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-xl font-extrabold text-neutral-900 dark:text-neutral-100">NEXTWAVE Manufacturing Hub 2.0</div>
          <div className="text-sm text-neutral-500 dark:text-neutral-300 mt-1">Zugriff nur für autorisierte Mitarbeiter.</div>

          <div className="mt-6 space-y-3">
            <div className="text-sm font-semibold">E-Mail</div>
            <input
              className="w-full h-11 rounded-2xl border border-neutral-200 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="name@firma.de"
            />

            <div className="text-sm font-semibold mt-2">Passwort</div>

            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                className="w-full h-11 rounded-2xl border border-neutral-200 bg-white px-4 pr-12 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                onKeyDown={(e) => {
                  if (e.key === "Enter") doLogin();
                }}
              />

              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-xl bg-transparent flex items-center justify-center hover:opacity-80"
                aria-label={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 text-neutral-500 dark:text-neutral-300" />
                ) : (
                  <Eye className="h-4 w-4 text-neutral-500 dark:text-neutral-300" />
                )}
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => alert("Bitte an IT wenden: it@next-wave.tech (Demo)")}
                className="text-xs font-semibold text-neutral-500 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-white"
              >
                Passwort vergessen?
              </button>
            </div>

            {loginError ? (
              <div className="mt-2 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">{loginError}</div>
            ) : null}

            <div className="pt-4 flex justify-end">
              <Btn onClick={doLogin}>Login</Btn>
            </div>

            <div className="text-xs text-neutral-500 dark:text-neutral-300 pt-2">
              Hinweis: Das ist nur ein UI-Gate. Für echte Sicherheit muss Auth serverseitig erfolgen (Cookie + Middleware).
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================
  // MAIN UI
  // =========================
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        {/* PREMIUM HEADER */}
        <div className="rounded-3xl overflow-hidden border border-neutral-200 dark:border-neutral-800">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-b from-neutral-950 to-neutral-900" />
            <div className="absolute -top-24 -left-24 h-80 w-80 rounded-full blur-3xl opacity-50" style={{ background: ORANGE }} />
            <div className="absolute -top-28 -right-28 h-96 w-96 rounded-full blur-3xl opacity-25 bg-white" />

            <div className="relative px-6 py-5 sm:px-8 sm:py-6">
              <div className="flex items-start justify-between gap-6 flex-wrap">
                <div className="flex items-center gap-4">
                  <div className="relative h-10 w-[260px] sm:h-12 sm:w-[340px]">
                    <Image src={dark ? "/nextwave-logo-dark.png" : "/nextwave-logo-light.png"} alt="NEXTWAVE" fill className="object-contain" priority />
                  </div>
                </div>

                <div className="flex flex-col items-end text-right gap-2 flex-1 min-w-[320px]">
                  <div className="flex items-center gap-3 flex-wrap justify-end">
                    <div className="text-2xl sm:text-[28px] font-extrabold tracking-tight" style={{ color: ORANGE }}>
                      NEXTWAVE Manufacturing Hub 2.0
                    </div>
                    <div className="text-xs text-white/60">© NEXTWAVE GmbH – All rights reserved 2026</div>
                  </div>

                  <div className="text-sm text-white/80">
                    {dnLoaded ? (
                      <>
                        <span className="text-white/60 font-semibold">Kunde:</span> <span className="text-white font-semibold">{customerName}</span>{" "}
                        <span className="text-white/35">•</span> <span className="text-white/60 font-semibold">Lieferschein:</span>{" "}
                        <span className="text-white font-semibold">{dnInput}</span>
                      </>
                    ) : (
                      <span className="text-white/70">Bitte zuerst einen Lieferschein auswählen.</span>
                    )}
                  </div>

                  <div className="text-sm text-white/75">
                    <span className="text-white/60 font-semibold">Gerätetyp:</span>{" "}
                    <span className="text-white font-semibold">{deviceType === "mini" ? "Barebone Mini-PC" : "Rugged Tablet"}</span>

                    {operator ? (
                      <>
                        {" "}
                        <span className="text-white/35">•</span> <span className="text-white/60 font-semibold">Bearbeiter:</span>{" "}
                        <span className="text-white font-semibold">{operator}</span>
                      </>
                    ) : null}

                    {dnLoaded ? (
                      <>
                        {" "}
                        <span className="text-white/35">•</span> <span className="text-white/60 font-semibold">S/N:</span>{" "}
                        <span className="text-white font-semibold">
                          {confirmedCount}/{totalExpected} bestätigt
                        </span>{" "}
                        <span className="text-white/35">•</span> <span className="text-white font-semibold">{doneCount}/{totalExpected} fertig</span>
                      </>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-3 pt-2 flex-wrap justify-end">
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = window.confirm(
                          "Bist du sicher, dass du dich abmelden willst?\n\nNicht übertragene Daten könnten verloren gehen, wenn du danach Reset machst oder den Browser-Cache löschst."
                        );
                        if (!ok) return;

                        try {
                          await fetch("/api/auth/logout", { method: "POST" });
                        } catch {
                          // ignore
                        }

                        // ✅ Nur Auth zurücksetzen, NICHT den Arbeitsstand löschen
                        setIsAuthed(false);
                        setLoginPassword("");
                        setLoginError(null);
                      }}
                      className="h-10 px-4 rounded-2xl border border-white/15 bg-white/10 text-white hover:bg-white/15 backdrop-blur text-sm font-semibold"
                    >
                      Abmelden
                    </button>

                    <button
                      type="button"
                      onClick={resetAll}
                      className="h-10 px-4 rounded-2xl border border-white/15 bg-white/10 text-white hover:bg-white/15 backdrop-blur text-sm font-semibold"
                    >
                      Reset
                    </button>

                    <button
                      type="button"
                      onClick={() => setDark((v) => !v)}
                      className="h-10 px-4 rounded-2xl border border-white/15 bg-white/10 text-white hover:bg-white/15 backdrop-blur inline-flex items-center gap-2 text-sm font-semibold"
                      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
                    >
                      <span className={dark ? "text-white/60" : "text-white"}>Light</span>
                      <span className={"h-6 w-11 rounded-full relative transition " + (dark ? "" : "bg-white/25")} style={dark ? { background: ORANGE } : undefined}>
                        <span className={"absolute top-1 left-1 h-4 w-4 rounded-full bg-white transition " + (dark ? "translate-x-5" : "translate-x-0")} />
                      </span>
                      <span className={dark ? "text-white" : "text-white/60"}>Dark</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative h-px w-full bg-white/10" />
          </div>

          <div className="bg-white dark:bg-neutral-900 px-6 py-3 sm:px-8 sm:py-4 text-xs text-neutral-600 dark:text-neutral-300">
            Optimiert für Tablet & Desktop (Demo).
          </div>
        </div>

        {/* STEPS */}
        <Card>
          <CardBody>
            <div className="flex gap-3 overflow-auto pb-2 pt-4">
              {steps.map((s, i) => {
                const active = step === s.key;
                const done = i < stepIdx;
                return (
                  <div key={s.key} className="flex items-center gap-3 min-w-[180px]">
                    <div
                      className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-extrabold border ${
                        active
                          ? "text-white border-transparent"
                          : done
                          ? "bg-green-500 text-white border-green-500"
                          : "bg-neutral-100 text-neutral-600 border-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:border-neutral-700"
                      }`}
                      style={active ? { background: ORANGE } : undefined}
                    >
                      {done ? <Check className="h-5 w-5" /> : i + 1}
                    </div>
                    <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{s.label}</div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>

        {/* DELIVERY */}
        {step === "delivery" && (
          <Card>
            <CardHeader title="Lieferschein auswählen" desc="Später: Daten aus weclapp laden (Kunde, Warengruppe → Gerätetyp, Seriennummern, Produkte)." />
            <CardBody>
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3 max-w-2xl">
                  <input
                    className="w-full h-11 rounded-2xl border border-neutral-200 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                    value={dnInput}
                    onChange={(e) => setDnInput(e.target.value)}
                  />

                  <Btn
                    disabled={!dnInput || !operator}
                    onClick={() => {
                      const inferred = inferDeviceTypeFromDeliveryNote(dnInput);
                      setDeviceType(inferred);

                      const sns = Array.from({ length: DEMO_UNITS }).map((_, i) =>
                        inferred === "rugged" ? `NW-RUGGED-${String(i + 1).padStart(4, "0")}` : `NW-MINIO-${String(i + 1).padStart(4, "0")}`,
                      );
                      const normalized = sns.map(normalizeSn);
                      setExpectedSerials(normalized);
                      setRows(normalized.map((sn) => emptyRow(sn)));

                      setCustomerName("Musterkunde GmbH");
                      setDnLoaded(true);
                      setScanError(null);
                      setSearch("");
                      setActiveIdx(-1);

                      setProductNames(
                        inferred === "rugged"
                          ? ['WAVETAB Rugged 10" Industrial Tablet', "WAVETAB Zubehör / Dock (Demo)"]
                          : ["MINIO Barebone i3-1215UE (Demo)", "MINIO Zubehör-Kit (Demo)"],
                      );

                      setShowPdfPreview(false);
                      setSignatureInitials("");
                      setSignatureDataUrl("");

                      // refresh layouts in case admin changed them
                      setLayouts(loadLayouts() as any);
                    }}
                  >
                    Laden
                  </Btn>
                </div>

                {dnLoaded && (
                  <div className="rounded-2xl border border-neutral-200 p-4 bg-neutral-50 space-y-2 dark:border-neutral-800 dark:bg-neutral-950">
                    <div>
                      <b>Kunde:</b> {customerName}
                    </div>
                    <div>
                      <b>Lieferschein:</b> {dnInput}
                    </div>
                    <div>
                      <b>Gerätetyp (auto):</b>{" "}
                      <span className="font-semibold">{deviceType === "mini" ? "Barebone Mini-PC" : "Rugged Tablet"}</span>
                    </div>

                    <div className="flex flex-col gap-1">
                      <b>Produkt(e):</b>
                      {productNames.length ? (
                        <div className="flex flex-wrap gap-2">
                          {productNames.map((p) => (
                            <Chip key={p}>{p}</Chip>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-neutral-500 dark:text-neutral-300">—</div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <b>Erwartet:</b> {expectedSerials.length} Geräte <Chip>Demo</Chip>
                    </div>
                  </div>
                )}

                <div className="flex justify-between gap-3 pt-2">
                  <Btn
                    variant="outline"
                    onClick={() => {
                      setDnLoaded(false);
                      setExpectedSerials([]);
                      setRows([]);
                      setActiveIdx(-1);
                      setSearch("");
                      setScanError(null);
                      setProductNames([]);
                    }}
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" /> Zurücksetzen Lieferschein
                  </Btn>

                  <Btn
                    disabled={!dnLoaded}
                    onClick={() => {
                      setStep("checks");
                      setActiveIdx(-1);
                      focusScan();
                    }}
                  >
                    Zur Fertigung <ArrowRight className="ml-2 h-4 w-4" />
                  </Btn>
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {/* CHECKS */}
        {step === "checks" && (
          <Card>
            <CardHeader title="Fertigung – Scan-Workflow" desc="Felder werden dynamisch aus Layout geladen (inkl. Sections + Visible-When)." />
            <CardBody>
              <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
                <div className="rounded-2xl border border-neutral-200 p-4 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-950">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Einheiten</div>
                    <Chip>
                      {doneCount}/{totalExpected} fertig
                    </Chip>
                  </div>

                  <div className="mt-4 space-y-2">
                    <div className="text-sm font-semibold">Scan / Suche (S/N)</div>
                    <div className="relative">
                      <Search className="absolute left-4 top-3.5 h-4 w-4 text-neutral-400" />
                      <input
                        ref={scanFocusRef}
                        className="w-full h-11 rounded-2xl border border-neutral-200 bg-white pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                        value={search}
                        placeholder="S/N scannen oder suchen…"
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            confirmByScan(search);
                            setSearch("");
                          }
                        }}
                      />
                    </div>

                    {scanError && (
                      <div className="flex items-start gap-2 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                        <AlertTriangle className="h-4 w-4 mt-0.5" />
                        <span>{scanError}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-sm font-semibold">Auto-Advance</div>
                    <button
                      type="button"
                      className={`h-7 w-12 rounded-full relative transition ${autoAdvance ? "" : "bg-neutral-200"}`}
                      style={autoAdvance ? { background: ORANGE } : undefined}
                      onClick={() => setAutoAdvance((v) => !v)}
                    >
                      <span className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-white transition ${autoAdvance ? "translate-x-5" : "translate-x-0"}`} />
                    </button>
                  </div>

                  <div className="h-px w-full bg-neutral-200 dark:bg-neutral-800 my-4" />

                  <div className="max-h-[420px] overflow-auto space-y-2 pr-1">
                    {filteredRows.map((r) => {
                      const idx = rows.findIndex((x) => x.sn === r.sn);
                      const status = isRowComplete(r) ? "fertig" : r.confirmed ? "bestätigt" : "offen";
                      return (
                        <button
                          key={r.sn}
                          type="button"
                          onClick={() => selectBySn(r.sn)}
                          className={`w-full text-left flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 transition ${
                            idx === activeIdx
                              ? "bg-neutral-100 border-neutral-200 dark:bg-neutral-800 dark:border-neutral-700"
                              : "bg-white border-neutral-200 hover:bg-neutral-50 dark:bg-neutral-900 dark:border-neutral-800 dark:hover:bg-neutral-800"
                          }`}
                        >
                          <span className="font-mono text-sm truncate">{r.sn}</span>
                          {status === "fertig" ? <Chip tone="green">fertig</Chip> : status === "bestätigt" ? <Chip tone="blue">bestätigt</Chip> : <Chip>offen</Chip>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  {!activeRow ? (
                    <div className="rounded-2xl border border-neutral-200 p-6 text-sm text-neutral-600 bg-white dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">
                      Bitte links eine Seriennummer scannen (oder aus der Liste wählen).
                      <div className="flex flex-wrap gap-3 pt-5">
                        <Btn variant="outline" onClick={() => setStep("delivery")}>
                          <ArrowLeft className="mr-2 h-4 w-4" /> Zurück zu Lieferschein
                        </Btn>
                      </div>
                    </div>
                  ) : (
                    <div ref={activeUnitRef} className="rounded-2xl border border-neutral-200 p-6 bg-white dark:border-neutral-800 dark:bg-neutral-900">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                          <div className="text-xs text-neutral-500 dark:text-neutral-300">Aktuelle Seriennummer</div>
                          <div className="font-mono text-xl font-extrabold">{activeRow.sn}</div>
                          <div className="text-xs text-neutral-500 dark:text-neutral-300 mt-1">
                            Scan durchgeführt:{" "}
                            <span className="font-semibold text-neutral-900 dark:text-neutral-100">{activeRow.confirmed ? "Ja" : "Nein"}</span>
                          </div>
                        </div>
                        {isRowComplete(activeRow) ? <Chip tone="green">fertig</Chip> : <Chip>offen</Chip>}
                      </div>

                      <div className="mt-6 space-y-6">
                        {/* ✅ Sections + fields */}
                        {deviceSections.map((sec) => (
                          <div key={sec.title} className="space-y-4">
                            <div className="text-xs font-extrabold tracking-wide text-neutral-500 dark:text-neutral-300 uppercase">
                              {sec.title}
                            </div>
                            <div className="space-y-5">
                              {(sec.fields || []).map((f) => renderField(f as any, activeRow))}
                            </div>
                          </div>
                        ))}

                        <div className="flex flex-wrap gap-3 pt-2">
                          <Btn variant="outline" onClick={() => setStep("delivery")}>
                            <ArrowLeft className="mr-2 h-4 w-4" /> Zurück zu Lieferschein
                          </Btn>
                          <Btn onClick={goNextUnit}>
                            Nächste Einheit <ArrowRight className="ml-2 h-4 w-4" />
                          </Btn>
                          <Btn variant="outline" disabled={!isChecksComplete} onClick={() => setStep("summary")}>
                            Zur Zusammenfassung
                          </Btn>
                        </div>

                        <div className="text-xs text-neutral-500 dark:text-neutral-300 pt-2">
                          Layout aktuell: <b>{deviceFields.length}</b> Felder • Bearbeitung unter <b>/admin</b>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {/* SUMMARY */}
        {step === "summary" && (
          <Card>
            <CardHeader title="Zusammenfassung (Demo)" desc="PDF Vorschau/Download, Signatur, später Upload zu weclapp." />
            <CardBody>
              <div className="rounded-2xl border border-neutral-200 p-4 bg-neutral-50 space-y-2 dark:border-neutral-800 dark:bg-neutral-950">
                <div>
                  <b>Kunde:</b> {customerName}
                </div>
                <div>
                  <b>Lieferschein:</b> {dnInput}
                </div>

                <div className="flex flex-col gap-1">
                  <b>Produkt(e):</b>
                  {productNames.length ? (
                    <div className="flex flex-wrap gap-2">
                      {productNames.map((p) => (
                        <Chip key={p}>{p}</Chip>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-neutral-500 dark:text-neutral-300">—</div>
                  )}
                </div>

                <div>
                  <b>Gerätetyp:</b> {deviceType === "mini" ? "Barebone Mini-PC" : "Rugged Tablet"}
                </div>
                <div>
                  <b>Bearbeiter:</b> {operator}
                </div>

                <div>
                  <b>Datum:</b> {todayStr} <span className="text-xs text-neutral-500 dark:text-neutral-300">(automatisch)</span>
                </div>

                <div>
                  <b>Fortschritt:</b> {doneCount}/{totalExpected} fertig
                </div>

                <div className="pt-2 space-y-3">
                  <div className="text-sm font-semibold">Kürzel (optional)</div>
                  <input
                    className="w-full h-11 rounded-2xl border border-neutral-200 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                    value={signatureInitials}
                    onChange={(e) => setSignatureInitials(e.target.value)}
                    placeholder="z. B. ME / JH"
                  />

                  <SignaturePad value={signatureDataUrl} onChange={setSignatureDataUrl} dark={dark} />
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-4">
                <Btn variant="outline" onClick={() => setStep("checks")}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Zurück
                </Btn>

                <Btn onClick={() => setShowPdfPreview(true)}>PDF Vorschau (Demo)</Btn>

                <Btn onClick={() => alert("Upload zu weclapp (Demo).")}>Upload zu weclapp (Demo)</Btn>
              </div>
            </CardBody>
          </Card>
        )}

        {/* PDF MODAL */}
        {showPdfPreview && (
          <div className="fixed inset-0 z-50 bg-black/70 px-4 py-6" onClick={() => setShowPdfPreview(false)}>
            <div
              className="mx-auto w-full max-w-4xl rounded-2xl bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-neutral-200 dark:border-neutral-800">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-lg font-extrabold">PDF Vorschau</div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={downloadPdf}
                      className="h-10 px-4 rounded-2xl text-white font-semibold inline-flex items-center gap-2 hover:opacity-90"
                      style={{ background: ORANGE }}
                      aria-label="PDF herunterladen"
                      title="PDF herunterladen"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </button>

                    <button
                      className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                      onClick={() => setShowPdfPreview(false)}
                      type="button"
                    >
                      ✕ Schließen
                    </button>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 text-sm space-y-1">
                  <div>
                    <b>Kunde:</b> {customerName}
                  </div>
                  <div>
                    <b>Lieferschein:</b> {dnInput}
                  </div>
                  <div>
                    <b>Produkt(e):</b> {productNames.length ? productNames.join(" • ") : "—"}
                  </div>
                  <div>
                    <b>Gerätetyp:</b> {deviceType === "mini" ? "Barebone Mini-PC" : "Rugged Tablet"}
                  </div>
                  <div>
                    <b>Bearbeiter:</b> {operator}
                  </div>
                </div>
              </div>

              <div className="p-6 flex-1 overflow-auto space-y-6">
                <div className="text-sm font-extrabold">Fertigung (Details)</div>

                <div className="space-y-4">
                  {rows.map((r) => (
                    <div key={r.sn} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="font-mono font-semibold">{r.sn}</div>
                        <div className="text-sm text-neutral-600 dark:text-neutral-300">
                          Scan: <b>{r.confirmed ? "Durchgeführt" : "Nicht durchgeführt"}</b>
                        </div>
                      </div>

                      <div className="mt-3 text-sm space-y-1">
                        {deviceFields.map((f) => {
                          if (!shouldShowField(r, f)) return null;

                          const v: any = (r as any)[f.key];

                          if (f.type === "yn") {
                            if (f.key === "visual") {
                              return (
                                <React.Fragment key={f.key}>
                                  <div>
                                    <b>{f.label}</b> {ynLabel(r.visual)}
                                  </div>
                                  {r.visual === "no" ? (
                                    <div>
                                      <b>Kommentar:</b> {r.visualComment || "—"}
                                    </div>
                                  ) : null}
                                </React.Fragment>
                              );
                            }
                            return (
                              <div key={f.key}>
                                <b>{f.label}</b> {ynLabel((v as Yn) ?? "unset")}
                              </div>
                            );
                          }

                          if (f.type === "boolean") {
                            return (
                              <div key={f.key} className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2">
                                {f.label}: <b>{boolLabel(Boolean(v))}</b>
                              </div>
                            );
                          }

                          return (
                            <div key={f.key}>
                              <b>{f.label}</b> {String(v ?? "").trim() || "—"}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 text-sm space-y-2">
                  <div>
                    <b>Datum:</b> {todayStr}
                  </div>
                  <div>
                    <b>Kürzel:</b> {signatureInitials || "—"}
                  </div>

                  <div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-300 mb-2">Unterschrift</div>
                    {signatureDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={signatureDataUrl}
                        alt="Unterschrift"
                        className={
                          "w-full max-h-56 object-contain rounded-lg border border-neutral-200 dark:border-neutral-800 " +
                          (dark ? "bg-neutral-900" : "bg-white")
                        }
                      />
                    ) : (
                      <div className="text-neutral-500 dark:text-neutral-300">—</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex justify-end gap-3">
                <Btn variant="outline" onClick={() => setShowPdfPreview(false)}>
                  Zurück
                </Btn>
                <Btn onClick={() => alert("Upload zu weclapp (Demo)")}>Upload zu weclapp</Btn>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
