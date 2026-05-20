// Proxies image OCR requests to Claude API (avoids browser CORS)
// Config: increase body size limit for base64 images
export const config = { path: "/.netlify/functions/ocr" };

export default async (request) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (request.method === "OPTIONS") return new Response("", { status: 204, headers });

  try {
    let body;
    try {
      body = await request.json();
    } catch (parseErr) {
      return new Response(JSON.stringify({ error: "Could not parse request body: " + parseErr.message }), { status: 400, headers });
    }

    const { image, mediaType } = body;
    if (!image) return new Response(JSON.stringify({ error: "No image data in request" }), { status: 400, headers });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500, headers });

    console.log(`[OCR] Processing image: ${(image.length / 1024).toFixed(0)}KB base64, type: ${mediaType}`);

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

    if (!response.ok) {
      const errText = await response.text();
      console.log(`[OCR] API error ${response.status}: ${errText.slice(0, 500)}`);
      return new Response(JSON.stringify({ error: `API returned ${response.status}`, detail: errText.slice(0, 200) }), { status: 502, headers });
    }

    const result = await response.json();
    console.log(`[OCR] Success: ${JSON.stringify(result.content?.[0]?.text?.slice(0, 100))}`);
    return new Response(JSON.stringify(result), { headers });
  } catch (e) {
    console.log(`[OCR] Error: ${e.message}`);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
};
