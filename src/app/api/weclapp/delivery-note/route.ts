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

function uniq<T>(arr: readonly T[]) {
  return Array.from(new Set(arr));
}

function inferDeviceType(productTitles: string[]) {
  const s = productTitles.join(" ").toUpperCase();
  if (s.includes("WAVETAB") || s.includes("RUGGED") || s.includes("TABLET")) return "rugged";
  return "mini";
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

    // deliveryNote (falls ihr es nutzt)
    `${apiBase}/deliveryNote?deliveryNoteNumber=${encodeURIComponent(numberOrId)}`,
    `${apiBase}/deliveryNote/id/${encodeURIComponent(numberOrId)}`,
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

    // ✅ customerName robust: shipment hat oft recipientAddress.company
    const customerName: string =
      obj?.customerName ||
      obj?.customer?.name ||
      obj?.recipientAddress?.company ||
      obj?.invoiceAddress?.company ||
      "";

    // ✅ product names: garantiert string[]
    const productNames: string[] = uniq(
      (items as any[])
        .map((it: any) => String(it?.title || it?.articleName || "").trim())
        .filter((v: string) => Boolean(v)),
    );

    // ✅ serials aus picks: garantiert string[]
    const serials: string[] = uniq(
      (items as any[])
        .flatMap((it: any) => (Array.isArray(it?.picks) ? it.picks : []))
        .flatMap((p: any) => (Array.isArray(p?.serialNumbers) ? p.serialNumbers : []))
        .map((x: any) => String(x || "").trim())
        .filter((v: string) => Boolean(v)),
    );

    const deviceType = inferDeviceType(productNames);

    return NextResponse.json({
      ok: true,
      entity,
      input: numberOrId,

      // ✅ genau das, was dein UI braucht
      customerName,
      productNames,
      serials,
      deviceType,

      // optional zum Debuggen
      raw: obj,
    });
  }

  return jsonError("Weclapp Request fehlgeschlagen (siehe debug).", 502, { debug: { apiBase, tried } });
}
