// Wave 3 of 3 — tickers 96–143 at 3:57 PM ET
export default async (request) => {
  const siteUrl = Netlify.env.get("URL") || "https://0ptions-agent.netlify.app";
  console.log(`[${new Date().toISOString()}] Triggering wave 3/3...`);
  try {
    await fetch(`${siteUrl}/.netlify/functions/capture-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "scheduled", wave: 2, time: new Date().toISOString() })
    });
    console.log("Wave 3 triggered");
  } catch (e) {
    console.error("Wave 3 failed:", e.message);
  }
};

export const config = { schedule: "57 19 * * 1-5" };
