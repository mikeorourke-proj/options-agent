// Wave 1 of 6 — ~24 tickers at 3:45 PM ET
export default async (request) => {
  const siteUrl = Netlify.env.get("URL") || "https://0ptions-agent.netlify.app";
  console.log(`[${new Date().toISOString()}] Triggering wave 1/6...`);
  try {
    await fetch(`${siteUrl}/.netlify/functions/capture-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "scheduled", wave: 0, time: new Date().toISOString() })
    });
    console.log("Wave 1 triggered");
  } catch (e) {
    console.error("Wave 1 failed:", e.message);
  }
};

export const config = { schedule: "45 19 * * 1-5" };
