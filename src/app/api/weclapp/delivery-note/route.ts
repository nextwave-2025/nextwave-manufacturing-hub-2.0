import { NextResponse } from "next/server";

const WECLAPP_BASE_URL = process.env.WECLAPP_BASE_URL; // z.B. https://xxx.weclapp.com  ODER inkl. /webapp/api/v1
const WECLAPP_API_TOKEN = process.env.WECLAPP_API_TOKEN;

function jsonError(msg: string, status = 500, extra?: any) {
  return NextResponse.json({ ok: false, error: msg, ...extra }, { status });
}

function buildApiBase(base: string) {
  const b = base.replace(/\/$/, "");
  // Wenn schon /webapp/api/v1 drin ist, nicht nochmal anhängen
  if (b.includes("/webapp/api/v1")) return b;
  return b + "/webapp/api/v1";
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
  const deliveryNumber = (searchParams.get("number") || "").trim();

  if (!deliveryNumber) {
    return jsonError("Query-Parameter 'number' fehlt.", 400);
  }

  const apiBase = buildApiBase(WECLAPP_BASE_URL);

  // Versuch A: shipment (Weclapp Lieferschein/Warenausgang ist sehr oft shipment)
  const urlShipment = `${apiBase}/shipment?shipmentNumber=${encodeURIComponent(deliveryNumber)}`;
  const a = await weclappGet(urlShipment);

  if (a.ok) {
    const note = Array.isArray(a.json?.result) ? a.json.result[0] : a.json;
    if (!note) return jsonError(`Kein Shipment gefunden für Nummer: ${deliveryNumber}`, 404);
    const customerName = note?.customerName || note?.customer?.name || "";
    const items = note?.shipmentItems || note?.items || [];
    return NextResponse.json({ ok: true, entity: "shipment", deliveryNumber, customerName, items, raw: note });
  }

  // Wenn Endpoint 404 -> sehr wahrscheinlich falsche Entity, dann Versuch B: deliveryNote
  const urlDeliveryNote = `${apiBase}/deliveryNote?deliveryNoteNumber=${encodeURIComponent(deliveryNumber)}`;
  const b = await weclappGet(urlDeliveryNote);

  if (b.ok) {
    const note = Array.isArray(b.json?.result) ? b.json.result[0] : b.json;
    if (!note) return jsonError(`Kein DeliveryNote gefunden für Nummer: ${deliveryNumber}`, 404);
    const customerName = note?.customerName || note?.customer?.name || "";
    const items = note?.deliveryNoteItems || note?.items || [];
    return NextResponse.json({ ok: true, entity: "deliveryNote", deliveryNumber, customerName, items, raw: note });
  }

  // Debug-Ausgabe, damit wir 100% sehen was Weclapp ablehnt
  return jsonError(
    "Weclapp Request fehlgeschlagen (siehe debug).",
    502,
    {
      debug: {
        apiBase,
        tried: [
          { url: urlShipment, status: a.status, bodyPreview: (a.text || "").slice(0, 300) },
          { url: urlDeliveryNote, status: b.status, bodyPreview: (b.text || "").slice(0, 300) },
        ],
      },
    }
  );
}
