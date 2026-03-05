import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type WeclappJson = any;

type DeviceType = "mini" | "rugged";

type DeviceItem = {
  articleId: string;
  title: string;
  categoryId?: string;
  categoryName?: string;
  serials: string[];
};

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function normalizeSn(v: string) {
  return (v || "").trim().replace(/\s+/g, "").toUpperCase();
}

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function weclappGet(url: string, apiToken: string) {
  const r = await fetch(url, {
    method: "GET",
    headers: {
      AuthenticationToken: apiToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  let json: WeclappJson = null;
  let text = "";
  try {
    text = await r.text();
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    ok: r.ok,
    status: r.status,
    json,
    bodyPreview: (text || "").slice(0, 220),
    url,
  };
}

function isRelevantCategoryName(name?: string) {
  const n = (name || "").trim();
  return n === "Barebone Mini-PC" || n === "Rugged Tablet";
}

function inferDeviceTypeFromItems(items: DeviceItem[]): DeviceType {
  const hasRugged = items.some((x) => (x.categoryName || "").trim() === "Rugged Tablet");
  return hasRugged ? "rugged" : "mini";
}

/**
 * WICHTIG:
 * - Sucht EXAKT nach shipmentNumber = input
 * - Liefert deviceItems NUR für Warengruppen:
 *   "Barebone Mini-PC" und "Rugged Tablet"
 * - deviceSerials = alle Serialnummern aus diesen deviceItems
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const inputRaw = (searchParams.get("number") || "").trim();

  if (!inputRaw) {
    return NextResponse.json({ ok: false, error: "Bitte 'number' (Belegnummer) angeben." }, { status: 400 });
  }

  // Wir akzeptieren hier NUR die Belegnummer (shipmentNumber) als String
  const input = inputRaw;

  const apiBase = getEnv("WECLAPP_API_BASE").replace(/\/+$/, "");
  const apiToken = getEnv("WECLAPP_API_TOKEN");

  // Caches (optional, falls du später Category über Article laden willst)
  const articleCache = new Map<string, any>();
  const categoryCache = new Map<string, { id: string; name: string }>();

  // FIX für ES5 strict: keine function declaration im Block -> const arrow
  const getArticle = async (articleId: string) => {
    if (articleCache.has(articleId)) return articleCache.get(articleId);
    const ar = await weclappGet(`${apiBase}/article/id/${encodeURIComponent(articleId)}`, apiToken);
    const art = ar.ok ? ar.json : null;
    articleCache.set(articleId, art);
    return art;
  };

  const getCategory = async (categoryId: string) => {
    if (!categoryId) return null;
    if (categoryCache.has(categoryId)) return categoryCache.get(categoryId);
    const cr = await weclappGet(`${apiBase}/articleCategory/id/${encodeURIComponent(categoryId)}`, apiToken);
    const cat = cr.ok ? cr.json : null;
    const out = cat ? { id: String(cat.id ?? categoryId), name: String(cat.name ?? "") } : null;
    if (out) categoryCache.set(categoryId, out);
    return out;
  };

  const tried: any[] = [];

  // 1) EXAKTE Suche nach shipmentNumber
  const shipmentUrl = `${apiBase}/shipment?shipmentNumber=${encodeURIComponent(input)}`;
  const shipmentRes = await weclappGet(shipmentUrl, apiToken);
  tried.push({ url: shipmentRes.url, status: shipmentRes.status, bodyPreview: shipmentRes.bodyPreview });

  if (!shipmentRes.ok) {
    return NextResponse.json(
      { ok: false, error: `Weclapp-Request fehlgeschlagen (HTTP ${shipmentRes.status}).`, debug: { apiBase, tried } },
      { status: 502 },
    );
  }

  const resultArr = Array.isArray(shipmentRes.json?.result) ? shipmentRes.json.result : [];
  const exact = resultArr.find((x: any) => String(x?.shipmentNumber ?? "") === String(input));

  if (!exact) {
    return NextResponse.json(
      { ok: false, error: "Kein Beleg mit exakt dieser Belegnummer gefunden.", debug: { apiBase, tried } },
      { status: 404 },
    );
  }

  const shipment = exact;

  // Extract core fields
  const documentNumber = String(shipment.shipmentNumber ?? shipment.documentNumber ?? input);
  const salesOrderNumber = String(shipment.salesOrderNumber ?? "");

  const customerName =
    String(shipment?.recipientAddress?.company ?? "") ||
    String(shipment?.invoiceAddress?.company ?? "") ||
    String(shipment?.customerName ?? "");

  const shipmentItems = Array.isArray(shipment.shipmentItems) ? shipment.shipmentItems : [];

  // Build items with serials from picks
  const itemsRaw: DeviceItem[] = shipmentItems.map((it: any) => {
    const articleId = String(it?.articleId ?? "");
    const title = String(it?.title ?? "");
    const serials = uniq(
      (Array.isArray(it?.picks) ? it.picks : [])
        .flatMap((p: any) => (Array.isArray(p?.serialNumbers) ? p.serialNumbers : []))
        .map((s: any) => normalizeSn(String(s ?? "")))
        .filter(Boolean),
    );

    // categoryName/Id kann bei shipmentItems fehlen -> später via article nachladen
    const categoryId = String(it?.articleCategoryId ?? it?.categoryId ?? "");
    const categoryName = String(it?.articleCategoryName ?? it?.categoryName ?? "");

    return { articleId, title, categoryId, categoryName, serials };
  });

  // Enrich missing categories via article->articleCategoryId->articleCategory (nur wenn nötig)
  const enriched: DeviceItem[] = [];
  for (const it of itemsRaw) {
    let categoryId = (it.categoryId || "").trim();
    let categoryName = (it.categoryName || "").trim();

    if (!categoryName) {
      const art = it.articleId ? await getArticle(it.articleId) : null;
      const artCatId = String(art?.articleCategoryId ?? art?.categoryId ?? "").trim();
      if (!categoryId && artCatId) categoryId = artCatId;

      if (categoryId) {
        const cat = await getCategory(categoryId);
        if (cat?.name) categoryName = cat.name;
      }
    }

    enriched.push({
      ...it,
      categoryId: categoryId || it.categoryId || "",
      categoryName: categoryName || it.categoryName || "",
    });
  }

  // Only keep relevant device categories
  const deviceItems = enriched
    .filter((x) => isRelevantCategoryName(x.categoryName))
    .filter((x) => x.serials && x.serials.length > 0);

  const deviceSerials = uniq(deviceItems.flatMap((x) => x.serials));

  const deviceType = inferDeviceTypeFromItems(deviceItems);

  // Cosmetic: productNames (optional) – liefern wir weiterhin alle Titel aus shipmentItems (kannst du im UI filtern)
  const productNames = uniq(enriched.map((x) => x.title).filter(Boolean));

  return NextResponse.json({
    ok: true,
    entity: "shipment",
    input,
    documentNumber,
    salesOrderNumber,
    customerName,
    productNames,

    deviceItems,
    deviceSerials,
    deviceType,

    raw: shipment,
  });
}
