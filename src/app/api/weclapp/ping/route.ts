import { NextResponse } from "next/server";
import { weclappFetch } from "../../../../../lib/weclapp"; // so wie bei dir ohne @-Alias

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const shipmentId = params.id;

  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "Missing file" }, { status: 400 });
  }

  const filename = (form.get("name") as string) || file.name || `Fertigungsprotokoll-${shipmentId}.pdf`;
  const description = (form.get("description") as string) || "NEXTWAVE Fertigungsprotokoll";

  const pdfBytes = Buffer.from(await file.arrayBuffer());

  const qs = new URLSearchParams({
    entityName: "shipment",
    entityId: shipmentId,
    name: filename,
    description,
  });

  const res = await weclappFetch(`/document/upload?${qs.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/pdf",
    },
    body: pdfBytes,
  });

  const result = await res.json();
  return NextResponse.json({ success: true, result });
}
