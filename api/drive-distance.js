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
  if (!r.ok) throw new Error("geocode upstream");
  const j = await r.json();
  if (!j.length) throw new Error("geocode not found");
  return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon) };
}

async function resolvePoint(s) {
  const asCoord = parseLatLon(s);
  return asCoord ?? geocode(s);
}

async function routeORS(a, b, key) {
  if (!key) throw new Error("ORS key missing");
  const r = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: [[a.lon, a.lat], [b.lon, b.lat]] })
  });
  if (!r.ok) throw new Error("ORS upstream");
  const j = await r.json();
  const s = j.features[0].properties.summary;
  return { km: s.distance / 1000, minutes: Math.round(s.duration / 60) };
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);

    const token = (globalThis.process && process.env && process.env.PUBLIC_TOKEN) || undefined;
    if (token && url.searchParams.get("token") !== token) {
      return json({ error: "unauthorized" }, 401);
    }

    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    if (!start || !end) {
      return json({ error: "Use ?start=<lat,lon|text>&end=<lat,lon|text>" }, 400);
    }

    const [A, B] = await Promise.all([resolvePoint(start), resolvePoint(end)]);
    const orsKey = (globalThis.process && process.env && process.env.ORS_KEY) || undefined;
    const { km, minutes } = await routeORS(A, B, orsKey);

    return json({
      distance_km: Math.round(km * 10) / 10,
      duration_min: minutes,
      source: "openrouteservice",
      confidence: 0.98
    });
  } catch (e) {
    return json({ error: (e && e.message) || String(e) }, 502);
  }
}
