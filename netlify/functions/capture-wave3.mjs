// Wave 3 of 4 — ~28 tickers at 3:55 PM ET
export default async (request) => {
  const siteUrl = Netlify.env.get("URL") || "https://0ptions-agent.netlify.app";
  console.log(`[${new Date().toISOString()}] Triggering wave 3/4...`);
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

export const config = { schedule: "55 19 * * 1-5" };
