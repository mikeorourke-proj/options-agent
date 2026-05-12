// Wave 6 of 6 — ~24 tickers at 3:55 PM ET
export default async (request) => {
  const siteUrl = Netlify.env.get("URL") || "https://0ptions-agent.netlify.app";
  console.log(`[${new Date().toISOString()}] Triggering wave 6/6...`);
  try {
    await fetch(`${siteUrl}/.netlify/functions/capture-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "scheduled", wave: 5, time: new Date().toISOString() })
    });
    console.log("Wave 6 triggered");
  } catch (e) {
    console.error("Wave 6 failed:", e.message);
  }
};

export const config = { schedule: "55 19 * * 1-5" };
