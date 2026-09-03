/* Poll target for think-background. Returns the job document. */
import { getStore } from "@netlify/blobs";

export default async (request) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response(JSON.stringify({ status: "error", error: "missing id" }), { status: 400, headers });
  try {
    const doc = await getStore("think-jobs").get(id, { type: "json" });
    if (!doc) return new Response(JSON.stringify({ status: "pending" }), { headers });
    return new Response(JSON.stringify(doc), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ status: "pending", note: e.message }), { headers });
  }
};
