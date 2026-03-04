import { NextResponse } from "next/server";

const WECLAPP_BASE_URL = process.env.WECLAPP_BASE_URL;
const WECLAPP_API_TOKEN = process.env.WECLAPP_API_TOKEN;

function jsonError(msg: string, status = 500, extra?: any) {
  return NextResponse.json({ ok: false, error: msg, ...extra }, { status });
}

function buildApiBase(base: string) {
  // ✅ robust: egal ob base nur Domain ist oder schon /webapp/api/v2 enthält
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

export async function GET(req: Request) {
  if (!WECLAPP_BASE_URL || !WECLAPP_API_TOKEN) {
    return jsonError("Weclapp API nicht konfiguriert (WECLAPP_BASE_URL oder WECLAPP_API_TOKEN fehlt).", 500);
  }

  const { searchParams } = new URL(req.url);
  const numberOrId = (searchParams.get("number") || "").trim();

  if (!numberOrId) {
    return jsonError("Query-Parameter 'number' fehlt.", 400);
  }

  const apiBase = buildApiBase(WECLAPP_BASE_URL);

  // ✅ wir probieren BOTH: Suche über Number-Parameter UND direkter /id/<id>
  const tried: any[] = [];

  const tryUrls = [
    // shipment
    `${apiBase}/shipment?shipmentNumber=${encodeURIComponent(numberOrId)}`,
    `${apiBase}/shipment/id/${encodeURIComponent(numberOrId)}`,

    // deliveryNote
    `${apiBase}/deliveryNote?deliveryNoteNumber=${encodeURIComponent(numberOrId)}`,
    `${apiBase}/deliveryNote/id/${encodeURIComponent(numberOrId)}`,
  ];

  for (const url of tryUrls) {
    const r = await weclappGet(url);
    tried.push({ url, status: r.status, bodyPreview: (r.text || "").slice(0, 300) });

    if (r.ok) {
      const obj = Array.isArray(r.json?.result) ? r.json.result[0] : r.json;
      if (!obj) continue;

      const customerName = obj?.customerName || obj?.customer?.name || "";
      const items = obj?.shipmentItems || obj?.deliveryNoteItems || obj?.items || [];

      // entity name nur grob aus URL ableiten
      const entity = url.includes("/shipment") ? "shipment" : "deliveryNote";

      return NextResponse.json({ ok: true, entity, numberOrId, customerName, items, raw: obj });
    }
  }

  return jsonError(
    "Weclapp Request fehlgeschlagen (siehe debug).",
    502,
    { debug: { apiBase, tried } }
  );
}
