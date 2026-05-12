// Wave 4 of 6 — ~24 tickers at 3:51 PM ET
export default async (request) => {
  const siteUrl = Netlify.env.get("URL") || "https://0ptions-agent.netlify.app";
  console.log(`[${new Date().toISOString()}] Triggering wave 4/6...`);
  try {
    await fetch(`${siteUrl}/.netlify/functions/capture-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "scheduled", wave: 3, time: new Date().toISOString() })
    });
    console.log("Wave 4 triggered");
  } catch (e) {
    console.error("Wave 4 failed:", e.message);
  }
};

export const config = { schedule: "51 19 * * 1-5" };
