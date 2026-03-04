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

function uniq<T>(arr: readonly T[]): T[] {
  return Array.from(new Set(arr));
}

function inferDeviceType(productTitles: string[]) {
  const s = productTitles.join(" ").toUpperCase();
  if (s.includes("WAVETAB") || s.includes("RUGGED") || s.includes("TABLET")) return "rugged";
  return "mini";
}

// ✅ aus Weclapp Article-Objekt robust die Warengruppe/Artikelkategorie ziehen
function getCategoryNameFromArticle(article: any): string {
  return String(
    article?.articleCategoryName ||
      article?.articleCategory?.name ||
      article?.articleCategory ||
      "",
  ).trim();
}

export async function GET(req: Request) {
  if (!WECLAPP_BASE_URL || !WECLAPP_API_TOKEN) {
    return jsonError(
      "Weclapp API nicht konfiguriert (WECLAPP_BASE_URL oder WECLAPP_API_TOKEN fehlt).",
      500,
    );
  }

  const { searchParams } = new URL(req.url);
  const numberOrId = (searchParams.get("number") || "").trim();
  if (!numberOrId) return jsonError("Query-Parameter 'number' fehlt.", 400);

  const apiBase = buildApiBase(WECLAPP_BASE_URL);

  const tried: any[] = [];
  const tryUrls = [
    // shipment
    `${apiBase}/shipment?shipmentNumber=${encodeURIComponent(numberOrId)}`,
    `${apiBase}/shipment/id/${encodeURIComponent(numberOrId)}`,

    // deliveryNote
    `${apiBase}/deliveryNote?deliveryNoteNumber=${encodeURIComponent(numberOrId)}`,
    `${apiBase}/deliveryNote/id/${encodeURIComponent(numberOrId)}`,
  ];

  // ✅ NUR diese beiden Warengruppen zählen als Fertigungs-Devices
  const ALLOWED_GROUPS = new Set<string>(["Barebone Mini-PC", "Rugged Tablet"]);

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
    const customerName: string =
      obj?.customerName ||
      obj?.customer?.name ||
      obj?.recipientAddress?.company ||
      obj?.invoiceAddress?.company ||
      "";

    // ✅ product names
    const productNames: string[] = uniq(
      items
        .map((it: any) => String(it?.title || it?.articleName || "").trim())
        .filter((v: string) => Boolean(v)),
    );

    // ✅ serials grouped by product title (Positionen)
    const serialsByProduct: Record<string, string[]> = {};

    for (const it of items) {
      const title = String(it?.title || it?.articleName || "").trim();
      if (!title) continue;

      const picks = Array.isArray(it?.picks) ? it.picks : [];

      // ✅ HIER ist der entscheidende Fix:
      // wir erzeugen explizit string[] und geben uniq<string> damit es NICHT unknown[] wird
      const serials: string[] = uniq<string>(
        picks
          .flatMap((p: any) => (Array.isArray(p?.serialNumbers) ? p.serialNumbers : []))
          .map((x: any) => String(x || "").trim())
          .filter((v: string) => Boolean(v)),
      );

      if (serials.length > 0) serialsByProduct[title] = serials;
    }

    const serials: string[] = uniq<string>(Object.values(serialsByProduct).flat());

    // ✅ Warengruppe je articleId nachladen
    const articleIds: string[] = uniq(
      items
        .map((it: any) => String(it?.articleId || "").trim())
        .filter((v: string) => Boolean(v)),
    );

    const articleCategoryById = new Map<string, string>();

    await Promise.all(
      articleIds.map(async (id) => {
        const ar = await weclappGet(`${apiBase}/article/id/${encodeURIComponent(id)}`);
        if (!ar.ok) return;
        const catName = getCategoryNameFromArticle(ar.json);
        if (catName) articleCategoryById.set(id, catName);
      }),
    );

    // ✅ deviceItems inkl. Warengruppe
    const deviceItems: Array<{
      articleId: string;
      title: string;
      categoryName: string;
      serials: string[];
    }> = items
      .map((it: any) => {
        const articleId = String(it?.articleId || "").trim();
        const title = String(it?.title || it?.articleName || "").trim();
        const categoryName = articleId ? articleCategoryById.get(articleId) || "" : "";

        const picks = Array.isArray(it?.picks) ? it.picks : [];
        const itemSerials: string[] = uniq<string>(
          picks
            .flatMap((p: any) => (Array.isArray(p?.serialNumbers) ? p.serialNumbers : []))
            .map((x: any) => String(x || "").trim())
            .filter((v: string) => Boolean(v)),
        );

        return { articleId, title, categoryName, serials: itemSerials };
      })
      .filter((x) => Boolean(x.title) && x.serials.length > 0);

    // ✅ nur S/N aus den 2 Warengruppen
    const deviceSerials: string[] = uniq<string>(
      deviceItems
        .filter((x) => ALLOWED_GROUPS.has(x.categoryName))
        .flatMap((x) => x.serials),
    );

    const deviceType = inferDeviceType(productNames);

    const documentNumber: string =
      obj?.shipmentNumber || obj?.deliveryNoteNumber || obj?.number || "";

    const salesOrderNumber: string = obj?.salesOrderNumber || "";

    return NextResponse.json({
      ok: true,
      entity,
      input: numberOrId,

      documentNumber,
      salesOrderNumber,

      customerName,
      productNames,

      serials,
      serialsByProduct,

      // ✅ neu: Positionen inkl. Warengruppe
      deviceItems,

      // ✅ nur relevante Seriennummern für Fertigung
      deviceSerials,

      deviceType,

      raw: obj,
    });
  }

  return jsonError("Weclapp Request fehlgeschlagen (siehe debug).", 502, {
    debug: { apiBase, tried },
  });
}
