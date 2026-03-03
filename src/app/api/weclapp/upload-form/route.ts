import { NextResponse } from "next/server";

export async function GET() {
  const html = `
<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Upload Test</title></head>
  <body style="font-family: sans-serif; padding: 20px;">
    <h2>Weclapp PDF Upload Test</h2>
    <p>Uploads a PDF to shipment <b>14627</b> (Lieferschein 31147).</p>
    <form action="/api/weclapp/shipment/14627/upload" method="post" enctype="multipart/form-data">
      <div style="margin-bottom: 10px;">
        <label>PDF file: <input type="file" name="file" accept="application/pdf" required></label>
      </div>
      <div style="margin-bottom: 10px;">
        <label>Name: <input type="text" name="name" value="Fertigungsprotokoll-31147.pdf"></label>
      </div>
      <div style="margin-bottom: 10px;">
        <label>Description: <input type="text" name="description" value="NEXTWAVE Fertigungsprotokoll"></label>
      </div>
      <button type="submit">Upload</button>
    </form>
    <p style="margin-top:20px;color:#666;">After submit, you should see JSON response.</p>
  </body>
</html>
  `.trim();

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
