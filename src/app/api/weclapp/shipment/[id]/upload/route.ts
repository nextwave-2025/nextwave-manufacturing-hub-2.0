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

 const providedName = form.get("name");
const filename =
  (typeof providedName === "string" && providedName.trim() ? providedName.trim() : "") ||
  ((file as Blob & { name?: string }).name ?? "") ||
  `Fertigungsprotokoll-${shipmentId}.pdf`;
  const description =
    (form.get("description") as string) || "NEXTWAVE Fertigungsprotokoll";

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
