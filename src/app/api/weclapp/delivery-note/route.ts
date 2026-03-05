// src/app/api/weclapp/delivery-note/route.ts
import { NextRequest, NextResponse } from "next/server";

type Tried = { url: string; status: number; bodyPreview: string };

type WeclappShipmentList = { result?: any[] };
type WeclappShipment = any;

type DeviceType = "mini" | "rugged";

type DeviceItem = {
  articleId: string;
  title: string;
  categoryId?: string;
  categoryName?: string;
  serials: string[];
};

function previewBody(txt: string, max = 450) {
  const s = (txt || "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/**
 * Normalisiert WECLAPP_BASE_URL robust:
 * - erlaubt: https://xxx.weclapp.com
 * - erlaubt: https://xxx.weclapp.com/webapp/api/v1
 * - erlaubt: https://xxx.weclapp.com/webapp/api/v2
 * -> Ergebnis immer: https://xxx.weclapp.com/webapp/api/v1
 */
function normalizeWeclappBase(rawBase: string) {
  let base = (rawBase || "").trim();
  if (!base) return "";

  // remove trailing slashes
  base = base.replace(/\/+$/, "");

  // if it already contains /webapp/api/vX..., strip it back to domain root
  base = base.replace(/\/webapp\/api\/v\d+.*$/i, "");

  // final base
  return `${base}/webapp/api/v1`;
}

async function weclappFetchJson(url: string, token: string, tried: Tried[]) {
  const r = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      // Weclapp expects this header name
      AuthenticationToken: token,
    },
    cache: "no-store",
  });

  const txt = await r.text();
  tried.push({ url, status: r.status, bodyPreview: previewBody(txt) });

  let json: any = null;
  try {
    json = txt ? JSON.parse(txt) : null;
  } catch {
    json = null;
  }

  return { ok: r.ok, status: r.status, json, text: txt };
}

function normalizeSn(v: string) {
  return (v || "").trim().replace(/\s+/g, "").toUpperCase();
}

function pickSerialsFromShipmentItem(it: any): string[] {
  const picks = Array.isArray(it?.picks) ? it.picks : [];
  const out: string[] = [];
  for (const p of picks) {
    const sns = Array.isArray(p?.serialNumbers) ? p.serialNumbers : [];
    for (const sn of sns) {
      const n = normalizeSn(String(sn || ""));
      if (n) out.push(n);
    }
  }
  return Array.from(new Set(out));
}

function guessDeviceTypeFromCategoryNames(deviceItems: DeviceItem[]): DeviceType {
  const hasRugged = deviceItems.some((x) => (x.categoryName || "").trim().toLowerCase() === "rugged tablet");
  return hasRugged ? "rugged" : "mini";
}

