import { NextResponse } from "next/server";
import { weclappFetch } from "../../../../../../lib/weclapp";
import { requireAuth } from "../../../../../../lib/auth";

type WeclappDocument = {
  id: string;
  name?: string;
  description?: string;
  createdDate?: number;
};

async function listShipmentDocuments(shipmentId: string): Promise<WeclappDocument[]> {
  // Weclapp: list documents by entityName/entityId
  const qs = new URLSearchParams({
    entityName: "shipment",
    entityId: shipmentId,
  });

  const res = await weclappFetch(`/document?${qs.toString()}`, { method: "GET" });

  // Some Weclapp endpoints return { result: [...] }
  const json = await res.json().catch(() => null);

  const docs: WeclappDocument[] = Array.isArray(json?.result) ? json.result : Array.isArray(json) ? json : [];
  return docs;
}

export async function GET() {
  const auth = requireAuth();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    info: "Upload route exists. Use POST multipart/form-data with field 'file'.",
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = requireAuth();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const shipmentId = params.id;

  const form = await req.formData();
  const file = form.get("file");

  if (!file || typeof (file as any).arrayBuffer !== "function") {
    return NextResponse.json({ success: false, error: "Missing file (form field 'file')" }, { status: 400 });
  }

  // Filename logic (unchanged)
  const providedName = form.get("name");
  const filename =
    (typeof providedName === "string" && providedName.trim() ? providedName.trim() : "") ||
    ((file as Blob & { name?: string }).name ?? "") ||
    `Fertigungsprotokoll-${shipmentId}.pdf`;

  const descVal = form.get("description");
  const description = typeof descVal === "string" && descVal.trim() ? descVal.trim() : "NEXTWAVE Fertigungsprotokoll";

  // ✅ NEW: Prevent duplicates by name
  // We do a server-side check before upload.
  try {
    const existingDocs = await listShipmentDocuments(shipmentId);
    const hit = existingDocs.find((d) => (d.name || "").trim() === filename);

    if (hit) {
      return NextResponse.json(
        {
          success: false,
          error: "ALREADY_EXISTS",
          message: `Upload nicht möglich: Dokument existiert bereits (${filename}).`,
          existing: { id: hit.id, name: hit.name },
        },
        { status: 409 }
      );
    }
  } catch {
    // If listing fails, we do NOT break your workflow silently with a false positive.
    // We allow upload to proceed, because your current process must keep working.
  }

  const pdfBytes = Buffer.from(await (file as Blob).arrayBuffer());

  const qs = new URLSearchParams({
    entityName: "shipment",
    entityId: shipmentId,
    name: filename,
    description,
  });

  const res = await weclappFetch(`/document/upload?${qs.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: pdfBytes,
  });

  const result = await res.json();
  return NextResponse.json({ success: true, result });
}
