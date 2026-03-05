import { NextResponse } from "next/server";

export const runtime = "nodejs";

type WeclappAny = any;

type DeviceType = "mini" | "rugged";

type DeviceItem = {
  articleId: string;
  title: string;
  categoryId?: string;
  categoryName?: string;
  serials: string[];
};

function jsonOk(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function norm(s: string) {
  return (s || "").trim();
}

function normSn(s: string) {
  return (s || "").trim().replace(/\s+/g, "").toUpperCase();
}

function isAllowedDeviceCategory(name: string) {
  const n = norm(name);
  return n === "Barebone Mini-PC" || n === "Rugged Tablet";
}

function inferDeviceType(deviceItems: DeviceItem[]): DeviceType {
  const hasRugged = deviceItems.some((x) => norm(x.categoryName || "") === "Rugged Tablet");
  return hasRugged ? "rugged" : "mini";
}

async function weclappFetch(url: string, token: string) {
  return fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      AuthenticationToken: token,
    },
    // wichtig: kein Cache in Serverless
    cache: "no-store",
  });
}

async function safeReadJson(res: Response) {
  const text = await res.text();
  try {
    return { ok: true as const, json: text ? JSON.parse(text) : null, text };
  } catch {
    return { ok: false as const, json: null, text };
  }
}

