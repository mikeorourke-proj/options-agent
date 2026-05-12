// Wave 2 of 3 — tickers 48–95 at 3:55 PM ET
export default async (request) => {
  const siteUrl = Netlify.env.get("URL") || "https://0ptions-agent.netlify.app";
  console.log(`[${new Date().toISOString()}] Triggering wave 2/3...`);
  try {
    await fetch(`${siteUrl}/.netlify/functions/capture-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "scheduled", wave: 1, time: new Date().toISOString() })
    });
    console.log("Wave 2 triggered");
  } catch (e) {
    console.error("Wave 2 failed:", e.message);
  }
};

export const config = { schedule: "55 19 * * 1-5" };
