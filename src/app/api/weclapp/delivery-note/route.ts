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

/**
 * ✅ Weclapp-Listen können "unscharf" matchen.
 * Daher: Ergebnisliste IMMER auf exakte Nummer filtern.
 */
function pickExactByNumber(entity: "shipment" | "deliveryNote", inputNumber: string, result: any[]): any | null {
  const key = entity === "shipment" ? "shipmentNumber" : "deliveryNoteNumber";
  const exact = (result || []).find((x) => String(x?.[key] ?? "").trim() === inputNumber);
  return exact || null;
}

export async function GET(req: Request) {
  if (!WECLAPP_BASE_URL || !WECLAPP_API_TOKEN) {
    return jsonError("Weclapp API nicht konfiguriert (WECLAPP_BASE_URL oder WECLAPP_API_TOKEN fehlt).", 500);
  }

  const { searchParams } = new URL(req.url);
  const documentNumber = (searchParams.get("number") || "").trim();
  if (!documentNumber) return jsonError("Query-Parameter 'number' fehlt.", 400);

  const apiBase = buildApiBase(WECLAPP_BASE_URL);

  const tried: any[] = [];
  const tryUrls = [
    { entity: "shipment" as const, url: `${apiBase}/shipment?shipmentNumber=${encodeURIComponent(documentNumber)}` },
    { entity: "deliveryNote" as const, url: `${apiBase}/deliveryNote?deliveryNoteNumber=${encodeURIComponent(documentNumber)}` },
  ];

  for (const t of tryUrls) {
    const r = await weclappGet(t.url);
    tried.push({ url: t.url, status: r.status, bodyPreview: (r.text || "").slice(0, 200) });

    if (!r.ok) continue;

    // ✅ Ergebnis normalisieren und EXAKT matchen
    const list = Array.isArray(r.json?.result) ? r.json.result : Array.isArray(r.json) ? r.json : [];
    const obj = pickExactByNumber(t.entity, documentNumber, list);
    if (!obj) continue;

    const items: any[] = obj?.shipmentItems || obj?.deliveryNoteItems || obj?.items || [];

    const customerName =
      obj?.customerName ||
      obj?.customer?.name ||
      obj?.recipientAddress?.company ||
      obj?.invoiceAddress?.company ||
      "";

    const resolvedDocumentNumber =
      (t.entity === "shipment" ? obj?.shipmentNumber : obj?.deliveryNoteNumber) || documentNumber;

    const salesOrderNumber =
      obj?.salesOrderNumber ||
      obj?.salesOrder?.salesOrderNumber ||
      obj?.salesOrders?.[0]?.salesOrderNumber ||
      obj?.salesOrderId ||
      obj?.salesOrders?.[0]?.id ||
      "";

    const productNames: string[] = uniq(
      (items || [])
        .map((it: any) => String((it?.title || it?.articleName || "") ?? "").trim())
        .filter((s: string) => s.length > 0),
    );

    const serialsByProduct: SerialMap = {};
    for (const it of items || []) {
      const title = String((it?.title || it?.articleName || "") ?? "").trim();
      if (!title) continue;

      const serials = uniqStrings(
        (it?.picks || []).flatMap((p: any) => (p?.serialNumbers || []) as unknown[]),
      );

      if (serials.length) serialsByProduct[title] = serials;
    }

    const serials: string[] = uniqStrings(Object.values(serialsByProduct).flat());

    // ✅ Artikel + Kategorie sicher auflösen (article -> articleCategoryId -> articleCategoryName)
    const articleCache = new Map<string, any>();
    const categoryCache = new Map<string, { id: string; name: string }>();

    async function getArticle(articleId: string) {
      if (articleCache.has(articleId)) return articleCache.get(articleId);
      const ar = await weclappGet(`${apiBase}/article/id/${encodeURIComponent(articleId)}`);
      const art = ar.ok ? ar.json : null;
      articleCache.set(articleId, art);
      return art;
    }

    async function getCategoryName(categoryId: string): Promise<string> {
      const cid = String(categoryId ?? "").trim();
      if (!cid) return "";
      if (categoryCache.has(cid)) return categoryCache.get(cid)!.name;

      const cr = await weclappGet(`${apiBase}/articleCategory/id/${encodeURIComponent(cid)}`);
      const name = cr.ok ? String(cr.json?.name ?? cr.json?.articleCategoryName ?? "").trim() : "";
      categoryCache.set(cid, { id: cid, name });
      return name;
    }

    const deviceItemsAll: Array<{
      articleId: string;
      title: string;
      categoryId: string;
      categoryName: string;
      serials: string[];
    }> = [];

    for (const it of items || []) {
      const articleId = String(it?.articleId ?? "").trim();
      const title = String((it?.title || it?.articleName || "") ?? "").trim();
      if (!articleId || !title) continue;

      const itemSerials = serialsByProduct[title] || [];

      const art = await getArticle(articleId);

      const categoryId = String(art?.articleCategoryId ?? it?.articleCategoryId ?? "").trim();
      let categoryName = String(art?.articleCategoryName ?? it?.articleCategoryName ?? "").trim();

      if (!categoryName && categoryId) {
        categoryName = await getCategoryName(categoryId);
      }

      deviceItemsAll.push({
        articleId,
        title,
        categoryId,
        categoryName,
        serials: itemSerials,
      });
    }

    const deviceItems = deviceItemsAll.filter((x) => isAllowedGroupName(x.categoryName));

    const detectedGroup = deviceItems[0]?.categoryName || "";
    const deviceType: DeviceType = deviceTypeFromGroupName(detectedGroup) || "mini";

    const deviceSerials = uniqStrings(deviceItems.flatMap((x) => x.serials as unknown[]));

    // ✅ Ganz wichtig: wenn wir keine relevanten Geräte finden -> NICHT alles nehmen, sondern Fehler anzeigen
    if (!deviceItems.length || !deviceSerials.length) {
      return jsonError(
        "Keine relevanten Geräte (Warengruppe Barebone Mini-PC / Rugged Tablet) im Beleg gefunden.",
        422,
        {
          entity: t.entity,
          input: documentNumber,
          documentNumber: resolvedDocumentNumber,
          customerName,
          debug: {
            hint: "Prüfe, ob die Artikel im Lieferschein eine Warengruppe (Artikelkategorie) haben und ob sie exakt 'Barebone Mini-PC' oder 'Rugged Tablet' heißt.",
            deviceItemsAllPreview: deviceItemsAll.slice(0, 10),
          },
        },
      );
    }

    return NextResponse.json({
      ok: true,
      entity: t.entity,
      input: documentNumber,
      documentNumber: resolvedDocumentNumber,
      salesOrderNumber,
      customerName,

      // optional (kann UI verstecken)
      productNames,
      serials,
      serialsByProduct,

      // ✅ das ist das Wichtige für SaaS
      deviceItems,
      deviceSerials,
      deviceType,

      raw: obj,
    });
  }

  return jsonError("Kein Beleg mit exakt dieser Belegnummer gefunden.", 404, { debug: { apiBase, tried } });
}