export async function GET(req: Request) {
  const started = Date.now();

  const apiBase = process.env.WECLAPP_BASE_URL || "";
  const token = process.env.WECLAPP_API_TOKEN || "";

  const { searchParams } = new URL(req.url);
  const inputRaw = searchParams.get("number") || "";
  const input = norm(inputRaw);

  // wir sammeln debug immer mit
  const debug: any = {
    input,
    apiBase: apiBase || "(missing)",
    hasToken: Boolean(token),
    tried: [] as any[],
    ms: 0,
  };

  if (!input) {
    debug.ms = Date.now() - started;
    return jsonOk({ ok: false, error: "Bitte Belegnummer (shipmentNumber) angeben.", debug }, 400);
  }

  // ✅ WICHTIG: Du wolltest NUR Belegnummer, keine IDs, keine fuzzy Suche.
  // Also: wir suchen ausschließlich shipment?shipmentNumber=<input> und matchen exakt.
  if (!apiBase || !token) {
    debug.ms = Date.now() - started;
    return jsonOk(
      {
        ok: false,
        error: "Server-Konfiguration fehlt: WECLAPP_API_BASE oder WECLAPP_API_TOKEN ist leer.",
        debug,
      },
      500,
    );
  }

  // caches
  const articleCache = new Map<string, any>();
  const categoryCache = new Map<string, any>();

  const getArticle = async (articleId: string) => {
    if (articleCache.has(articleId)) return articleCache.get(articleId);
    const url = `${apiBase}/article/id/${encodeURIComponent(articleId)}`;
    const r = await weclappFetch(url, token);
    const body = await safeReadJson(r);

    debug.tried.push({
      url,
      status: r.status,
      jsonOk: body.ok,
      bodyPreview: (body.text || "").slice(0, 250),
    });

    const art = body.ok ? body.json : null;
    articleCache.set(articleId, art);
    return art;
  };

  const getCategory = async (categoryId: string) => {
    if (!categoryId) return null;
    if (categoryCache.has(categoryId)) return categoryCache.get(categoryId);

    const url = `${apiBase}/articleCategory/id/${encodeURIComponent(categoryId)}`;
    const r = await weclappFetch(url, token);
    const body = await safeReadJson(r);

    debug.tried.push({
      url,
      status: r.status,
      jsonOk: body.ok,
      bodyPreview: (body.text || "").slice(0, 250),
    });

    const cat = body.ok ? body.json : null;
    categoryCache.set(categoryId, cat);
    return cat;
  };

  try {
    // 1) shipment by exact shipmentNumber
    const urlShip = `${apiBase}/shipment?shipmentNumber=${encodeURIComponent(input)}`;
    const shipRes = await weclappFetch(urlShip, token);
    const shipBody = await safeReadJson(shipRes);

    debug.tried.push({
      url: urlShip,
      status: shipRes.status,
      jsonOk: shipBody.ok,
      bodyPreview: (shipBody.text || "").slice(0, 250),
    });

    if (!shipRes.ok || !shipBody.ok) {
      debug.ms = Date.now() - started;
      return jsonOk(
        {
          ok: false,
          error: `Weclapp shipment-Request fehlgeschlagen (HTTP ${shipRes.status}).`,
          debug,
        },
        500,
      );
    }

    const shipList: WeclappAny[] = Array.isArray(shipBody.json?.result) ? shipBody.json.result : [];

    // ✅ EXAKTES Matching erzwingen
    const shipment = shipList.find((x) => String(x?.shipmentNumber || "") === input);

    if (!shipment) {
      debug.ms = Date.now() - started;
      return jsonOk(
        {
          ok: false,
          error: "Kein Beleg mit exakt dieser Belegnummer gefunden.",
          debug,
        },
        404,
      );
    }

    // 2) Grunddaten
    const customerName = norm(shipment?.recipientAddress?.company || shipment?.invoiceAddress?.company || "");
    const documentNumber = norm(shipment?.shipmentNumber || "");
    const salesOrderNumber = norm(shipment?.salesOrderNumber || shipment?.packageReferenceNumber || "");

    const shipmentItems: WeclappAny[] = Array.isArray(shipment?.shipmentItems) ? shipment.shipmentItems : [];

    // 3) Produktnamen + Serial-Mapping (alle Items – nur für Anzeige)
    const productNames = uniq(shipmentItems.map((it) => norm(it?.title)).filter(Boolean));

    const serialsByProduct: Record<string, string[]> = {};
    for (const it of shipmentItems) {
      const title = norm(it?.title);
      if (!title) continue;

      const picks: WeclappAny[] = Array.isArray(it?.picks) ? it.picks : [];
      const sns = uniq(
        picks.flatMap((p) => (Array.isArray(p?.serialNumbers) ? p.serialNumbers : [])).map(normSn),
      );

      serialsByProduct[title] = sns;
    }

    // 4) DeviceItems: nur Warengruppen Barebone Mini-PC / Rugged Tablet
    const deviceItems: DeviceItem[] = [];

    for (const it of shipmentItems) {
      const articleId = norm(it?.articleId);
      const title = norm(it?.title);
      if (!articleId || !title) continue;

      const picks: WeclappAny[] = Array.isArray(it?.picks) ? it.picks : [];
      const serials = uniq(
        picks.flatMap((p) => (Array.isArray(p?.serialNumbers) ? p.serialNumbers : [])).map(normSn),
      );

      // Artikel + Kategorie holen
      const art = await getArticle(articleId);
      const categoryId = norm(art?.articleCategoryId || art?.articleCategory?.id || "");
      let categoryName = norm(art?.articleCategoryName || "");

      if (!categoryName && categoryId) {
        const cat = await getCategory(categoryId);
        categoryName = norm(cat?.name || "");
      }

      // ✅ nur echte Geräte-Warengruppe reinnehmen
      if (isAllowedDeviceCategory(categoryName)) {
        deviceItems.push({
          articleId,
          title,
          categoryId: categoryId || undefined,
          categoryName: categoryName || undefined,
          serials,
        });
      }
    }

    // 5) DeviceSerials: NUR Seriennummern aus DeviceItems
    const deviceSerials = uniq(deviceItems.flatMap((x) => x.serials).map(normSn));

    // 6) Gerätetyp ableiten
    const deviceType = inferDeviceType(deviceItems);

    debug.ms = Date.now() - started;

    return jsonOk({
      ok: true,
      entity: "shipment",
      input,
      documentNumber,
      salesOrderNumber,
      customerName,
      productNames,
      serialsByProduct,
      deviceItems,
      deviceSerials,
      deviceType,
      debug: {
        ...debug,
        // wir schicken debug mit, damit du IMMER siehst was passiert
        note: "deviceSerials enthält nur Barebone Mini-PC / Rugged Tablet. productNames enthält alle Items nur zur Anzeige.",
      },
    });
  } catch (e: any) {
    debug.ms = Date.now() - started;
    return jsonOk(
      {
        ok: false,
        error: "Server-Exception in /api/weclapp/delivery-note (siehe debug.details).",
        debug: {
          ...debug,
          details: String(e?.message || e),
          stack: String(e?.stack || ""),
        },
      },
      500,
    );
  }
}
