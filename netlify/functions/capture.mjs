// Scheduled trigger — fires at 3:56pm ET every weekday
// Invokes the background capture function which has a 15-minute timeout
export default async (request) => {
  const siteUrl = Netlify.env.get("URL") || "https://0ptions-agent.netlify.app";
  console.log(`[${new Date().toISOString()}] Triggering capture-background...`);
  
  try {
    await fetch(`${siteUrl}/.netlify/functions/capture-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "scheduled", time: new Date().toISOString() })
    });
    console.log("Background capture triggered successfully");
  } catch (e) {
    console.error("Failed to trigger capture:", e.message);
  }
};

// 3:56pm ET = 19:56 UTC (EDT) / 20:56 UTC (EST)
export const config = {
  schedule: "56 19 * * 1-5"
};
