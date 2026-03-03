// src/lib/weclapp.ts
export async function weclappFetch(path: string, init: RequestInit = {}) {
  const baseUrl = process.env.WECLAPP_BASE_URL!;
  const token = process.env.WECLAPP_API_TOKEN!;
  if (!baseUrl || !token) throw new Error("Missing WECLAPP_BASE_URL or WECLAPP_API_TOKEN");

  const url = `${baseUrl}${path.startsWith("/") ? "" : "/"}${path}`;

  const res = await fetch(url, {
    ...init,
    headers: {
      AuthenticationToken: token,
      ...(init.headers || {}),
    },
    // weclapp responses are not cached in our app
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`weclapp ${res.status} ${res.statusText}: ${text}`);
  }
  return res;
}
