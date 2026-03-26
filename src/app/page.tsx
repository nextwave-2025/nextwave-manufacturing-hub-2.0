"use client";

import Image from "next/image";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  AlertTriangle,
  Search,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Download,
  Loader2,
  UploadCloud,
} from "lucide-react";
import jsPDF from "jspdf";

import { loadLayouts } from "../lib/layoutConfig";

/** =========================
 * Types
 * ========================= */

type Yn = "unset" | "yes" | "no";
type DeviceType = "mini" | "rugged";

type ShowWhen =
  | { key: string; eqYn: Yn }
  | { key: string; eqBool: boolean };

type FieldType = "yn" | "boolean" | "text";

type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  showWhen?: ShowWhen;
  requiresCommentWhenNo?: boolean;
};

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

type Row = {
  sn: string;
  confirmed: boolean;

  visual: Yn;
  visualComment: string;
  shake: Yn;

  osInstalled: Yn;
  ssdDetected: Yn;

  iotInstalled: Yn;

  [key: string]: any;
};

type WeclappDeviceItem = {
  articleId: string;
  title: string;
  categoryId?: string;
  categoryName?: string;
  serials: string[];
};

type WeclappDeliveryNoteResponse = {
  ok: boolean;
  error?: string;

  entity?: "shipment" | "deliveryNote";
  input?: string;

  documentNumber?: string;
  salesOrderNumber?: string;

  customerName?: string;
  productNames?: string[];

  deviceItems?: WeclappDeviceItem[];
  deviceSerials?: string[];

  raw?: any;
  shipmentId?: string;
};

const ORANGE = "#f15124";

/** =========================
 * Helpers
 * ========================= */

function normalizeSn(v: string) {
  return (v || "").trim().replace(/\s+/g, "").toUpperCase();
}

