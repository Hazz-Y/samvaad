exports.handler = async () => {
  const ok = Boolean(process.env.GNANI_API_KEY);
  return {
    statusCode: ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ok ? { ok: true } : { ok: false, message: "GNANI_API_KEY not configured on Netlify" }),
  };
};
