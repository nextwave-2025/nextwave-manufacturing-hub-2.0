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

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-neutral-200 dark:border-neutral-800 px-2.5 py-1 text-xs text-neutral-600 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-950">
      {children}
    </span>
  );
}

type Section = { title: string; fields: FieldDef[] };

type EditState =
  | {
      open: true;
      sectionIndex: number;
      fieldIndex: number;
      draft: FieldDef;
    }
  | { open: false };

export default function AdminPage() {
  // ✅ Login Gate (1:1 wie User-Mode)
  type UserKey = "mustafa" | "jonas";
  const USERS: { key: UserKey; name: string; email: string; password: string }[] = [
    { key: "mustafa", name: "Mustafa Ergin", email: "mustafa@next-wave.tech", password: "NEXTWAVE123" },
    { key: "jonas", name: "Jonas Harlacher", email: "jonas@next-wave.tech", password: "NEXTWAVE123" },
  ];

  const [isAuthed, setIsAuthed] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const doLogin = () => {
    const email = loginEmail.trim().toLowerCase();
    const pw = loginPassword;

    const u = USERS.find((x) => x.email.toLowerCase() === email && x.password === pw);
    if (!u) {
      setLoginError("Login fehlgeschlagen. Bitte E-Mail/Passwort prüfen.");
      return;
    }

    setLoginError(null);
    setIsAuthed(true);
  };

  // ======== DEIN BESTEHENDER ADMIN-CODE (UNVERÄNDERT) ========
  const [group, setGroup] = useState<GroupKey>("mini");
  const [layouts, setLayouts] = useState<Record<GroupKey, LayoutConfig> | null>(null);

  const [edit, setEdit] = useState<EditState>({ open: false });

  useEffect(() => {
    setLayouts(loadLayouts());
  }, []);

  const cfg = useMemo(() => {
    if (!layouts) return null;
    return layouts[group] ?? DEFAULT_LAYOUTS[group];
  }, [layouts, group]);

  const sections: Section[] = useMemo(() => cfg?.sections ?? [], [cfg]);

  const knownFieldCatalog = useMemo(() => {
    // alle Default-Felder (mini + rugged) als “Katalog” für Dropdown
    const all = [...DEFAULT_LAYOUTS.mini.sections.flatMap((s) => s.fields), ...DEFAULT_LAYOUTS.rugged.sections.flatMap((s) => s.fields)];
    const map = new Map<string, FieldDef>();
    for (const f of all) map.set(f.key, f);
    return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
  }, []);

  const enabledCount = useMemo(() => {
    const all = sections.flatMap((s) => s.fields);
    return all.length;
  }, [sections]);

  const updateLayouts = (nextCfg: LayoutConfig) => {
    if (!layouts) return;
    const next = { ...layouts, [group]: nextCfg };
    setLayouts(next);
  };

  const moveSection = (idx: number, dir: -1 | 1) => {
    if (!cfg) return;
    const arr = cfg.sections.slice();
    const ni = idx + dir;
    if (ni < 0 || ni >= arr.length) return;
    const tmp = arr[idx];
    arr[idx] = arr[ni];
    arr[ni] = tmp;
    updateLayouts({ ...cfg, sections: arr });
  };

  const renameSection = (idx: number, title: string) => {
    if (!cfg) return;
    const arr = cfg.sections.slice();
    arr[idx] = { ...arr[idx], title };
    updateLayouts({ ...cfg, sections: arr });
  };

  const deleteSection = (idx: number) => {
    if (!cfg) return;
    const arr = cfg.sections.slice();
    arr.splice(idx, 1);
    updateLayouts({ ...cfg, sections: arr });
  };

  const addSection = () => {
    if (!cfg) return;
    const title = prompt("Section-Name (z.B. OS / Windows):");
    if (!title) return;
    updateLayouts({ ...cfg, sections: [...cfg.sections, { title, fields: [] }] });
  };

  const moveField = (si: number, fi: number, dir: -1 | 1) => {
    if (!cfg) return;
    const arr = cfg.sections.slice();
    const sec = arr[si];
    const fields = sec.fields.slice();
    const ni = fi + dir;
    if (ni < 0 || ni >= fields.length) return;
    const tmp = fields[fi];
    fields[fi] = fields[ni];
    fields[ni] = tmp;
    arr[si] = { ...sec, fields };
    updateLayouts({ ...cfg, sections: arr });
  };

  const deleteField = (si: number, fi: number) => {
    if (!cfg) return;
    const arr = cfg.sections.slice();
    const sec = arr[si];
    const fields = sec.fields.slice();
    fields.splice(fi, 1);
    arr[si] = { ...sec, fields };
    updateLayouts({ ...cfg, sections: arr });
  };

  const openEdit = (si: number, fi: number) => {
    if (!cfg) return;
    const f = cfg.sections[si].fields[fi];
    setEdit({ open: true, sectionIndex: si, fieldIndex: fi, draft: structuredClone(f) });
  };

  const saveEdit = () => {
    if (!cfg || !edit.open) return;
    const arr = cfg.sections.slice();
    const sec = arr[edit.sectionIndex];
    const fields = sec.fields.slice();
    fields[edit.fieldIndex] = edit.draft;
    arr[edit.sectionIndex] = { ...sec, fields };
    updateLayouts({ ...cfg, sections: arr });
    setEdit({ open: false });
  };

  const addFieldWizard = (si: number) => {
    if (!cfg) return;

    // 1) Modus wählen
    const mode = prompt(
      `Feld hinzufügen:\n\n` +
        `1 = Bestehendes Feld auswählen (empfohlen)\n` +
        `2 = Neues Feld anlegen (advanced)\n\n` +
        `Gib 1 oder 2 ein:`,
    );
    if (!mode) return;

    let newField: FieldDef | null = null;

    if (mode.trim() === "1") {
      const pick = prompt(
        `Welches Feld-Key willst du hinzufügen?\n\n` +
          knownFieldCatalog.map((f) => `${f.key}  —  (${f.type})  ${f.label}`).join("\n") +
          `\n\nKey exakt eingeben:`,
      );
      if (!pick) return;
      const found = knownFieldCatalog.find((x) => x.key === pick.trim());
      if (!found) {
        alert("Key nicht gefunden. Bitte exakt aus der Liste kopieren.");
        return;
      }
      newField = structuredClone(found);
    } else if (mode.trim() === "2") {
      const key = prompt("Key (technische ID, z.B. bitlockerOff):");
      if (!key) return;
      const label = prompt("UI Bezeichnung (Label):", key);
      if (!label) return;
      const type = prompt("Typ: yn oder boolean ?", "boolean");
      if (!type || (type !== "yn" && type !== "boolean")) {
        alert("Typ muss 'yn' oder 'boolean' sein.");
        return;
      }
      const req = prompt("Pflichtfeld? ja/nein", "nein");
      const required = (req || "").toLowerCase().startsWith("j");

      newField =
        type === "yn"
          ? ({ key: key.trim(), label: label.trim(), type: "yn", required } as FieldDef)
          : ({ key: key.trim(), label: label.trim(), type: "boolean", required } as FieldDef);
    } else {
      return;
    }

    // Duplikat-Check
    const exists = cfg.sections.some((s) => s.fields.some((f) => f.key === newField!.key));
    if (exists) {
      alert("Dieses Key existiert bereits in deinem Layout.");
      return;
    }

    const arr = cfg.sections.slice();
    const sec = arr[si];
    arr[si] = { ...sec, fields: [...sec.fields, newField!] };
    updateLayouts({ ...cfg, sections: arr });
  };

  const saveAll = () => {
    if (!layouts) return;
    saveLayouts(layouts);
    alert("Layout gespeichert (LocalStorage).");
  };

  const resetAll = () => {
    resetLayouts();
    setLayouts(DEFAULT_LAYOUTS);
    alert("Layout zurückgesetzt (Default).");
  };

  // ✅ Login Screen zuerst
  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)] dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-xl font-extrabold text-neutral-900 dark:text-neutral-100">NEXTWAVE Admin – Layout Editor</div>
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

              {/* ✅ Eye OHNE Rahmen/Border */}
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

  // ✅ Ab hier: DEIN RENDER-CODE UNVERÄNDERT
  if (!layouts || !cfg) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 p-6">
        <div className="text-sm text-neutral-600 dark:text-neutral-300">Layout wird geladen…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <Card>
          <CardHeader
            title="Admin – Layout Editor"
            desc="Sections + Felder verwalten (Reihenfolge, Pflichtfelder, Sichtbar-wenn). Speicherung: LocalStorage."
          />
          <CardBody>
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`h-11 px-4 rounded-2xl border text-sm font-semibold ${
                    group === "mini"
                      ? "text-white border-transparent"
                      : "border-neutral-200 text-neutral-700 bg-white hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-200 dark:border-neutral-800"
                  }`}
                  style={group === "mini" ? { background: ORANGE } : undefined}
                  onClick={() => setGroup("mini")}
                >
                  Mini-PC
                </button>
                <button
                  type="button"
                  className={`h-11 px-4 rounded-2xl border text-sm font-semibold ${
                    group === "rugged"
                      ? "text-white border-transparent"
                      : "border-neutral-200 text-neutral-700 bg-white hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-200 dark:border-neutral-800"
                  }`}
                  style={group === "rugged" ? { background: ORANGE } : undefined}
                  onClick={() => setGroup("rugged")}
                >
                  Rugged Tablet
                </button>
              </div>

              <div className="text-sm text-neutral-600 dark:text-neutral-300">
                Felder gesamt: <b>{enabledCount}</b> • Version: <b>{cfg.version}</b>
              </div>

              <div className="flex gap-2">
                <Btn variant="outline" onClick={addSection}>
                  <Plus className="h-4 w-4 mr-2" />
                  + Section
                </Btn>
                <Btn variant="outline" onClick={resetAll}>
                  <RefreshCcw className="h-4 w-4 mr-2" />
                  Reset Default
                </Btn>
                <Btn onClick={saveAll}>
                  <Save className="h-4 w-4 mr-2" />
                  Speichern
                </Btn>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {sections.map((s, si) => (
                <div
                  key={`${s.title}-${si}`}
                  className="rounded-2xl border border-neutral-200 bg-white dark:bg-neutral-900 dark:border-neutral-800 overflow-hidden"
                >
                  <div className="p-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        className="h-10 rounded-2xl border border-neutral-200 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                        value={s.title}
                        onChange={(e) => renameSection(si, e.target.value)}
                      />
                      <Badge>{s.fields.length} Felder</Badge>
                    </div>

                    <div className="flex items-center gap-2">
                      <Btn variant="outline" onClick={() => moveSection(si, -1)}>
                        <ArrowUp className="h-4 w-4 mr-2" /> Section hoch
                      </Btn>
                      <Btn variant="outline" onClick={() => moveSection(si, 1)}>
                        <ArrowDown className="h-4 w-4 mr-2" /> Section runter
                      </Btn>
                      <Btn variant="outline" onClick={() => addFieldWizard(si)}>
                        <Plus className="h-4 w-4 mr-2" /> + Feld
                      </Btn>
                      <Btn variant="outline" onClick={() => deleteSection(si)}>
                        <Trash2 className="h-4 w-4 mr-2" /> Section löschen
                      </Btn>
                    </div>
                  </div>

                  <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {s.fields.length === 0 ? (
                      <div className="p-4 text-sm text-neutral-500 dark:text-neutral-300">Keine Felder in dieser Section.</div>
                    ) : (
                      s.fields.map((f, fi) => (
                        <div key={f.key} className="p-4 flex items-start justify-between gap-4 flex-wrap">
                          <div className="min-w-[320px]">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="font-mono text-sm font-semibold">{f.key}</div>
                              <Badge>Typ: {f.type}</Badge>
                              {f.required ? <Badge>Required</Badge> : <Badge>Optional</Badge>}
                              {"requiresCommentWhenNo" in f && f.requiresCommentWhenNo ? <Badge>Kommentar bei NEIN</Badge> : null}
                              {f.showWhen ? (
                                <Badge>
                                  Sichtbar wenn: {f.showWhen.key} {"eqYn" in f.showWhen ? `= ${f.showWhen.eqYn}` : `= ${String(f.showWhen.eqBool)}`}
                                </Badge>
                              ) : null}
                            </div>
                            <div className="text-sm text-neutral-700 dark:text-neutral-200 mt-1">{f.label}</div>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              className="h-10 w-10 rounded-2xl border border-neutral-200 bg-white hover:bg-neutral-50 dark:bg-neutral-900 dark:border-neutral-800 dark:hover:bg-neutral-800 inline-flex items-center justify-center"
                              onClick={() => moveField(si, fi, -1)}
                              aria-label="Nach oben"
                            >
                              <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              className="h-10 w-10 rounded-2xl border border-neutral-200 bg-white hover:bg-neutral-50 dark:bg-neutral-900 dark:border-neutral-800 dark:hover:bg-neutral-800 inline-flex items-center justify-center"
                              onClick={() => moveField(si, fi, 1)}
                              aria-label="Nach unten"
                            >
                              <ArrowDown className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              className="h-10 w-10 rounded-2xl border border-neutral-200 bg-white hover:bg-neutral-50 dark:bg-neutral-900 dark:border-neutral-800 dark:hover:bg-neutral-800 inline-flex items-center justify-center"
                              onClick={() => openEdit(si, fi)}
                              aria-label="Bearbeiten"
                              title="Bearbeiten"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              className="h-10 w-10 rounded-2xl border border-neutral-200 bg-white hover:bg-neutral-50 dark:bg-neutral-900 dark:border-neutral-800 dark:hover:bg-neutral-800 inline-flex items-center justify-center"
                              onClick={() => deleteField(si, fi)}
                              aria-label="Löschen"
                              title="Löschen"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 text-xs text-neutral-500 dark:text-neutral-300">
              Tipp: “Sichtbar wenn …” macht die Abhängigkeiten transparent (z.B. SSD nur wenn OS = Nein). “Kommentar bei NEIN” ist für Sichtprüfung.
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Edit Modal */}
      {edit.open && (
        <div className="fixed inset-0 z-50 bg-black/70 px-4 py-6" onClick={() => setEdit({ open: false })}>
          <div
            className="mx-auto w-full max-w-2xl rounded-2xl bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-neutral-200 dark:border-neutral-800">
              <div className="text-lg font-extrabold">Feld bearbeiten</div>
              <div className="text-sm text-neutral-500 dark:text-neutral-300 mt-1">
                Achtung: Key ändern kann bestehende gespeicherte Werte “entkoppeln”.
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-sm font-semibold mb-1">Key</div>
                  <input
                    className="w-full h-11 rounded-2xl border border-neutral-200 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 font-mono"
                    value={edit.draft.key}
                    onChange={(e) => setEdit({ ...edit, draft: { ...edit.draft, key: e.target.value } })}
                  />
                </div>
                <div>
                  <div className="text-sm font-semibold mb-1">Label (UI)</div>
                  <input
                    className="w-full h-11 rounded-2xl border border-neutral-200 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                    value={edit.draft.label}
                    onChange={(e) => setEdit({ ...edit, draft: { ...edit.draft, label: e.target.value } })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <div className="text-sm font-semibold mb-1">Typ</div>
                  <select
                    className="w-full h-11 rounded-2xl border border-neutral-200 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                    value={edit.draft.type}
                    onChange={(e) => {
                      const t = e.target.value as "yn" | "boolean";
                      // type switch: keep key/label/required/showWhen
                      if (t === "yn") {
                        setEdit({ ...edit, draft: { ...(edit.draft as any), type: "yn" } });
                      } else {
                        setEdit({ ...edit, draft: { ...(edit.draft as any), type: "boolean" } });
                      }
                    }}
                  >
                    <option value="yn">yn</option>
                    <option value="boolean">boolean</option>
                  </select>
                </div>

                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    className={`h-11 px-4 rounded-2xl border text-sm font-semibold ${
                      edit.draft.required
                        ? "text-white border-transparent"
                        : "border-neutral-200 text-neutral-700 bg-white hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-200 dark:border-neutral-800"
                    }`}
                    style={edit.draft.required ? { background: ORANGE } : undefined}
                    onClick={() => setEdit({ ...edit, draft: { ...edit.draft, required: !edit.draft.required } })}
                  >
                    {edit.draft.required ? "Required" : "Optional"}
                  </button>

                  {"requiresCommentWhenNo" in edit.draft && edit.draft.type === "yn" ? (
                    <button
                      type="button"
                      className={`h-11 px-4 rounded-2xl border text-sm font-semibold ${
                        (edit.draft as any).requiresCommentWhenNo
                          ? "text-white border-transparent"
                          : "border-neutral-200 text-neutral-700 bg-white hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-200 dark:border-neutral-800"
                      }`}
                      style={(edit.draft as any).requiresCommentWhenNo ? { background: ORANGE } : undefined}
                      onClick={() =>
                        setEdit({
                          ...edit,
                          draft: { ...(edit.draft as any), requiresCommentWhenNo: !(edit.draft as any).requiresCommentWhenNo },
                        })
                      }
                      title="Kommentar-Box bei Auswahl NEIN"
                    >
                      Kommentar bei NEIN
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
                <div className="text-sm font-semibold">Sichtbar wenn (optional)</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-300 mt-1">
                  Damit sieht man im Admin sofort, dass z.B. “SSD erkannt?” an “OS installiert?” hängt.
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs font-semibold mb-1">Steuer-Key</div>
                    <input
                      className="w-full h-11 rounded-2xl border border-neutral-200 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100 font-mono"
                      placeholder="z.B. osInstalled"
                      value={edit.draft.showWhen?.key ?? ""}
                      onChange={(e) => {
                        const key = e.target.value.trim();
                        if (!key) {
                          const d = { ...edit.draft };
                          delete (d as any).showWhen;
                          setEdit({ ...edit, draft: d });
                          return;
                        }
                        // default rule type depends on field type
                        if (edit.draft.type === "yn") setEdit({ ...edit, draft: { ...edit.draft, showWhen: { key, eqYn: "yes" as Yn } } });
                        else setEdit({ ...edit, draft: { ...edit.draft, showWhen: { key, eqBool: true } } });
                      }}
                    />
                  </div>

                  <div>
                    <div className="text-xs font-semibold mb-1">Bedingung</div>
                    {edit.draft.type === "yn" ? (
                      <select
                        className="w-full h-11 rounded-2xl border border-neutral-200 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                        value={(edit.draft.showWhen && "eqYn" in edit.draft.showWhen ? edit.draft.showWhen.eqYn : "yes") as Yn}
                        onChange={(e) => {
                          const key = edit.draft.showWhen?.key || "";
                          if (!key) return;
                          setEdit({ ...edit, draft: { ...edit.draft, showWhen: { key, eqYn: e.target.value as Yn } } });
                        }}
                        disabled={!edit.draft.showWhen?.key}
                      >
                        <option value="yes">yes</option>
                        <option value="no">no</option>
                        <option value="unset">unset</option>
                      </select>
                    ) : (
                      <select
                        className="w-full h-11 rounded-2xl border border-neutral-200 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-[#f15124] dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100"
                        value={edit.draft.showWhen && "eqBool" in edit.draft.showWhen ? String(edit.draft.showWhen.eqBool) : "true"}
                        onChange={(e) => {
                          const key = edit.draft.showWhen?.key || "";
                          if (!key) return;
                          setEdit({ ...edit, draft: { ...edit.draft, showWhen: { key, eqBool: e.target.value === "true" } } });
                        }}
                        disabled={!edit.draft.showWhen?.key}
                      >
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    )}
                  </div>

                  <div className="flex items-end">
                    <Btn
                      variant="outline"
                      onClick={() => {
                        const d = { ...edit.draft };
                        delete (d as any).showWhen;
                        setEdit({ ...edit, draft: d });
                      }}
                      disabled={!edit.draft.showWhen}
                    >
                      Regel löschen
                    </Btn>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-neutral-200 dark:border-neutral-800 flex justify-end gap-2">
              <Btn variant="outline" onClick={() => setEdit({ open: false })}>
                Abbrechen
              </Btn>
              <Btn onClick={saveEdit}>Speichern</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
