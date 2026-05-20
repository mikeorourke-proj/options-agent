// Proxies image OCR requests to Claude API (avoids browser CORS)
export default async (request) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (request.method === "OPTIONS") return new Response("", { status: 204, headers });

  try {
    const { image, mediaType } = await request.json();
    if (!image) return new Response(JSON.stringify({ error: "No image data" }), { status: 400, headers });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500, headers });

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/png", data: image } },
            { type: "text", text: 'Extract ALL ticker symbols, total assets (AUM), and %1D change from this Bloomberg terminal screenshot. Return ONLY a JSON array, no markdown, no backticks, no explanation. Each element: {"ticker":"TQQQ","aum":34046.82,"pct1d":4.02}. The aum is in millions. The pct1d is the percentage (positive or negative, e.g. -3.99 not 3.99 if the value shows -3.99%). Include ALL tickers visible — both market/index tickers (like SPY, QQQ, IWM) and levered ETF tickers (like TQQQ, SOXL, etc). Strip any " US" suffix from tickers.' }
          ]
        }]
      })
    });

    const result = await response.json();
    return new Response(JSON.stringify(result), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
};
