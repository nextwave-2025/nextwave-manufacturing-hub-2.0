import { NextResponse } from "next/server";
import { weclappFetch } from "../../../../../../lib/weclapp";

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: "Upload route exists. Use POST multipart/form-data with field 'file'.",
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const shipmentId = params.id;

  const form = await req.formData();
const file = form.get("file");

if (!file || typeof (file as any).arrayBuffer !== "function") {
  return NextResponse.json(
    { success: false, error: "Missing file (form field 'file')" },
    { status: 400 }
  );
}

  const filename =
    (form.get("name") as string) || file.name || `Fertigungsprotokoll-${shipmentId}.pdf`;
  const description =
    (form.get("description") as string) || "NEXTWAVE Fertigungsprotokoll";

const pdfBytes = Buffer.from(await (file as any).arrayBuffer());
  
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
