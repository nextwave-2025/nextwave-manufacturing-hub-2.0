import { NextResponse } from "next/server";

const WECLAPP_BASE_URL = process.env.WECLAPP_BASE_URL;
const WECLAPP_API_TOKEN = process.env.WECLAPP_API_TOKEN;

function jsonError(msg: string, status = 500, extra?: any) {
  return NextResponse.json({ ok: false, error: msg, ...extra }, { status });
}

function buildApiBase(base: string) {
  const u = new URL(base);
  return `${u.origin}/webapp/api/v1`;
}

async function weclappGet(url: string) {
  const r = await fetch(url, {
    method: "GET",
    headers: {
      AuthenticationToken: WECLAPP_API_TOKEN || "",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await r.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return { ok: r.ok, status: r.status, text, json };
}

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function uniqStrings(arr: unknown[]): string[] {
  return uniq(
    (arr || [])
      .map((x) => String(x ?? "").trim())
      .filter((s) => s.length > 0),
  );
}

type DeviceType = "mini" | "rugged";
type SerialMap = Record<string, string[]>;

const ALLOWED_DEVICE_GROUPS = ["Barebone Mini-PC", "Rugged Tablet"] as const;
type AllowedGroupName = (typeof ALLOWED_DEVICE_GROUPS)[number];

function isAllowedGroupName(v: any): v is AllowedGroupName {
  return typeof v === "string" && (ALLOWED_DEVICE_GROUPS as readonly string[]).includes(v);
}

function deviceTypeFromGroupName(groupName: string | undefined | null): DeviceType | null {
  if (!groupName) return null;
  if (groupName === "Rugged Tablet") return "rugged";
  if (groupName === "Barebone Mini-PC") return "mini";
  return null;
}

export async function GET(req: Request) {
  if (!WECLAPP_BASE_URL || !WECLAPP_API_TOKEN) {
    return jsonError("Weclapp API nicht konfiguriert (WECLAPP_BASE_URL oder WECLAPP_API_TOKEN fehlt).", 500);
  }

  const { searchParams } = new URL(req.url);

  /**
   * ✅ WICHTIG:
   * Wir akzeptieren hier bewusst NUR die Belegnummer (z.B. shipmentNumber / deliveryNoteNumber).
   * Keine ID-Fallbacks mehr, damit NICHT "irgendein" Datensatz gematcht wird.
   */
  const documentNumber = (searchParams.get("number") || "").trim();
  if (!documentNumber) return jsonError("Query-Parameter 'number' fehlt.", 400);

  const apiBase = buildApiBase(WECLAPP_BASE_URL);

  const tried: any[] = [];

  // ✅ Nur exakte Belegnummern-Search (kein /id/ Fallback!)
  const tryUrls = [
    `${apiBase}/shipment?shipmentNumber=${encodeURIComponent(documentNumber)}`,
    `${apiBase}/deliveryNote?deliveryNoteNumber=${encodeURIComponent(documentNumber)}`,
  ];

  for (const url of tryUrls) {
    const r = await weclappGet(url);
    tried.push({ url, status: r.status, bodyPreview: (r.text || "").slice(0, 200) });

    if (!r.ok) continue;

    const obj = Array.isArray(r.json?.result) ? r.json.result[0] : r.json;
    if (!obj) continue;

    const entity = url.includes("/shipment") ? "shipment" : "deliveryNote";

    // ✅ Items normalisieren
    const items: any[] = obj?.shipmentItems || obj?.deliveryNoteItems || obj?.items || [];

    // ✅ customerName robust
    const customerName =
      obj?.customerName ||
      obj?.customer?.name ||
      obj?.recipientAddress?.company ||
      obj?.invoiceAddress?.company ||
      "";

    // ✅ Belegnummer + Auftragsnummer (wenn vorhanden)
    const resolvedDocumentNumber =
      obj?.shipmentNumber || obj?.deliveryNoteNumber || obj?.documentNumber || documentNumber;

    const salesOrderNumber =
      obj?.salesOrderNumber ||
      obj?.salesOrder?.salesOrderNumber ||
      obj?.salesOrders?.[0]?.salesOrderNumber ||
      obj?.salesOrderId ||
      obj?.salesOrders?.[0]?.id ||
      "";

    // ✅ product names (alle Positionen)
    const productNames: string[] = uniq(
      (items || [])
        .map((it: any) => String((it?.title || it?.articleName || "") ?? "").trim())
        .filter((s: string) => s.length > 0),
    );

    // ✅ serialsByProduct: strikt typisiert, damit kein TS-unknown[] Fehler mehr entsteht
    const serialsByProduct: SerialMap = {};

    for (const it of items || []) {
      const title = String((it?.title || it?.articleName || "") ?? "").trim();
      if (!title) continue;

      const serials = uniqStrings(
        (it?.picks || []).flatMap((p: any) => (p?.serialNumbers || []) as unknown[]),
      );

      if (serials.length) serialsByProduct[title] = serials; // ✅ string[] passt
    }

    // ✅ Gesamt-Serials (alle Positionen)
    const serials: string[] = uniqStrings(Object.values(serialsByProduct).flat());

    /**
     * ✅ Device-Items (relevante Geräte) über Warengruppe (= articleCategory) ermitteln.
     * Wir fragen dafür pro Artikel die Kategorie ab und filtern NUR:
     * - Barebone Mini-PC
     * - Rugged Tablet
     */
    const deviceItems: Array<{
      articleId: string;
      title: string;
      categoryId: string;
      categoryName: string;
      serials: string[];
    }> = [];

    // Artikelinfos cachen (damit nicht doppelt angefragt wird)
    const articleCache = new Map<string, any>();

    for (const it of items || []) {
      const articleId = String(it?.articleId ?? "").trim();
      const title = String((it?.title || it?.articleName || "") ?? "").trim();
      if (!articleId || !title) continue;

      const itemSerials = serialsByProduct[title] || [];

      // Artikel laden (für category)
      let art = articleCache.get(articleId);
      if (!art) {
        const ar = await weclappGet(`${apiBase}/article/id/${encodeURIComponent(articleId)}`);
        art = ar.ok ? ar.json : null;
        articleCache.set(articleId, art);
      }

      const categoryId = String(art?.articleCategoryId ?? "").trim();
      const categoryName = String(art?.articleCategoryName ?? "").trim();

      deviceItems.push({
        articleId,
        title,
        categoryId,
        categoryName,
        serials: itemSerials,
      });
    }

    // ✅ Nur relevante Geräte-Warengruppen
    const relevantDeviceItems = deviceItems.filter((x) => isAllowedGroupName(x.categoryName));

    // ✅ deviceType ausschließlich aus Warengruppe bestimmen (keine Namens-Heuristik)
    const detectedGroup = relevantDeviceItems[0]?.categoryName || "";
    const deviceType: DeviceType =
      deviceTypeFromGroupName(detectedGroup) || "mini";

    // ✅ deviceSerials = nur Seriennummern der relevanten Geräte (Barebone Mini-PC oder Rugged Tablet)
    const deviceSerials: string[] = uniqStrings(
      relevantDeviceItems.flatMap((x) => x.serials as unknown[]),
    );

    // ✅ Wenn aus irgendeinem Grund keine deviceSerials gefunden wurden, fallback auf "alle Serials"
    const finalDeviceSerials = deviceSerials.length ? deviceSerials : serials;

    return NextResponse.json({
      ok: true,
      entity,
      input: documentNumber,

      // ✅ eindeutig (Belegnummer = Basis!)
      documentNumber: resolvedDocumentNumber,
      salesOrderNumber,

      customerName,

      // alle Positionen (für Debug/optional Anzeige)
      productNames,
      serials,
      serialsByProduct,

      // relevante Geräte (Warengruppe)
      deviceItems: relevantDeviceItems,
      deviceSerials: finalDeviceSerials,
      deviceType,

      raw: obj,
    });
  }

  return jsonError("Weclapp Request fehlgeschlagen (siehe debug).", 502, { debug: { apiBase, tried } });
}