export async function GET(req: NextRequest) {
  const rawBase = process.env.WECLAPP_BASE_URL || "";
  const token = process.env.WECLAPP_API_TOKEN || "";

  if (!rawBase || !token) {
    return NextResponse.json(
      {
        ok: false,
        error: "Server-Konfiguration fehlt: WECLAPP_BASE_URL oder WECLAPP_API_TOKEN ist leer.",
        debug: { rawBase },
      },
      { status: 500 }
    );
  }

  const apiBase = normalizeWeclappBase(rawBase);
  if (!apiBase) {
    return NextResponse.json(
      { ok: false, error: "WECLAPP_BASE_URL konnte nicht normalisiert werden.", debug: { rawBase } },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const input = (searchParams.get("number") || "").trim();

  if (!input) {
    return NextResponse.json({ ok: false, error: "Parameter 'number' fehlt." }, { status: 400 });
  }

  const tried: Tried[] = [];

  // caches (avoid repeated calls)
  const articleCache = new Map<string, any>();
  const categoryCache = new Map<string, { id: string; name: string }>();

  const getArticle = async (articleId: string) => {
    if (!articleId) return null;
    if (articleCache.has(articleId)) return articleCache.get(articleId);

    const url = `${apiBase}/article/id/${encodeURIComponent(articleId)}`;
    const ar = await weclappFetchJson(url, token, tried);

    const art = ar.ok ? ar.json : null;
    articleCache.set(articleId, art);
    return art;
  };

  const getCategoryName = async (categoryId: string) => {
    if (!categoryId) return null;
    if (categoryCache.has(categoryId)) return categoryCache.get(categoryId)!.name;

    const url = `${apiBase}/articleCategory/id/${encodeURIComponent(categoryId)}`;
    const cr = await weclappFetchJson(url, token, tried);

    const name = cr.ok ? String(cr.json?.name || "") : "";
    categoryCache.set(categoryId, { id: categoryId, name });
    return name || null;
  };

  // 1) First try: shipmentNumber-eq=INPUT (correct filtering)
  const listUrl = `${apiBase}/shipment?shipmentNumber-eq=${encodeURIComponent(input)}`;
  const listRes = await weclappFetchJson(listUrl, token, tried);

  let shipment: WeclappShipment | null = null;

  if (listRes.ok) {
    const list = listRes.json as WeclappShipmentList;
    const arr = Array.isArray(list?.result) ? list.result : [];
    if (arr.length === 1) {
      shipment = arr[0];
    } else if (arr.length > 1) {
      // if multiple, pick exact match defensively
      const exact = arr.find((x) => String(x?.shipmentNumber || "") === input);
      shipment = exact || arr[0] || null;
    }
  }

  // 2) Fallback: if not found, try interpreting input as internal shipment ID
  // (works when someone pastes 130399 etc.)
  if (!shipment) {
    const idUrl = `${apiBase}/shipment/id/${encodeURIComponent(input)}`;
    const idRes = await weclappFetchJson(idUrl, token, tried);
    if (idRes.ok && idRes.json?.id) shipment = idRes.json;
  }

  if (!shipment) {
    return NextResponse.json(
      {
        ok: false,
        error: "Kein Beleg mit exakt dieser Belegnummer gefunden.",
        debug: { tried, normalizedBase: apiBase, rawBase },
      },
      { status: 404 }
    );
  }

  // Build response
  const shipmentNumber = String(shipment?.shipmentNumber || "").trim() || input;
  const salesOrderNumber = String(shipment?.salesOrderNumber || "").trim();
  const customerName =
    String(shipment?.recipientAddress?.company || shipment?.invoiceAddress?.company || "").trim() || "—";

  const shipmentItems = Array.isArray(shipment?.shipmentItems) ? shipment.shipmentItems : [];

  // productNames + serialsByProduct from ALL items (for display only)
  const productNames: string[] = [];
  const serialsByProduct: Record<string, string[]> = {};
  const allSerials: string[] = [];

  for (const it of shipmentItems) {
    const title = String(it?.title || "").trim();
    if (title) productNames.push(title);

    const sns = pickSerialsFromShipmentItem(it);
    if (title) serialsByProduct[title] = sns;
    for (const sn of sns) allSerials.push(sn);
  }

  const uniqueProductNames = Array.from(new Set(productNames));
  const uniqueAllSerials = Array.from(new Set(allSerials));

  // Determine DEVICE items (only Barebone Mini-PC / Rugged Tablet)
  // We map each shipmentItem -> article -> category -> categoryName
  const deviceItems: DeviceItem[] = [];

  for (const it of shipmentItems) {
    const articleId = String(it?.articleId || "").trim();
    const title = String(it?.title || "").trim();
    if (!articleId) continue;

    const art = await getArticle(articleId);
    const categoryId = String(art?.articleCategoryId || art?.categoryId || "").trim();
    const categoryName = categoryId ? await getCategoryName(categoryId) : null;

    const cat = (categoryName || "").trim();

    const isDevice =
      cat === "Barebone Mini-PC" ||
      cat === "Rugged Tablet";

    if (!isDevice) continue;

    const sns = pickSerialsFromShipmentItem(it);

    deviceItems.push({
      articleId,
      title: title || (art?.name ? String(art.name) : "—"),
      categoryId: categoryId || undefined,
      categoryName: cat || undefined,
      serials: sns,
    });
  }

  // Device serials = only from deviceItems (this is what Fertigung uses)
  const deviceSerials = Array.from(new Set(deviceItems.flatMap((x) => x.serials))).filter(Boolean);

  const deviceType = guessDeviceTypeFromCategoryNames(deviceItems);

  return NextResponse.json({
    ok: true,
    entity: "shipment",
    input,
    documentNumber: shipmentNumber,
    salesOrderNumber,
    customerName,
    productNames: uniqueProductNames,
    serials: uniqueAllSerials,
    serialsByProduct,
    deviceItems,
    deviceSerials,
    deviceType,
    raw: shipment,
    debug: {
      tried,
      normalizedBase: apiBase,
      rawBase,
      used: shipment?.id ? { shipmentId: String(shipment.id), shipmentNumber } : { shipmentNumber },
    },
  });
}
