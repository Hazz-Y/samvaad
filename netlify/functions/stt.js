// Netlify Function: proxy multipart STT requests to Gnani Prisma.
// The API key lives only in the GNANI_API_KEY environment variable.
//
// The frontend sends FormData with: audio_file, language_code, format.
// We parse the incoming multipart body, add the required `model` field,
// and build a fresh multipart request to forward upstream — this avoids
// boundary-mismatch issues that arise when Netlify base64-encodes the body.

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ success: false, message: "POST only" }) };
  }
  const key = process.env.GNANI_API_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ success: false, message: "GNANI_API_KEY not configured" }) };
  }

  // ── Parse the incoming multipart body ──
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  const boundaryMatch = contentType.match(/boundary=(.+)/i);
  if (!boundaryMatch) {
    return { statusCode: 400, body: JSON.stringify({ success: false, message: "Missing multipart boundary" }) };
  }

  const raw = Buffer.from(event.body || "", event.isBase64Encoded ? "base64" : "utf8");

  // Extract text fields and the audio file from the multipart body
  const parts = parseMultipart(raw, boundaryMatch[1]);
  const textFields = {};
  let audioFile = null;
  let audioFilename = "audio.wav";

  for (const part of parts) {
    if (part.filename) {
      audioFile = part.data;
      audioFilename = part.filename;
    } else {
      textFields[part.name] = part.data.toString("utf8");
    }
  }

  if (!audioFile) {
    return { statusCode: 400, body: JSON.stringify({ success: false, message: "No audio_file in request" }) };
  }

  // ── Build a fresh multipart body with the model field included ──
  const boundary = "----GnaniBridge" + Date.now();
  const bodyParts = [];

  // Required model field (missing from frontend FormData)
  bodyParts.push(field("model", "prisma-v3.0", boundary));

  // Forward text fields from the frontend (language_code, format, etc.)
  for (const [name, value] of Object.entries(textFields)) {
    bodyParts.push(field(name, value, boundary));
  }

  // Audio file part
  bodyParts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="audio_file"; filename="${audioFilename}"\r\nContent-Type: audio/wav\r\n\r\n`
    ),
    audioFile,
    Buffer.from("\r\n")
  );

  // Closing boundary
  bodyParts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(bodyParts);
  const upstreamContentType = `multipart/form-data; boundary=${boundary}`;

  // ── Forward to Gnani with retries ──
  let lastStatus = 500, lastText = '{"success":false,"message":"upstream failed"}';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 600 * attempt));
    const resp = await fetch("https://api.vachana.ai/stt/v3", {
      method: "POST",
      headers: { "X-API-Key-ID": key, "Content-Type": upstreamContentType },
      body,
      redirect: "follow",
    });
    lastStatus = resp.status;
    lastText = await resp.text();
    if (resp.status !== 429 && resp.status < 500) break; // retry only 429/5xx
  }
  return { statusCode: lastStatus, headers: { "Content-Type": "application/json" }, body: lastText };
};

/** Build a simple text field part. */
function field(name, value, boundary) {
  return Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  );
}

/**
 * Minimal multipart parser — extracts parts (name, filename, data) from a
 * multipart/form-data buffer.  No external dependencies required.
 */
function parseMultipart(body, boundary) {
  const results = [];
  // The delimiter may or may not be prefixed with "--"
  const delim = Buffer.from(`--${boundary}`);
  const end = Buffer.from(`--${boundary}--`);

  let pos = indexOf(body, delim, 0);
  if (pos < 0) return results;

  while (true) {
    // Move past the delimiter + CRLF
    pos += delim.length;
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break; // end marker "--"
    if (body[pos] === 0x0d) pos += 2; // skip \r\n

    // Find end of headers (blank line)
    const headerEnd = indexOf(body, Buffer.from("\r\n\r\n"), pos);
    if (headerEnd < 0) break;
    const headerStr = body.slice(pos, headerEnd).toString("utf8");

    // Parse Content-Disposition
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);

    const dataStart = headerEnd + 4;
    const nextDelim = indexOf(body, delim, dataStart);
    if (nextDelim < 0) break;

    // Data ends 2 bytes before the next delimiter (\r\n before delimiter)
    const dataEnd = nextDelim - 2;

    results.push({
      name: nameMatch ? nameMatch[1] : "",
      filename: filenameMatch ? filenameMatch[1] : null,
      data: body.slice(dataStart, Math.max(dataStart, dataEnd)),
    });

    pos = nextDelim;
  }

  return results;
}

/** Buffer.indexOf polyfill for searching a needle buffer in a haystack. */
function indexOf(haystack, needle, from) {
  for (let i = from || 0; i <= haystack.length - needle.length; i++) {
    let found = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}
