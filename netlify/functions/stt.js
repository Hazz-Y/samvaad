// Netlify Function: proxy multipart STT requests to Gnani Prisma.
// The API key lives only in the GNANI_API_KEY environment variable.

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ success: false, message: "POST only" }) };
  }
  const key = process.env.GNANI_API_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ success: false, message: "GNANI_API_KEY not configured" }) };
  }
  const body = Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "utf8");
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";

  let lastStatus = 500, lastText = '{"success":false,"message":"upstream failed"}';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 600 * attempt));
    const resp = await fetch("https://api.vachana.ai/stt/v3", {
      method: "POST",
      headers: { "X-API-Key-ID": key, "Content-Type": contentType },
      body,
    });
    lastStatus = resp.status;
    lastText = await resp.text();
    if (resp.status !== 429 && resp.status < 500) break; // retry only 429/5xx
  }
  return { statusCode: lastStatus, headers: { "Content-Type": "application/json" }, body: lastText };
};
