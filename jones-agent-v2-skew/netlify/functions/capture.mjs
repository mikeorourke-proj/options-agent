// Scheduled trigger — fires at 3:56 PM ET every weekday
export default async (request) => {
  const siteUrl = Netlify.env.get("URL") || "https://0ptions-agent.netlify.app";
  console.log(`[${new Date().toISOString()}] Triggering capture-background...`);
  try {
    await fetch(`${siteUrl}/.netlify/functions/capture-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "scheduled", wave: 0, time: new Date().toISOString() })
    });
    console.log("Capture triggered");
  } catch (e) {
    console.error("Capture failed:", e.message);
  }
};

export const config = { schedule: "56 19 * * 1-5" };
