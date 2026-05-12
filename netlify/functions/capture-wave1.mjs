// Wave 1 of 3 — tickers 0–47 at 3:53 PM ET
export default async (request) => {
  const siteUrl = Netlify.env.get("URL") || "https://0ptions-agent.netlify.app";
  console.log(`[${new Date().toISOString()}] Triggering wave 1/3...`);
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

export const config = { schedule: "53 19 * * 1-5" };
