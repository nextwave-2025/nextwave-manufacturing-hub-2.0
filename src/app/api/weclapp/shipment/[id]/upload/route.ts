import { NextResponse } from "next/server";
import { weclappFetch } from "../../../../../../lib/weclapp";

export async function GET() {
  return NextResponse.json({
    ok: true,
    info: "Upload route exists. Use POST multipart/form-data with field 'file'.",
  });
}
