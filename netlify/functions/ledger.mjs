/* ═══════════════════════════════════════════════════════════════════
   ledger.mjs — the idea history.

   Ten-odd notes have been published and not one leg, entry, stop or
   expectancy persisted anywhere. Every design argument of the last fortnight
   — the wall thresholds, the conviction drift, the confidence floor, the six
   composite weights — rests on judgement because there has never been a
   record to check it against.

   This is that record. It is INTERNAL: nothing here is published in a note.
   It exists so that in six weeks the questions can be settled by replay
   rather than argued again:

     do ladders fill, and how often
     does price actually stall at a wall, or pass through
     is pStopped calibrated — do legs marked 25% stop out a quarter of the time
     does expectancy ORDER match realised return order

   Written on PRINT, not on compose. Composing is cheap and happens
   repeatedly while tuning a note, so recording every compose would fill the
   ledger with drafts of the same idea and make the fill-rate and outcome
   statistics meaningless.
   ═══════════════════════════════════════════════════════════════════ */
import { getStore } from "@netlify/blobs";

const STORE = "tactical-ledger";
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export default async (request) => {
  let store;
  try { store = getStore(STORE); }
  catch (e) { return json({ error: `blob store unavailable: ${e.message}` }, 500); }

  const url = new URL(request.url);

  if (request.method === "GET") {
    /* One entry by key, or the index. The index is stored as a single
       document rather than derived from a list() so the viewer opens in one
       round trip however many notes accumulate. */
    const key = url.searchParams.get("key");
    if (key) {
      const doc = await store.get(`note/${key}`, { type: "json" });
      return doc ? json(doc) : json({ error: "not found" }, 404);
    }
    const index = (await store.get("index", { type: "json" })) || { entries: [] };
    return json(index);
  }

  if (request.method === "POST") {
    let body;
    try { body = await request.json(); }
    catch { return json({ error: "body is not JSON" }, 400); }
    if (!body?.key || !body?.note) return json({ error: "key and note are required" }, 400);

    await store.setJSON(`note/${body.key}`, body.note);

    /* The index carries only what the list view shows, so it stays small
       enough to fetch on every open. Newest first. A repeat print of the
       same note REPLACES its index row rather than adding a second. */
    const index = (await store.get("index", { type: "json" })) || { entries: [] };
    const row = {
      key: body.key, date: body.note.printedAt, title: body.note.title,
      legs: (body.note.legs || []).map(l => l.ticker),
      themes: (body.note.legs || []).length,
      version: body.note.version,
    };
    index.entries = [row, ...index.entries.filter(e => e.key !== body.key)].slice(0, 500);
    await store.setJSON("index", index);
    return json({ ok: true, key: body.key, count: index.entries.length });
  }

  if (request.method === "DELETE") {
    const key = url.searchParams.get("key");
    if (!key) return json({ error: "key is required" }, 400);
    await store.delete(`note/${key}`);
    const index = (await store.get("index", { type: "json" })) || { entries: [] };
    index.entries = index.entries.filter(e => e.key !== key);
    await store.setJSON("index", index);
    return json({ ok: true, count: index.entries.length });
  }

  return json({ error: "method not allowed" }, 405);
};

export const config = { path: "/api/ledger" };
