import { NextResponse } from "next/server";

type WeclappDeviceItem = {
  articleId: string;
  title: string;
  categoryId?: string;
  categoryName?: string;
  serials: string[];
};

type ApiResponseOk = {
  ok: true;
  entity: "shipment";
  input: string;

  documentNumber: string; // shipmentNumber
  salesOrderNumber: string;

  customerName: string;
  productNames: string[]; // nur relevante Geräte (nicht RAM/SSD/CPU)

  deviceItems: WeclappDeviceItem[];
  deviceSerials: string[];

  deviceType: "mini" | "rugged";
  raw: any;
};

type ApiResponseErr = {
  ok: false;
  error: string;
  debug?: any;
};

function jsonOk(data: ApiResponseOk) {
  return NextResponse.json(data, { status: 200 });
}

function jsonErr(error: string, status = 400, debug?: any) {
  const body: ApiResponseErr = { ok: false, error };
  if (debug) body.debug = debug;
  return NextResponse.json(body, { status });
}

function normalizeApiBase(raw: string) {
  const base = String(raw || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  // ✅ Wenn schon /webapp/api/v1 drin ist: ok
  if (base.includes("/webapp/api/v1")) return base;
  // ✅ Sonst anhängen
  return `${base}/webapp/api/v1`;
}

function pickCustomerName(shipment: any): string {
  const r = shipment?.recipientAddress?.company;
  const i = shipment?.invoiceAddress?.company;
  return String(r || i || "").trim();
}

function toUpperTrim(s: any) {
  return String(s ?? "").trim().toUpperCase();
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function normalizeSerial(sn: string) {
  return String(sn || "").trim().replace(/\s+/g, "").toUpperCase();
}

const ALLOWED_DEVICE_CATEGORIES = new Set(["BAREBONE MINI-PC", "RUGGED TABLET"]);

async function weclappGet(url: string, token: string) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      AuthenticationToken: token,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  return {
    ok: res.ok,
    status: res.status,
    text,
    json,
  };
}

export async function GET(req: Request) {
  const rawBase = process.env.WECLAPP_BASE_URL || "";
  const apiBase = normalizeApiBase(rawBase);
  const token = (process.env.WECLAPP_API_TOKEN || "").trim();

  if (!apiBase || !token) {
    return jsonErr("Server-Konfiguration fehlt: WECLAPP_BASE_URL oder WECLAPP_API_TOKEN ist leer.", 500, {
      rawBase,
      normalizedBase: apiBase,
      hasToken: Boolean(token),
    });
  }

  const { searchParams } = new URL(req.url);
  const inputRaw = (searchParams.get("number") || "").trim();

  if (!inputRaw) {
    return jsonErr("Bitte eine Belegnummer (shipmentNumber) übergeben: ?number=31147", 400);
  }

  const input = inputRaw;
  const tried: any[] = [];

  // ✅ NUR shipment anhand shipmentNumber
  const shipmentUrl = `${apiBase}/shipment?shipmentNumber=${encodeURIComponent(input)}`;
  const shipRes = await weclappGet(shipmentUrl, token);

  tried.push({
    url: shipmentUrl,
    status: shipRes.status,
    bodyPreview: shipRes.text?.slice(0, 600),
  });

  if (!shipRes.ok) {
    return jsonErr(`Weclapp-Request fehlgeschlagen (shipment). HTTP ${shipRes.status}`, 502, {
      tried,
      normalizedBase: apiBase,
    });
  }

  const resultArr = Array.isArray(shipRes.json?.result) ? shipRes.json.result : [];

  // ✅ Wenn leer: Debug mitliefern (hier sieht man sofort ob falsche Base oder falsche Nummer)
  if (!resultArr.length) {
    return jsonErr("Kein Beleg mit exakt dieser Belegnummer gefunden.", 404, {
      tried,
      normalizedBase: apiBase,
      hint:
        "Wenn du diesen Fehler bei ALLEN Nummern bekommst, ist fast immer WECLAPP_BASE_URL falsch (ohne /webapp/api/v1) oder zeigt auf die falsche Weclapp-Instanz.",
    });
  }

  // Weclapp sollte hier exakt matchen, aber wir prüfen trotzdem:
  const exact = resultArr.find((x: any) => String(x?.shipmentNumber || "").trim() === input);

  if (!exact) {
    return jsonErr("Kein Beleg mit exakt dieser Belegnummer gefunden.", 404, {
      tried,
      normalizedBase: apiBase,
      foundShipmentNumbers: resultArr.map((x: any) => x?.shipmentNumber),
    });
  }

  const shipment = exact;

  const documentNumber = String(shipment?.shipmentNumber || "").trim();
  const salesOrderNumber = String(shipment?.salesOrderNumber || shipment?.packageReferenceNumber || "").trim();
  const customerName = pickCustomerName(shipment);

  // --- Artikel/Kategorien auflösen (Cache) ---
  const articleCache = new Map<string, any>();
  const categoryCache = new Map<string, { id: string; name: string }>();

  const getArticle = async (articleId: string) => {
    const id = String(articleId || "").trim();
    if (!id) return null;
    if (articleCache.has(id)) return articleCache.get(id);

    const url = `${apiBase}/article/id/${encodeURIComponent(id)}`;
    const ar = await weclappGet(url, token);
    tried.push({ url, status: ar.status, bodyPreview: ar.text?.slice(0, 250) });

    const art = ar.ok ? ar.json : null;
    articleCache.set(id, art);
    return art;
  };

  const getCategoryName = async (categoryId: string) => {
    const cid = String(categoryId || "").trim();
    if (!cid) return "";
    if (categoryCache.has(cid)) return categoryCache.get(cid)!.name;

    const url = `${apiBase}/articleCategory/id/${encodeURIComponent(cid)}`;
    const cr = await weclappGet(url, token);
    tried.push({ url, status: cr.status, bodyPreview: cr.text?.slice(0, 250) });

    const name = cr.ok ? String(cr.json?.name || "").trim() : "";
    categoryCache.set(cid, { id: cid, name });
    return name;
  };

  const shipmentItems = Array.isArray(shipment?.shipmentItems) ? shipment.shipmentItems : [];

  const deviceItems: WeclappDeviceItem[] = [];
  let hasMini = false;
  let hasRugged = false;

  for (const it of shipmentItems) {
    const articleId = String(it?.articleId || "").trim();
    const title = String(it?.title || "").trim();

    const picks = Array.isArray(it?.picks) ? it.picks : [];
    const serialsRaw: string[] = [];
    for (const p of picks) {
      const sns = Array.isArray(p?.serialNumbers) ? p.serialNumbers : [];
      for (const sn of sns) serialsRaw.push(String(sn || ""));
    }
    const serials = uniq(serialsRaw.map(normalizeSerial));

    if (!articleId || !title) continue;
    if (!serials.length) continue;

    const art = await getArticle(articleId);
    const categoryId = String(art?.articleCategoryId || art?.categoryId || "").trim();
    const categoryName = categoryId ? await getCategoryName(categoryId) : "";

    const catUpper = toUpperTrim(categoryName);

    if (ALLOWED_DEVICE_CATEGORIES.has(catUpper)) {
      deviceItems.push({
        articleId,
        title,
        categoryId: categoryId || undefined,
        categoryName: categoryName || undefined,
        serials,
      });

      if (catUpper === "BAREBONE MINI-PC") hasMini = true;
      if (catUpper === "RUGGED TABLET") hasRugged = true;
    }
  }

  if (hasMini && hasRugged) {
    return jsonErr("Dieser Lieferschein enthält gemischte Warengruppen (Mini-PC + Rugged Tablet). Das ist nicht erlaubt.", 409, {
      documentNumber,
      categories: deviceItems.map((d) => d.categoryName),
      tried,
    });
  }

  const deviceType: "mini" | "rugged" = hasRugged ? "rugged" : "mini";
  const deviceSerials = uniq(deviceItems.flatMap((d) => d.serials));
  const productNames = deviceItems.map((d) => d.title);

  return jsonOk({
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
