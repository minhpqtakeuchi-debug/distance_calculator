export const config = { runtime: "edge" };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function parseLatLon(s) {
  if (!s) return null;
  const m = s.match(/\s*(-?\d+(\.\d+)?)\s*[, ]\s*(-?\d+(\.\d+)?)\s*$/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lon: parseFloat(m[3]) };
}

async function geocode(text) {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", text);
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("limit", "1");
  const r = await fetch(u, { headers: { "User-Agent": "distance-edge/1.0" } });
  if (!r.ok) throw new Error(`geocode upstream ${r.status}`);
  const j = await r.json();
  if (!j.length) throw new Error("geocode not found");
  return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon) };
}

async function resolvePoint(s) {
  return parseLatLon(s) ?? geocode(s);
}

async function routeORS(a, b, key) {
  if (!key) throw new Error("ORS key missing");
  const r = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: [[a.lon, a.lat], [b.lon, b.lat]] })
  });

  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = null; }

  if (!r.ok) {
    const msg = j?.error?.message || j?.message || text?.slice(0, 200);
    throw new Error(`ORS upstream ${r.status}: ${msg}`);
  }

  const summary = j?.features?.[0]?.properties?.summary;
  if (!summary) {
    const msg = j?.error?.message || j?.message || "no route / unexpected payload";
    throw new Error(`ORS response missing summary: ${msg}`);
  }

  return { km: summary.distance / 1000, minutes: Math.round(summary.duration / 60) };
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);

    // Optional shared token
    const token = (globalThis.process && process.env && process.env.PUBLIC_TOKEN) || undefined;
    if (token) {
      const provided =
        url.searchParams.get("token") ||
        req.headers.get("x-token") ||
        (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      if (provided !== token) return json({ error: "unauthorized" }, 401);
    }

    const start = url.searchParams.get("start");
    const end   = url.searchParams.get("end");
    if (!start || !end) return json({ error: "Use ?start=<lat,lon|text>&end=<lat,lon|text>" }, 400);

    const [A, B] = await Promise.all([resolvePoint(start), resolvePoint(end)]);
    const orsKey = (globalThis.process && process.env && process.env.ORS_KEY) || undefined;
    const { km, minutes } = await routeORS(A, B, orsKey);

    const body = {
      distance_km: Math.round(km * 10) / 10,
      duration_min: minutes,
      source: "openrouteservice",
      confidence: 0.98,
      debug: url.searchParams.get("debug") === "1" ? { start_resolved: A, end_resolved: B } : undefined
    };
    return json(body);
  } catch (e) {
    return json({ error: e?.message || String(e) }, 502);
  }
}
