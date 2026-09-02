// TEMPORARY DIAGNOSTIC — delete after the schema survey is done.
// Proxies a whitelisted set of GET paths to Massive (api.polygon.io) using the
// server-side key, and returns status + timing + a trimmed shape summary so the
// key is never exposed to the browser.

const HOST = "https://api.polygon.io";

// Only these path prefixes may be proxied. Keeps this from becoming an open relay.
const ALLOWED_PREFIXES = [
  "/v1/", "/v2/", "/v3/", "/vX/",
  "/stocks/", "/fed/", "/etf-global/", "/options/",
];

function shapeOf(v, depth = 0) {
  if (v === null) return "null";
  if (Array.isArray(v)) return depth > 1 ? `array[${v.length}]` : { _array: v.length, _first: v.length ? shapeOf(v[0], depth + 1) : null };
  if (typeof v === "object") {
    if (depth > 2) return "object";
    const out = {};
    for (const k of Object.keys(v).slice(0, 40)) out[k] = shapeOf(v[k], depth + 1);
    return out;
  }
  if (typeof v === "string") return v.length > 60 ? "string(long)" : `string:${v}`;
  return typeof v === "number" ? `number:${v}` : typeof v;
}

export default async (request) => {
  const apiKey = Netlify.env.get("POLYGON_API_KEY");
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (!apiKey) return new Response(JSON.stringify({ error: "POLYGON_API_KEY not set" }), { status: 500, headers });

  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  const full = url.searchParams.get("full") === "1";
  if (!path) return new Response(JSON.stringify({ error: "missing ?path=" }), { status: 400, headers });
  if (!ALLOWED_PREFIXES.some(p => path.startsWith(p))) {
    return new Response(JSON.stringify({ error: "path prefix not allowed", path }), { status: 400, headers });
  }

  const sep = path.includes("?") ? "&" : "?";
  const target = `${HOST}${path}${sep}apiKey=${apiKey}`;
  const t0 = Date.now();

  try {
    const r = await fetch(target, { headers: { Accept: "application/json" } });
    const ms = Date.now() - t0;
    const text = await r.text();

    let body;
    try { body = JSON.parse(text); } catch { body = { _nonJson: text.slice(0, 300) }; }

    const results = body?.results;
    const count = Array.isArray(results) ? results.length
                : body?.count ?? body?.resultsCount ?? (results ? 1 : 0);

    const out = {
      ok: r.ok,
      status: r.status,
      ms,
      path,
      count,
      hasNextUrl: Boolean(body?.next_url),
      topKeys: body && typeof body === "object" ? Object.keys(body).slice(0, 20) : [],
      message: body?.message || body?.error || null,
      shape: Array.isArray(results) && results.length ? shapeOf(results[0])
           : results ? shapeOf(results)
           : shapeOf(body),
    };
    if (full) out.raw = body;

    return new Response(JSON.stringify(out), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, status: 0, path, error: e.message }), { status: 200, headers });
  }
};
