export const config = { runtime: "edge" };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

export default async function handler(req) {
  try {
    const u = new URL(req.url);
    const a = u.searchParams.get("a"); // "lat,lon"
    const b = u.searchParams.get("b");
    if (!a || !b) return json({ error: "Use ?a=lat,lon&b=lat,lon" }, 400);

    const [alat, alon] = a.split(",").map(Number);
    const [blat, blon] = b.split(",").map(Number);
    if (![alat, alon, blat, blon].every(isFinite)) return json({ error: "Bad coords" }, 400);

    const key = (globalThis.process && process.env && process.env.ORS_KEY) || "";
    const r = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: [[alon, alat], [blon, blat]] })
    });

    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    // Return status and a small snippet so we can see error.message or structure
    return json({
      status: r.status,
      ok: r.ok,
      json_keys: j ? Object.keys(j) : null,
      ors_error: j?.error?.message || j?.message || null,
      snippet: text.slice(0, 2000)
    });
  } catch (e) {
    return json({ error: e?.message || String(e) }, 502);
  }
}