function emptyRow(sn: string): Row {
  return {
    sn,
    confirmed: false,

    visual: "unset",
    visualComment: "",
    shake: "unset",

    osInstalled: "unset",
    ssdDetected: "unset",

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

function getNoCommentKey(fieldKey: string) {
  return fieldKey === "visual" ? "visualComment" : `${fieldKey}Comment`;
}

function getBoolValue(v: any) {
  return v === true;
}

async function loadImageAsDataUrl(src: string): Promise<string> {
  const res = await fetch(src, { cache: "force-cache" });
  if (!res.ok) throw new Error(`Bild konnte nicht geladen werden: ${src}`);
  const blob = await res.blob();

  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function shouldShowField(row: Row, f: FieldDef): boolean {
  if (f.showWhen && typeof f.showWhen === "object" && "key" in f.showWhen) {
    const cond = f.showWhen as any;
    const val: any = (row as any)[cond.key];
    if ("eqYn" in cond) return val === cond.eqYn;
    if ("eqBool" in cond) return Boolean(val) === cond.eqBool;
  }

  if (f.key === "ssdDetected") return row.osInstalled === "no";

  if (["driversOk", "updatesDone", "powerPlanSet", "windowsActivated"].includes(f.key)) {
    return row.osInstalled === "yes";
  }

  if (["cameraAppInstalled", "controlCenterInstalled"].includes(f.key)) {
    return row.iotInstalled === "yes";
  }

  return true;
}

function isFieldComplete(row: Row, f: FieldDef): boolean {
  if (!shouldShowField(row, f)) return true;

  const v: any = (row as any)[f.key];

  if (f.type === "yn") {
    if (v === "unset") return false;

    if (v === "no" && f.requiresCommentWhenNo) {
      const commentKey = getNoCommentKey(f.key);
      return String((row as any)[commentKey] ?? "").trim().length > 0;
    }

    return true;
  }

  if (f.type === "boolean") {
    if (!f.required) return true;
    return v === true;
  }

  if (!f.required) return true;
  return String(v ?? "").trim().length > 0;
}

/** =========================
 * UI components
 * ========================= */

function Chip({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "blue" | "green";
}) {
  const cls =
    tone === "green"
      ? "bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-200"
      : tone === "blue"
      ? "bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-green-200"
      : "bg-neutral-500/10 text-neutral-700 border-neutral-500/20 dark:text-neutral-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
      {children}
    </span>
  );
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
  onClick?: () => void | Promise<void>;
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

function CheckToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
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

      <div className="text-xs text-neutral-500 dark:text-neutral-300">
        Tipp: Am Tablet im Querformat unterschreiben.
      </div>
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

  const LS_USER_STATE = "nextwave_user_state_v1";
  const LS_USER_OPERATOR = "nextwave_user_operator_v1";

  const [layouts, setLayouts] = useState<Layouts>(() => loadLayouts() as any);

  const [step, setStep] = useState<Step>("delivery");
  const [deviceType, setDeviceType] = useState<DeviceType>("mini");

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

  const [dnInput, setDnInput] = useState("");
  const [dnLoaded, setDnLoaded] = useState(false);

  const [documentNumber, setDocumentNumber] = useState<string>("");
  const [salesOrderNumber, setSalesOrderNumber] = useState<string>("");

  const [customerName, setCustomerName] = useState<string>("");
  const [productNames, setProductNames] = useState<string[]>([]);
  const [deviceItems, setDeviceItems] = useState<WeclappDeviceItem[]>([]);

  const [shipmentId, setShipmentId] = useState<string>("");

  const [dnLoading, setDnLoading] = useState(false);
  const [dnError, setDnError] = useState<string | null>(null);

  const [expectedSerials, setExpectedSerials] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(-1);

  const [search, setSearch] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(false);

  const [dark, setDark] = useState(false);

  const [signatureInitials, setSignatureInitials] = useState<string>("");
  const [signatureDataUrl, setSignatureDataUrl] = useState<string>("");
  const [showPdfPreview, setShowPdfPreview] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadOkMsg, setUploadOkMsg] = useState<string | null>(null);

  useEffect(() => {
    const onFocus = () => setLayouts(loadLayouts() as any);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_USER_STATE);
      if (raw) {
        const s = JSON.parse(raw);

        if (typeof s.step === "string") setStep(s.step as Step);
        if (typeof s.deviceType === "string") setDeviceType(s.deviceType as DeviceType);

        if (typeof s.dnInput === "string") setDnInput(s.dnInput);
        if (typeof s.dnLoaded === "boolean") setDnLoaded(s.dnLoaded);

        if (typeof s.documentNumber === "string") setDocumentNumber(s.documentNumber);
        if (typeof s.salesOrderNumber === "string") setSalesOrderNumber(s.salesOrderNumber);

        if (typeof s.customerName === "string") setCustomerName(s.customerName);
        if (Array.isArray(s.productNames)) setProductNames(s.productNames);
        if (Array.isArray(s.deviceItems)) setDeviceItems(s.deviceItems);

        if (typeof s.shipmentId === "string") setShipmentId(s.shipmentId);

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

    (async () => {
      try {
        const r = await fetch("/api/auth/session", { method: "GET", cache: "no-store" });
        const j = await r.json();

        if (j?.ok) {
          setIsAuthed(true);
          const op = localStorage.getItem(LS_USER_OPERATOR) || "";
          if (op) setOperator(op);
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const snapshot = {
          step,
          deviceType,
          dnInput,
          dnLoaded,
          documentNumber,
          salesOrderNumber,
          customerName,
          productNames,
          deviceItems,
          shipmentId,
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
    documentNumber,
    salesOrderNumber,
    customerName,
    productNames,
    deviceItems,
    shipmentId,
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

  const nowInfo = useMemo(() => {
    const now = new Date();

    const date = now.toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    const time = now.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    });

    return { date, time };
  }, []);

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

  const deviceSections: SectionDef[] = useMemo(() => {
    const cfg = (layouts as any)?.[deviceType] as LayoutConfig | undefined;
    return cfg?.sections?.length ? (cfg.sections as any) : [];
  }, [layouts, deviceType]);

  const deviceFields: FieldDef[] = useMemo(() => {
    return deviceSections.flatMap((s) => (s?.fields ?? []) as any);
  }, [deviceSections]);

  const relevantDeviceCategory = deviceType === "mini" ? "Barebone Mini-PC" : "Rugged Tablet";

  const relevantPdfProducts = useMemo(() => {
    return deviceItems
      .filter((x) => (x.categoryName || "").trim() === relevantDeviceCategory)
      .map((x) => (x.title || "").trim())
      .filter(Boolean);
  }, [deviceItems, relevantDeviceCategory]);

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
      setScanError(`Achtung! Diese S/N wurde im Shipment ${dnInput} nicht erfasst: ${sn}`);
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
    try {
      localStorage.removeItem("nextwave_user_state_v1");
      localStorage.removeItem("nextwave_user_operator_v1");
    } catch {
      // ignore
    }

    setStep("delivery");

    setDnLoaded(false);
    setDnError(null);
    setDnLoading(false);

    setDocumentNumber("");
    setSalesOrderNumber("");

    setCustomerName("");
    setExpectedSerials([]);
    setRows([]);
    setActiveIdx(-1);
    setSearch("");
    setScanError(null);
    setAutoAdvance(false);

    setProductNames([]);
    setDeviceItems([]);

    setShipmentId("");

    setSignatureInitials("");
    setSignatureDataUrl("");
    setShowPdfPreview(false);

    setDeviceType("mini");

    setUploading(false);
    setUploadError(null);
    setUploadOkMsg(null);
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

  const loadDeliveryFromWeclapp = async () => {
    const input = (dnInput || "").trim();
    if (!input) return;

    setDnLoading(true);
    setDnError(null);
    setUploadError(null);
    setUploadOkMsg(null);

    try {
      const r = await fetch(`/api/weclapp/delivery-note?number=${encodeURIComponent(input)}`, {
        method: "GET",
        cache: "no-store",
      });

      const j = (await r.json()) as WeclappDeliveryNoteResponse;

      if (!r.ok || !j?.ok) {
        setDnError(j?.error || `Weclapp-Request fehlgeschlagen (HTTP ${r.status}).`);
        setDnLoaded(false);
        return;
      }

      const cust = (j.customerName || "").trim();
      const prods = Array.isArray(j.productNames) ? j.productNames : [];
      const items = Array.isArray(j.deviceItems) ? j.deviceItems : [];
      const sns = Array.isArray(j.deviceSerials) ? j.deviceSerials : [];

      const sid =
        typeof (j as any)?.shipmentId === "string" && (j as any).shipmentId.trim()
          ? (j as any).shipmentId.trim()
          : typeof (j as any)?.raw?.id === "string" && (j as any).raw.id.trim()
          ? (j as any).raw.id.trim()
          : "";

      setShipmentId(sid);

      const hasRugged = items.some((x) => (x.categoryName || "").trim() === "Rugged Tablet");
      const inferred: DeviceType = hasRugged ? "rugged" : "mini";
      setDeviceType(inferred);

      const normalized = sns.map(normalizeSn).filter(Boolean);
      setExpectedSerials(normalized);
      setRows(normalized.map((sn) => emptyRow(sn)));

      setCustomerName(cust);
      setProductNames(prods);
      setDeviceItems(items);

      setDocumentNumber((j.documentNumber || "").trim());
      setSalesOrderNumber((j.salesOrderNumber || "").trim());

      setDnLoaded(true);
      setScanError(null);
      setSearch("");
      setActiveIdx(-1);

      setShowPdfPreview(false);
      setSignatureInitials("");
      setSignatureDataUrl("");

      setLayouts(loadLayouts() as any);
    } catch {
      setDnError("Weclapp-Request fehlgeschlagen (Netzwerk/JSON).");
      setDnLoaded(false);
    } finally {
      setDnLoading(false);
    }
  };

// =====================================================================
// ERSETZE in page.tsx die komplette Funktion createPdfDoc()
// von "const createPdfDoc = async (): Promise<jsPDF> => {"
// bis zum abschliessenden "};"
// =====================================================================

  const createPdfDoc = async (): Promise<jsPDF> => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const pageWidth  = 595.28;
    const pageHeight = 841.89;
    const margin     = 36;
    const contentWidth = pageWidth - margin * 2;

    // ── Farben ──────────────────────────────────────────────────────────
    const C = {
      orange:   [241, 81, 36]   as const,
      dark:     [15, 16, 20]    as const,
      dark2:    [26, 27, 33]    as const,
      text:     [24, 24, 24]    as const,
      muted:    [110, 110, 110] as const,
      line:     [225, 225, 225] as const,
      lineDark: [200, 200, 200] as const,
      soft:     [246, 246, 247] as const,
      soft2:    [240, 240, 242] as const,
      white:    [255, 255, 255] as const,
      greenBg:  [235, 248, 240] as const,
      greenTxt: [16, 118, 62]   as const,
      redTxt:   [168, 52, 32]   as const,
      shadow:   [210, 210, 212] as const,
    } as const;

    let y = 0;

    const setT = (rgb: readonly number[]) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
    const setF = (rgb: readonly number[]) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    const setD = (rgb: readonly number[]) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);

    const write = (
      text: string,
      x: number,
      yPos: number,
      opts?: {
        size?: number;
        bold?: boolean;
        color?: readonly number[];
        align?: "left" | "right" | "center";
      }
    ) => {
      doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
      doc.setFontSize(opts?.size ?? 10);
      setT(opts?.color ?? C.text);
      doc.text(text, x, yPos, opts?.align ? { align: opts.align } : undefined);
    };

    const writeWrapped = (
      text: string,
      x: number,
      yPos: number,
      maxWidth: number,
      opts?: {
        size?: number;
        bold?: boolean;
        color?: readonly number[];
        lineHeight?: number;
      }
    ): number => {
      doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
      doc.setFontSize(opts?.size ?? 10);
      setT(opts?.color ?? C.text);
      const lines = doc.splitTextToSize(text || "—", maxWidth);
      doc.text(lines, x, yPos);
      return lines.length * (opts?.lineHeight ?? 14);
    };

    const ensureSpace = (needed: number) => {
      if (y + needed > pageHeight - 50) {
        doc.addPage();
        y = 44;
      }
    };

    const drawShadowCard = (x: number, cy: number, w: number, h: number, r = 16) => {
      setF(C.shadow);
      doc.roundedRect(x + 2, cy + 3, w, h, r, r, "F");
      setF(C.white);
      setD(C.line);
      doc.roundedRect(x, cy, w, h, r, r, "FD");
    };

    // ════════════════════════════════════════════════════════════════════
    // HEADER – KEIN LOGO, nur Glow-Blob + Text rechts
    // ════════════════════════════════════════════════════════════════════
    const HEADER_H = 148;
    const HEADER_Y = 10;
    const HEADER_R = 20;

    const drawHeader = async () => {
      // Schatten
      setF([195, 195, 197]);
      doc.roundedRect(14, HEADER_Y + 5, pageWidth - 28, HEADER_H, HEADER_R, HEADER_R, "F");

      // Haupthintergrund
      setF(C.dark);
      doc.roundedRect(12, HEADER_Y, pageWidth - 24, HEADER_H, HEADER_R, HEADER_R, "F");

      // Warmer Glow links (4 Schichten für weichen Übergang)
      const gx = 90;
      const gy = HEADER_Y + HEADER_H / 2 + 4;
      const glowLayers: Array<[number, number]> = [
        [95, 0.50],
        [68, 0.36],
        [44, 0.24],
        [26, 0.16],
      ];
      for (const [r, a] of glowLayers) {
        doc.setFillColor(
          Math.round(C.orange[0] * a + C.dark[0] * (1 - a)),
          Math.round(C.orange[1] * a + C.dark[1] * (1 - a)),
          Math.round(C.orange[2] * a + C.dark[2] * (1 - a))
        );
        doc.circle(gx, gy, r, "F");
      }
      // Innerer heller Kern
      setF([215, 62, 24]);
      doc.circle(gx, gy, 18, "F");

      // Subtiler weisslicher Schimmer rechts
      for (const [r, a] of [[100, 0.04], [68, 0.06], [40, 0.04]] as [number, number][]) {
        doc.setFillColor(
          Math.round(255 * a + C.dark[0] * (1 - a)),
          Math.round(255 * a + C.dark[1] * (1 - a)),
          Math.round(255 * a + C.dark[2] * (1 - a))
        );
        doc.circle(pageWidth - 60, gy, r, "F");
      }

      // ── Rechts: Titel-Block ──────────────────────────────────────────
      const rx = pageWidth - 36;

      write("NEXTWAVE Manufacturing Hub 2.0", rx, HEADER_Y + 42, {
        size: 19, bold: true, color: C.orange, align: "right",
      });
      write("Fertigungsprotokoll", rx, HEADER_Y + 68, {
        size: 13.5, bold: true, color: C.white, align: "right",
      });
      write("NEXTWAVE GmbH – Premium Manufacturing Documentation", rx, HEADER_Y + 90, {
        size: 8.5, color: [210, 210, 210], align: "right",
      });
      write("© NEXTWAVE GmbH – All rights reserved 2026", rx, HEADER_Y + 108, {
        size: 7.5, color: [160, 160, 160], align: "right",
      });

      // Orangefarbene Trennlinie
      const lineY = HEADER_Y + HEADER_H + 4;
      setF(C.orange);
      doc.roundedRect(12, lineY, pageWidth - 24, 6, 3, 3, "F");
    };

    // ── Info-Card ────────────────────────────────────────────────────────
    const measureInfoCardH = (w: number, rows: Array<{ label: string; value: string }>) => {
      let h = 44;
      for (const row of rows) {
        const lines = doc.splitTextToSize(row.value || "—", w - 130);
        h += Math.max(20, lines.length * 14);
      }
      return h + 12;
    };

    const drawInfoCard = (
      cx: number,
      cy: number,
      w: number,
      title: string,
      rows: Array<{ label: string; value: string }>
    ): number => {
      const cardH = measureInfoCardH(w, rows);
      setF(C.soft);
      setD(C.line);
      doc.roundedRect(cx, cy, w, cardH, 14, 14, "FD");

      write(title, cx + 16, cy + 20, { size: 9.5, bold: true, color: C.orange });

      setD(C.lineDark);
      doc.setLineWidth(0.4);
      doc.line(cx + 14, cy + 28, cx + w - 14, cy + 28);
      doc.setLineWidth(0.5);

      let yy = cy + 44;
      for (const row of rows) {
        write(`${row.label}:`, cx + 16, yy, { size: 8.5, bold: true, color: C.muted });
        const h = writeWrapped(row.value || "—", cx + 120, yy, w - 136, {
          size: 9, color: C.text, lineHeight: 14,
        });
        yy += Math.max(20, h + 2);
      }
      return cardH;
    };

    // ── Unit-Card Helfer ─────────────────────────────────────────────────
    const getFieldValueLabel = (r: Row, f: FieldDef): string => {
      const v: any = (r as any)[f.key];
      if (f.type === "yn")      return ynLabel((v as Yn) ?? "unset");
      if (f.type === "boolean") return boolLabel(getBoolValue(v));
      return String(v ?? "").trim() || "—";
    };

    const getVisibleLines = (r: Row) => {
      const lines: Array<{ label: string; value: string; isSection?: boolean }> = [];
      for (const sec of deviceSections) {
        const visible = (sec.fields || []).filter((f) => shouldShowField(r, f));
        if (!visible.length) continue;
        lines.push({ label: sec.title, value: "", isSection: true });
        for (const f of visible) {
          lines.push({ label: f.label, value: getFieldValueLabel(r, f) });
          if (f.type === "yn" && f.requiresCommentWhenNo) {
            const val = (r as any)[f.key] as Yn;
            if (val === "no") {
              const ck = getNoCommentKey(f.key);
              lines.push({ label: "Kommentar", value: String((r as any)[ck] ?? "").trim() || "—" });
            }
          }
        }
      }
      return lines;
    };

    // FIX 1: valueX deutlich weiter rechts, valueW schmaler
    // Damit "Ja"/"Nein" nicht mit den Fragen überlappt
    const LABEL_X_OFFSET = 16;   // Abstand von Card-Links zur Beschriftung
    const VALUE_X_OFFSET = 230;  // Wert startet erst bei 230pt → genug Luft
    const VALUE_W_REDUCTION = 246; // contentWidth - diese Zahl = Wertbreite

    const estimateUnitH = (r: Row): number => {
      const lines = getVisibleLines(r);
      let h = 72;
      for (const line of lines) {
        if (line.isSection) { h += 28; continue; }
        const wrapped = doc.splitTextToSize(
          line.value || "—",
          contentWidth - VALUE_W_REDUCTION
        );
        h += Math.max(20, wrapped.length * 14 + 2);
      }
      return h + 12;
    };

    const drawUnitCard = (r: Row, idx: number) => {
      const cardH = estimateUnitH(r);
      ensureSpace(cardH);

      drawShadowCard(margin, y, contentWidth, cardH, 16);

      // Dunkler Header-Streifen
      const UNIT_H = 38;
      setF(C.dark2);
      doc.roundedRect(margin, y, contentWidth, UNIT_H, 16, 16, "F");
      doc.rect(margin, y + UNIT_H - 16, contentWidth, 16, "F");

      write(`${idx + 1}.`, margin + 14, y + 24, { size: 9, bold: true, color: C.orange });
      write("Seriennummer", margin + 30, y + 24, { size: 9, color: [190, 190, 190] });
      write(r.sn, pageWidth - margin - 14, y + 24, {
        size: 10.5, bold: true, color: C.white, align: "right",
      });

      // Status-Chips
      let yy = y + UNIT_H + 14;
      const scanOk = r.confirmed;
      setF(scanOk ? C.greenBg : C.soft2);
      setD(scanOk ? [180, 230, 200] as const : C.line);
      doc.roundedRect(margin + 14, yy - 10, 162, 22, 10, 10, "FD");
      write(
        scanOk ? "Scan durchgefuhrt" : "Scan ausstehend",
        margin + 26, yy + 3,
        { size: 8.5, bold: true, color: scanOk ? C.greenTxt : C.muted }
      );

      const done = isRowComplete(r);
      setF(done ? C.greenBg : C.soft2);
      setD(done ? [180, 230, 200] as const : C.line);
      doc.roundedRect(pageWidth - margin - 178, yy - 10, 162, 22, 10, 10, "FD");
      write(
        done ? "Status: Fertig" : "Status: Offen",
        pageWidth - margin - 178 + 81, yy + 3,
        { size: 8.5, bold: true, color: done ? C.greenTxt : C.muted, align: "center" }
      );

      yy += 28;

      // Felder mit fix verbreiterter Werte-Spalte
      const labelX = margin + LABEL_X_OFFSET;
      const valueX = margin + VALUE_X_OFFSET;
      const valueW = contentWidth - VALUE_W_REDUCTION;

      for (const line of getVisibleLines(r)) {
        if (line.isSection) {
          setF(C.soft2);
          setD(C.line);
          doc.roundedRect(margin + 12, yy - 9, contentWidth - 24, 20, 10, 10, "FD");
          write(line.label, margin + 26, yy + 3, { size: 8.5, bold: true, color: C.orange });
          yy += 28;
          continue;
        }

        write(`${line.label}:`, labelX, yy, { size: 8.5, bold: true, color: C.muted });
        const h = writeWrapped(line.value || "—", valueX, yy, valueW, {
          size: 9, color: C.text, lineHeight: 14,
        });
        yy += Math.max(20, h + 2);
      }

      y += cardH + 12;
    };

    // ════════════════════════════════════════════════════════════════════
    // PDF AUFBAUEN
    // ════════════════════════════════════════════════════════════════════

    await drawHeader();
    y = HEADER_Y + HEADER_H + 14 + 10;

    // Info-Cards
    const cardW = (contentWidth - 12) / 2;
    const leftRows = [
      { label: "Kunde",       value: customerName     || "—" },
      { label: "Shipment",    value: dnInput          || "—" },
      { label: "Belegnr.",    value: documentNumber   || "—" },
      { label: "Auftragsnr.", value: salesOrderNumber || "—" },
    ];
    const rightRows = [
      { label: "Gerätetyp",  value: deviceType === "mini" ? "Barebone Mini-PC" : "Rugged Tablet" },
      { label: "Bearbeiter", value: operator   || "—" },
      { label: "Datum",      value: nowInfo.date },
      { label: "Uhrzeit",    value: nowInfo.time },
      { label: "Shipment-ID",value: shipmentId || "—" },
    ];

    const leftH  = drawInfoCard(margin,              y, cardW, "Auftragsdaten", leftRows);
    const rightH = drawInfoCard(margin + cardW + 12, y, cardW, "Protokoll",     rightRows);
    y += Math.max(leftH, rightH) + 16;

    // Produkte
    if (relevantPdfProducts.length) {
      setF(C.soft);
      setD(C.line);
      doc.roundedRect(margin, y, contentWidth, 58, 14, 14, "FD");
      write("Produkte", margin + 16, y + 20, { size: 9.5, bold: true, color: C.orange });
      setD(C.lineDark);
      doc.setLineWidth(0.4);
      doc.line(margin + 14, y + 28, margin + contentWidth - 14, y + 28);
      doc.setLineWidth(0.5);
      writeWrapped(relevantPdfProducts.join("  •  "), margin + 16, y + 44, contentWidth - 32, {
        size: 9.5, color: C.text, lineHeight: 14,
      });
      // FIX 2: Mehr Abstand nach Produkte-Card
      y += 58 + 24;
    }

    // FIX 3: Fertigungseinheiten-Überschrift
    write("Fertigungseinheiten", margin, y, { size: 13, bold: true, color: C.text });
    write(`${rows.length} Gerät(e)`, pageWidth - margin, y, {
      size: 9.5, bold: true, color: C.muted, align: "right",
    });
    y += 12;
    setD(C.line);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    // FIX 4: Direkt danach Unit-Cards starten, kein grosser Gap
    y += 12;

    // Unit-Cards – beginnen sofort auf Seite 1
    for (let i = 0; i < rows.length; i++) {
      drawUnitCard(rows[i], i);
    }

    // Abschluss / Freigabe
    const sigH     = signatureDataUrl ? 80 : 0;
    const closingH = 120 + sigH;
    ensureSpace(closingH + 10);

    setF(C.soft);
    setD(C.line);
    doc.roundedRect(margin, y, contentWidth, closingH, 14, 14, "FD");

    write("Abschluss / Freigabe", margin + 16, y + 22, {
      size: 11, bold: true, color: C.orange,
    });
    setD(C.lineDark);
    doc.setLineWidth(0.4);
    doc.line(margin + 14, y + 30, margin + contentWidth - 14, y + 30);
    doc.setLineWidth(0.5);

    let yy2 = y + 44;
    for (const item of [
      { label: "Bearbeiter", value: operator           || "—" },
      { label: "Datum",      value: nowInfo.date                },
      { label: "Uhrzeit",    value: nowInfo.time                },
      { label: "Kürzel",     value: signatureInitials  || "—" },
    ]) {
      write(`${item.label}:`, margin + 16, yy2, { size: 9, bold: true, color: C.muted });
      write(item.value, margin + 110, yy2, { size: 9.5, color: C.text });
      yy2 += 18;
    }

    if (signatureDataUrl) {
      try {
        doc.addImage(signatureDataUrl, "PNG", pageWidth - margin - 180, y + 34, 164, 72);
      } catch { /* ignore */ }
    }

    return doc;
  };

  const buildPdfBlob = async (): Promise<Blob> => {
    const doc = await createPdfDoc();
    return doc.output("blob");
  };

  const downloadPdf = async () => {
    const doc = await createPdfDoc();
    const safeDn = (dnInput || "DOC").replace(/[^\w\-]+/g, "_");
    doc.save(`NEXTWAVE_Fertigungsprotokoll_${safeDn}.pdf`);
  };

  const uploadToWeclapp = async () => {
    setUploadError(null);
    setUploadOkMsg(null);

    if (!dnLoaded) {
      setUploadError("Bitte zuerst ein Shipment laden.");
      return;
    }
    if (!shipmentId) {
      setUploadError("Shipment-ID fehlt (intern). Bitte Shipment erneut laden.");
      return;
    }
    if (!isChecksComplete) {
      setUploadError("Bitte erst alle Einheiten vollständig ausfüllen (Fertigung fertig), dann hochladen.");
      return;
    }

    setUploading(true);
    try {
      const pdfBlob = await buildPdfBlob();

      const safeDn = (dnInput || "SHIPMENT").replace(/[^\w\-]+/g, "_");
      const filename = `NEXTWAVE_Fertigungsprotokoll_${safeDn}.pdf`;

      const fd = new FormData();
      fd.append("file", pdfBlob, filename);
      fd.append("name", filename);
      fd.append("description", `NEXTWAVE Fertigungsprotokoll – Shipment ${dnInput} – ${customerName || "Kunde"}`);

      const r = await fetch(`/api/weclapp/shipment/${encodeURIComponent(shipmentId)}/upload`, {
        method: "POST",
        body: fd,
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.success) {
        const msg = j?.message || j?.error || `Upload fehlgeschlagen (HTTP ${r.status}).`;
        setUploadError(msg);
        return;
      }

      setUploadOkMsg("✅ Upload erfolgreich – Dokument wurde an Weclapp Lieferschein angehängt.");
    } catch {
      setUploadError("Upload fehlgeschlagen (Netzwerk/Server).");
    } finally {
      setUploading(false);
    }
  };

  const renderField = (f: FieldDef, r: Row) => {
    if (!shouldShowField(r, f)) return null;

    if (f.type === "yn") {
      const current = ((r as any)[f.key] as Yn) ?? "unset";
      const commentKey = getNoCommentKey(f.key);
      const commentValue = String((r as any)[commentKey] ?? "");

      return (
        <div key={f.key} className="space-y-2">
          <div className="text-sm font-semibold">{f.label}</div>
          <SelectYN
            value={current}
            onChange={(v) => {
              if (f.key === "osInstalled") {
                setRows((prev) =>
                  prev.map((x, i) => {
                    if (i !== activeIdx) return x;
                    if (v === "no") {
                      return {
                        ...x,
                        osInstalled: v,
                        driversOk: false,
                        updatesDone: false,
                        powerPlanSet: false,
                        windowsActivated: false,
                        [commentKey]: (x as any)[commentKey] ?? "",
                      };
                    }
                    if (v === "yes") {
                      return { ...x, osInstalled: v, ssdDetected: "unset", [commentKey]: "" };
                    }
                    return { ...x, osInstalled: v, [commentKey]: "" };
                  }),
                );
                return;
              }

              if (f.key === "iotInstalled") {
                setRows((prev) =>
                  prev.map((x, i) => {
                    if (i !== activeIdx) return x;
                    if (v === "no") {
                      return {
                        ...x,
                        iotInstalled: v,
                        cameraAppInstalled: false,
                        controlCenterInstalled: false,
                        [commentKey]: (x as any)[commentKey] ?? "",
                      };
                    }
                    return { ...x, iotInstalled: v, [commentKey]: "" };
                  }),
                );
                return;
              }

              setRows((prev) =>
                prev.map((x, i) =>
                  i === activeIdx
                    ? {
                        ...x,
                        [f.key]: v,
                        [commentKey]: v === "no" ? ((x as any)[commentKey] ?? "") : "",
                      }
                    : x,
                ),
              );
            }}
          />

          {current === "no" && f.requiresCommentWhenNo && (
            <textarea
              className="w-full min-h-[96px] rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
              placeholder="Kommentar bei NEIN"
              value={commentValue}
              onChange={(e) => setFieldValue(commentKey, e.target.value)}
            />
          )}
        </div>
      );
    }

    if (f.type === "boolean") {
      const current = (r as any)[f.key] === true;
      return (
        <div key={f.key} className="space-y-2">
          <div className="text-sm font-semibold">Checks (Haken setzen)</div>
          <CheckToggle label={f.label} checked={current} onChange={(v) => setFieldValue(f.key, v)} />
        </div>
      );
    }

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

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)] dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-xl font-extrabold text-neutral-900 dark:text-neutral-100">
            NEXTWAVE Manufacturing Hub 2.0
          </div>
          <div className="text-sm text-neutral-500 dark:text-neutral-300 mt-1">
            Zugriff nur für autorisierte Mitarbeiter.
          </div>

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
                  if (e.key === "Enter") void doLogin();
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
              <div className="mt-2 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                {loginError}
              </div>
            ) : null}

            <div className="pt-4 flex justify-end">
              <Btn onClick={doLogin}>Login</Btn>
            </div>

            <div className="text-xs text-neutral-500 dark:text-neutral-300 pt-2">
              Hinweis: Das ist nur ein UI-Gate. Für echte Sicherheit muss Auth serverseitig erfolgen
              (Cookie + Middleware).
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        {/* PREMIUM HEADER */}
        <div className="rounded-3xl overflow-hidden border border-neutral-200 dark:border-neutral-800">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-b from-neutral-950 to-neutral-900" />
            <div
              className="absolute -top-24 -left-24 h-80 w-80 rounded-full blur-3xl opacity-50"
              style={{ background: ORANGE }}
            />
            <div className="absolute -top-28 -right-28 h-96 w-96 rounded-full blur-3xl opacity-25 bg-white" />

            <div className="relative px-6 py-5 sm:px-8 sm:py-6">
              <div className="flex items-start justify-between gap-6 flex-wrap">
                <div className="flex items-center gap-4">
                  <div className="relative h-10 w-[260px] sm:h-12 sm:w-[340px]">
                    <Image
                      src={dark ? "/nextwave-logo-dark.png" : "/nextwave-logo-light.png"}
                      alt="NEXTWAVE"
                      fill
                      className="object-contain"
                      priority
                    />
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
                        <span className="text-white/60 font-semibold">Kunde:</span>{" "}
                        <span className="text-white font-semibold">{customerName}</span>{" "}
                        <span className="text-white/35">•</span>{" "}
                        <span className="text-white/60 font-semibold">Eingabe:</span>{" "}
                        <span className="text-white font-semibold">{dnInput}</span>
                        {documentNumber ? (
                          <>
                            {" "}
                            <span className="text-white/35">•</span>{" "}
                            <span className="text-white/60 font-semibold">Beleg:</span>{" "}
                            <span className="text-white font-semibold">{documentNumber}</span>
                          </>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-white/70">Bitte zuerst ein Shipment laden.</span>
                    )}
                  </div>

                  <div className="text-sm text-white/75">
                    <span className="text-white/60 font-semibold">Gerätetyp:</span>{" "}
                    <span className="text-white font-semibold">
                      {deviceType === "mini" ? "Barebone Mini-PC" : "Rugged Tablet"}
                    </span>

                    {operator ? (
                      <>
                        {" "}
                        <span className="text-white/35">•</span>{" "}
                        <span className="text-white/60 font-semibold">Bearbeiter:</span>{" "}
                        <span className="text-white font-semibold">{operator}</span>
                      </>
                    ) : null}

                    {dnLoaded ? (
                      <>
                        {" "}
                        <span className="text-white/35">•</span>{" "}
                        <span className="text-white/60 font-semibold">S/N:</span>{" "}
                        <span className="text-white font-semibold">
                          {confirmedCount}/{totalExpected} bestätigt
                        </span>{" "}
                        <span className="text-white/35">•</span>{" "}
                        <span className="text-white font-semibold">
                          {doneCount}/{totalExpected} fertig
                        </span>
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
                      <span
                        className={"h-6 w-11 rounded-full relative transition " + (dark ? "" : "bg-white/25")}
                        style={dark ? { background: ORANGE } : undefined}
                      >
                        <span
                          className={
                            "absolute top-1 left-1 h-4 w-4 rounded-full bg-white transition " +
                            (dark ? "translate-x-5" : "translate-x-0")
                          }
                        />
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
            Optimiert für Tablet & Desktop.
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
                    <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {s.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>

        {/* DELIVERY */}
        {step === "delivery" && (
          <Card>
            <CardHeader
              title="Lieferschein abrufen (Weclapp)"
              desc="Eingabe z. B. Lieferschein-Nummer → Live aus Weclapp."
            />
            <CardBody>
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3 max-w-2xl">
                  <input
                    className="w-full h-11 rounded-2xl border border-neutral-200 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                    value={dnInput}
                    onChange={(e) => setDnInput(e.target.value)}
                    placeholder="z. B. 31969"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void loadDeliveryFromWeclapp();
                    }}
                  />

                  <Btn disabled={!dnInput || !operator || dnLoading} onClick={loadDeliveryFromWeclapp}>
                    {dnLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Laden…
                      </>
                    ) : (
                      "Laden"
                    )}
                  </Btn>
                </div>

                {dnError ? (
                  <div className="flex items-start gap-2 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                    <AlertTriangle className="h-4 w-4 mt-0.5" />
                    <span>{dnError}</span>
                  </div>
                ) : null}

                {dnLoaded && (
                  <div className="rounded-2xl border border-neutral-200 p-4 bg-neutral-50 space-y-2 dark:border-neutral-800 dark:bg-neutral-950">
                    <div>
                      <b>Kunde:</b> {customerName || "—"}
                    </div>
                    <div>
                      <b>Eingabe:</b> {dnInput}
                    </div>
                    <div>
                      <b>Belegnummer:</b> {documentNumber || "—"}
                    </div>
                    <div>
                      <b>Auftragsnummer:</b> {salesOrderNumber || "—"}
                    </div>
                    <div>
                      <b>Shipment-ID (intern):</b> {shipmentId || "—"}
                    </div>
                    <div>
                      <b>Gerätetyp (Warengruppe):</b>{" "}
                      <span className="font-semibold">
                        {deviceType === "mini" ? "Barebone Mini-PC" : "Rugged Tablet"}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1">
                      <b>Produkt(e):</b>
                      {relevantPdfProducts.length ? (
                        <div className="flex flex-wrap gap-2">
                          {relevantPdfProducts.map((p) => (
                            <Chip key={p}>{p}</Chip>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-neutral-500 dark:text-neutral-300">—</div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-1">
                      <b>Erwartet:</b> {expectedSerials.length} Gerät(e) <Chip tone="green">live</Chip>
                    </div>
                  </div>
                )}

                <div className="flex justify-between gap-3 pt-2">
                  <Btn
                    variant="outline"
                    onClick={() => {
                      setDnLoaded(false);
                      setDnError(null);

                      setDocumentNumber("");
                      setSalesOrderNumber("");
                      setCustomerName("");
                      setExpectedSerials([]);
                      setRows([]);
                      setActiveIdx(-1);
                      setSearch("");
                      setScanError(null);

                      setProductNames([]);
                      setDeviceItems([]);

                      setShipmentId("");

                      setUploadError(null);
                      setUploadOkMsg(null);
                    }}
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" /> Zurücksetzen Shipment
                  </Btn>

                  <Btn
                    disabled={!dnLoaded || expectedSerials.length === 0}
                    onClick={() => {
                      setStep("checks");
                      setActiveIdx(-1);
                      focusScan();
                    }}
                  >
                    Zur Fertigung <ArrowRight className="ml-2 h-4 w-4" />
                  </Btn>
                </div>

                {dnLoaded && expectedSerials.length === 0 ? (
                  <div className="text-xs text-neutral-500 dark:text-neutral-300">
                    Hinweis: Es wurden keine Seriennummern in den Warengruppen <b>Barebone Mini-PC</b> /{" "}
                    <b>Rugged Tablet</b> gefunden.
                  </div>
                ) : null}
              </div>
            </CardBody>
          </Card>
        )}

        {/* CHECKS */}
        {step === "checks" && (
          <Card>
            <CardHeader
              title="Fertigung – Scan-Workflow"
              desc="Felder werden dynamisch aus Layout geladen (inkl. Sections + Visible-When)."
            />
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
                      <span
                        className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-white transition ${
                          autoAdvance ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
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
                          {status === "fertig" ? (
                            <Chip tone="green">fertig</Chip>
                          ) : status === "bestätigt" ? (
                            <Chip tone="blue">bestätigt</Chip>
                          ) : (
                            <Chip>offen</Chip>
                          )}
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
                          <ArrowLeft className="mr-2 h-4 w-4" /> Zurück zu Shipment
                        </Btn>
                      </div>
                    </div>
                  ) : (
                    <div
                      ref={activeUnitRef}
                      className="rounded-2xl border border-neutral-200 p-6 bg-white dark:border-neutral-800 dark:bg-neutral-900"
                    >
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                          <div className="text-xs text-neutral-500 dark:text-neutral-300">
                            Aktuelle Seriennummer
                          </div>
                          <div className="font-mono text-xl font-extrabold">{activeRow.sn}</div>
                          <div className="text-xs text-neutral-500 dark:text-neutral-300 mt-1">
                            Scan durchgeführt:{" "}
                            <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                              {activeRow.confirmed ? "Ja" : "Nein"}
                            </span>
                          </div>
                        </div>
                        {isRowComplete(activeRow) ? <Chip tone="green">fertig</Chip> : <Chip>offen</Chip>}
                      </div>

                      <div className="mt-6 space-y-6">
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
                            <ArrowLeft className="mr-2 h-4 w-4" /> Zurück zu Shipment
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
            <CardHeader
              title="Zusammenfassung"
              desc="PDF Vorschau/Download, Signatur, Upload zu Weclapp (Shipment Dokumente)."
            />
            <CardBody>
              <div className="rounded-2xl border border-neutral-200 p-4 bg-neutral-50 space-y-2 dark:border-neutral-800 dark:bg-neutral-950">
                <div>
                  <b>Kunde:</b> {customerName}
                </div>
                <div>
                  <b>Eingabe:</b> {dnInput}
                </div>
                <div>
                  <b>Belegnummer:</b> {documentNumber || "—"}
                </div>
                <div>
                  <b>Auftragsnummer:</b> {salesOrderNumber || "—"}
                </div>
                <div>
                  <b>Shipment-ID (intern):</b> {shipmentId || "—"}
                </div>

                <div className="flex flex-col gap-1">
                  <b>Produkt(e):</b>
                  {relevantPdfProducts.length ? (
                    <div className="flex flex-wrap gap-2">
                      {relevantPdfProducts.map((p) => (
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
                  <b>Datum:</b> {nowInfo.date}{" "}
                  <span className="text-xs text-neutral-500 dark:text-neutral-300">(automatisch)</span>
                </div>
                <div>
                  <b>Uhrzeit:</b> {nowInfo.time}{" "}
                  <span className="text-xs text-neutral-500 dark:text-neutral-300">(automatisch)</span>
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

                {uploadError ? (
                  <div className="mt-3 rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                    {uploadError}
                  </div>
                ) : null}

                {uploadOkMsg ? (
                  <div className="mt-3 rounded-2xl border border-green-300 bg-green-50 p-3 text-sm text-green-800">
                    {uploadOkMsg}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-3 pt-4">
                <Btn variant="outline" onClick={() => setStep("checks")}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Zurück
                </Btn>

                <Btn onClick={downloadPdf}>
                  <Download className="mr-2 h-4 w-4" /> PDF herunterladen
                </Btn>

                <Btn onClick={() => setShowPdfPreview(true)}>PDF Vorschau</Btn>

                <Btn disabled={uploading || !isChecksComplete || !shipmentId} onClick={uploadToWeclapp}>
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Upload…
                    </>
                  ) : (
                    <>
                      <UploadCloud className="mr-2 h-4 w-4" /> Upload zu Weclapp
                    </>
                  )}
                </Btn>
              </div>

              <div className="text-xs text-neutral-500 dark:text-neutral-300 pt-2">
                Upload-Logik: POST multipart/form-data → <b>/api/weclapp/shipment/{shipmentId || "…"} /upload</b>
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
                      onClick={() => void downloadPdf()}
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

                {uploadOkMsg && (
                  <div className="px-6 py-3 bg-green-100 text-green-800 text-sm font-semibold border-b border-green-200">
                    {uploadOkMsg}
                  </div>
                )}

                {uploadError && (
                  <div className="px-6 py-3 bg-red-100 text-red-800 text-sm font-semibold border-b border-red-200">
                    {uploadError}
                  </div>
                )}

                <div className="mt-4 rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 text-sm space-y-1">
                  <div>
                    <b>Kunde:</b> {customerName}
                  </div>
                  <div>
                    <b>Eingabe:</b> {dnInput}
                  </div>
                  <div>
                    <b>Belegnummer:</b> {documentNumber || "—"}
                  </div>
                  <div>
                    <b>Auftragsnummer:</b> {salesOrderNumber || "—"}
                  </div>
                  <div>
                    <b>Shipment-ID:</b> {shipmentId || "—"}
                  </div>
                  <div>
                    <b>Datum:</b> {nowInfo.date}
                  </div>
                  <div>
                    <b>Uhrzeit:</b> {nowInfo.time}
                  </div>
                  <div>
                    <b>Produkte:</b> {relevantPdfProducts.length ? relevantPdfProducts.join(" • ") : "—"}
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

                      <div className="mt-3 text-sm space-y-3">
                        {deviceSections.map((sec) => (
                          <div key={`${r.sn}-${sec.title}`} className="space-y-2">
                            <div className="text-xs font-bold uppercase text-neutral-500 dark:text-neutral-300">
                              {sec.title}
                            </div>

                            {(sec.fields || []).map((f) => {
                              if (!shouldShowField(r, f)) return null;

                              const v: any = (r as any)[f.key];

                              if (f.type === "yn") {
                                const ynValue = (v as Yn) ?? "unset";
                                const commentKey = getNoCommentKey(f.key);
                                const commentValue = String((r as any)[commentKey] ?? "").trim();

                                return (
                                  <React.Fragment key={f.key}>
                                    <div>
                                      <b>{f.label}:</b> {ynLabel(ynValue)}
                                    </div>
                                    {ynValue === "no" && f.requiresCommentWhenNo ? (
                                      <div>
                                        <b>Kommentar:</b> {commentValue || "—"}
                                      </div>
                                    ) : null}
                                  </React.Fragment>
                                );
                              }

                              if (f.type === "boolean") {
                                return (
                                  <div
                                    key={f.key}
                                    className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2"
                                  >
                                    {f.label}: <b>{boolLabel(getBoolValue(v))}</b>
                                  </div>
                                );
                              }

                              return (
                                <div key={f.key}>
                                  <b>{f.label}:</b> {String(v ?? "").trim() || "—"}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 text-sm space-y-2">
                  <div>
                    <b>Datum:</b> {nowInfo.date}
                  </div>
                  <div>
                    <b>Uhrzeit:</b> {nowInfo.time}
                  </div>
                  <div>
                    <b>Kürzel:</b> {signatureInitials || "—"}
                  </div>

                  <div>
                    <div className="text-xs text-neutral-500 dark:text-neutral-300 mb-2">Unterschrift</div>
                    {signatureDataUrl ? (
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

                <Btn disabled={uploading || !isChecksComplete || !shipmentId} onClick={uploadToWeclapp}>
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Upload…
                    </>
                  ) : (
                    <>
                      <UploadCloud className="mr-2 h-4 w-4" /> Upload zu Weclapp
                    </>
                  )}
                </Btn>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
