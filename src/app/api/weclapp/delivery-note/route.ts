import { NextResponse } from "next/server";

const WECLAPP_BASE_URL = process.env.WECLAPP_BASE_URL; // z.B. https://xxx.weclapp.com
const WECLAPP_API_TOKEN = process.env.WECLAPP_API_TOKEN; // dein Token

function jsonError(msg: string, status = 500) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function GET(req: Request) {
  if (!WECLAPP_BASE_URL || !WECLAPP_API_TOKEN) {
    return jsonError("Weclapp API nicht konfiguriert (BASE_URL oder API_TOKEN fehlt).", 500);
  }

  const { searchParams } = new URL(req.url);
  const deliveryNumber = (searchParams.get("number") || "").trim();

  if (!deliveryNumber) {
    return jsonError("Query-Parameter 'number' fehlt.", 400);
  }

  try {
    // 1) Lieferschein anhand der Nummer suchen
    // (Weclapp liefert bei vielen Entities eine 'result' Liste)
    const url =
      `${WECLAPP_BASE_URL.replace(/\/$/, "")}` +
      `/webapp/api/v1/deliveryNote?` +
      `deliveryNoteNumber=${encodeURIComponent(deliveryNumber)}`;

    const r = await fetch(url, {
      method: "GET",
      headers: {
        AuthenticationToken: WECLAPP_API_TOKEN,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return jsonError(`Weclapp Fehler (${r.status}): ${t || "Unbekannt"}`, 502);
    }

    const data: any = await r.json();

    // Je nach Weclapp-Response: entweder direkt Objekt oder { result: [...] }
    const note = Array.isArray(data?.result) ? data.result[0] : data;

    if (!note) {
      return jsonError(`Kein Lieferschein gefunden für Nummer: ${deliveryNumber}`, 404);
    }

    // 2) Optional: Kundendaten / Positionen aus dem Lieferschein extrahieren
    // Wir geben erstmal roh zurück + ein paar bequeme Felder.
    const customerName =
      note?.customerName ||
      note?.customer?.name ||
      note?.customerCompany ||
      "";

    // Positionen heißen je nach Entity oft "deliveryNoteItems" o.ä.
    const items = note?.deliveryNoteItems || note?.items || [];

    // Seriennummern sind in Weclapp je nach Prozess entweder:
    // - direkt an Items / BatchSerialNumbers
    // - oder über verknüpfte Dokumente
    // Wir geben erstmal die Items zurück, damit wir im nächsten Schritt sauber mappen.
    return NextResponse.json({
      ok: true,
      deliveryNoteNumber: deliveryNumber,
      customerName,
      deviceHintText: JSON.stringify(items).slice(0, 2000), // nur Debug (kannst du später entfernen)
      raw: note,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Unbekannter Serverfehler", 500);
  }
}
