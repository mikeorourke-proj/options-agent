/* ═══════════════════════════════════════════════════════════════════
   pdf-stash.mjs — hand-off point for a PDF, because it cannot travel
   in the background function's invocation payload.

   Background functions are invoked ASYNCHRONOUSLY, and an async invoke
   carries a far smaller request body than the 6 MB a synchronous function
   accepts. A 1 MB PDF is 1.37 MB once base64'd into JSON, so the invoke was
   rejected before the function ran: no first write to Blobs, no "running"
   status, and a client that polled "pending" for four minutes because it
   never looked at the response to the POST.

   So the bytes go to Blobs through this ordinary synchronous function, and
   the background job receives a key. The invocation payload drops from
   1.37 MB to a few hundred bytes.

   Raw bytes, not base64: the browser sends the File as the body, and the
   encoding happens here. That is a third less over the wire and removes the
   FileReader step on the client.
   ═══════════════════════════════════════════════════════════════════ */
import { getStore } from "@netlify/blobs";

export default async (request) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const bad = (status, error) => new Response(JSON.stringify({ error }), { status, headers });

  if (request.method !== "POST") return bad(405, "POST only");
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return bad(400, "missing id");

  try {
    const buf = await request.arrayBuffer();
    if (!buf.byteLength) return bad(400, "empty body");
    /* Well inside the 6 MB a synchronous function accepts, with room for
       the base64 the model needs on the far side. */
    if (buf.byteLength > 4 * 1024 * 1024) return bad(413, "PDF over the 4 MB ceiling");

    const b64 = Buffer.from(buf).toString("base64");
    await getStore("pdf-uploads").set(id, b64);

    return new Response(JSON.stringify({
      ok: true, id,
      kb: +(buf.byteLength / 1024).toFixed(1),
      b64KB: Math.round(b64.length / 1024),
    }), { headers });
  } catch (e) {
    return bad(500, e.message);
  }
};
