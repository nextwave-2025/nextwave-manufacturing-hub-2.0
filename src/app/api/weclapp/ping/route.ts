import { NextResponse } from "next/server";
import { weclappFetch } from "../../../../lib/weclapp";

export async function GET() {
  const res = await weclappFetch("/shipment?page=1&pageSize=1");
  const data = await res.json();

  return NextResponse.json({
    success: true,
    sample: data
  });
}
