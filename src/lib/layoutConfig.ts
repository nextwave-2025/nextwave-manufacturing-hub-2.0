// src/lib/layoutConfig.ts
export type GroupKey = "mini" | "rugged";

export type Yn = "unset" | "yes" | "no";

/**
 * showWhen:
 * - eqYn: abhängig von Yn Feld (yes/no/unset)
 * - eqBool: abhängig von boolean Feld
 */
export type ShowWhen =
  | { key: string; eqYn: Yn }
  | { key: string; eqBool: boolean };

export type FieldDef =
  | {
      key: string;
      label: string;
      type: "yn";
      required?: boolean;
      showWhen?: ShowWhen;
      /** nur UI-Hinweis / optionale Logik */
      requiresCommentWhenNo?: boolean;
    }
  | {
      key: string;
      label: string;
      type: "boolean";
      required?: boolean;
      showWhen?: ShowWhen;
    };

export type SectionDef = {
  title: string;
  fields: FieldDef[];
};

export type LayoutConfig = {
  version: number;
  group: GroupKey;
  sections: SectionDef[];
};

const LS_KEY = "nw_layout_config_v1";

export const DEFAULT_LAYOUTS: Record<GroupKey, LayoutConfig> = {
  mini: {
    version: 1,
    group: "mini",
    sections: [
      {
        title: "Basis",
        fields: [
          { key: "visual", label: "Sichtprüfung OK?", type: "yn", required: true, requiresCommentWhenNo: true },
          { key: "shake", label: "Schütteltest erfolgt?", type: "yn", required: true },
        ],
      },
      {
        title: "BIOS / OS",
        fields: [
          { key: "biosFlashed", label: "NEXTWAVE BIOS geflasht?", type: "yn", required: true },
          { key: "biosDate", label: "Datum im BIOS geändert?", type: "yn", required: true },
          { key: "osInstalled", label: "Ist ein OS installiert?", type: "yn", required: true },
          // SSD nur sichtbar, wenn osInstalled = no
          { key: "ssdDetected", label: "SSD/NVMe erkannt (ohne OS)?", type: "yn", showWhen: { key: "osInstalled", eqYn: "no" } },
        ],
      },
      {
        title: "OS Checks",
        fields: [
          // Diese Checks nur sichtbar, wenn osInstalled = yes
          { key: "driversOk", label: "Alle Treiber erfolgreich installiert?", type: "boolean", showWhen: { key: "osInstalled", eqYn: "yes" } },
          { key: "updatesDone", label: "Alle Windows Updates abgeschlossen?", type: "boolean", showWhen: { key: "osInstalled", eqYn: "yes" } },
          { key: "powerPlanSet", label: "Energiesparplan (5h/5h) eingestellt?", type: "boolean", showWhen: { key: "osInstalled", eqYn: "yes" } },
          { key: "windowsActivated", label: "Windows aktiviert?", type: "boolean", showWhen: { key: "osInstalled", eqYn: "yes" } },
        ],
      },
    ],
  },

  rugged: {
    version: 1,
    group: "rugged",
    sections: [
      {
        title: "Basis",
        fields: [
          { key: "visual", label: "Sichtprüfung OK?", type: "yn", required: true, requiresCommentWhenNo: true },
          { key: "shake", label: "Schütteltest erfolgt?", type: "yn", required: true },
        ],
      },
      {
        title: "BIOS / Core",
        fields: [
          { key: "nwBiosPresent", label: "NEXTWAVE BIOS vorhanden?", type: "yn", required: true },
          { key: "rtBiosDate", label: "Datum im BIOS geändert?", type: "yn", required: true },
        ],
      },
      {
        title: "Tablet Checks",
        fields: [
          { key: "rtWindowsActivated", label: "Windows aktiviert?", type: "boolean" },
          { key: "keyboardAlways", label: 'Bildschirmtastatur auf „Immer“?', type: "boolean" },
          { key: "fKeyWorks", label: "Funktioniert die „F“-Taste?", type: "boolean" },
          { key: "barcodeWorks", label: "Funktioniert der Barcodescanner?", type: "boolean" },
        ],
      },
      {
        title: "IoT",
        fields: [
          { key: "iotInstalled", label: "Windows IoT Enterprise installiert?", type: "yn" },
          // nur sichtbar, wenn iotInstalled = yes
          { key: "cameraAppInstalled", label: 'Windows App „Kamera“ installiert?', type: "boolean", showWhen: { key: "iotInstalled", eqYn: "yes" } },
          { key: "controlCenterInstalled", label: "Control Center installiert?", type: "boolean", showWhen: { key: "iotInstalled", eqYn: "yes" } },
        ],
      },
    ],
  },
};

export function loadLayouts(): Record<GroupKey, LayoutConfig> {
  if (typeof window === "undefined") return DEFAULT_LAYOUTS;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_LAYOUTS;

    const parsed = JSON.parse(raw) as Record<GroupKey, LayoutConfig>;
    if (!parsed?.mini?.sections || !parsed?.rugged?.sections) return DEFAULT_LAYOUTS;

    // defensive: fill missing properties
    return {
      mini: parsed.mini ?? DEFAULT_LAYOUTS.mini,
      rugged: parsed.rugged ?? DEFAULT_LAYOUTS.rugged,
    };
  } catch {
    return DEFAULT_LAYOUTS;
  }
}

export function saveLayouts(layouts: Record<GroupKey, LayoutConfig>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY, JSON.stringify(layouts));
}

export function resetLayouts() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LS_KEY);
}
