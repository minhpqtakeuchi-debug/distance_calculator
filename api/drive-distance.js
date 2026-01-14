export const config = { runtime: "edge" };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// Accepts "lat,lon" or "lat lon"
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

  // Nominatim requires a valid User-Agent identifying your app
  const r = await fetch(u.toString(), {
    headers: { "User-Agent": "distance-calculator/1.0 (vercel-edge)" }
  });

  const bodyText = await r.text();
  let j = null;
  try { j = JSON.parse(bodyText); } catch {}

  if (!r.ok) {
    throw new Error(`geocode upstream ${r.status}: ${bodyText.slice(0, 200)}`);
  }
  if (!Array.isArray(j) || j.length === 0) {
    throw new Error("geocode not found");
  }

  return { lat: parseFloat(j[0].lat), lon: parseFloat(j[0].lon) };
}

async function resolvePoint(s) {
  return parseLatLon(s) ?? geocode(s);
}

async function routeORS(a, b, key) {
  if (!key) throw new Error("ORS key missing (set ORS_KEY env var)");

  const r = await fetch("https://api.openrouteservice.org/v2/directions/driving-car", {
    method: "POST",
    headers: {
      Authorization: key,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ coordinates: [[a.lon, a.lat], [b.lon, b.lat]] })
  });

  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}

  if (!r.ok) {
    const msg = j?.error?.message || j?.message || text.slice(0, 200);
    throw new Error(`ORS upstream ${r.status}: ${msg}`);
  }

  // ✅ Fix: ORS directions JSON typically returns { routes: [ { summary: ... } ] }
  const summary =
    j?.routes?.[0]?.summary ||
    j?.features?.[0]?.properties?.summary; // fallback if ORS returns geojson variant

  if (!summary) {
    throw new Error("ORS response missing summary (unexpected payload)");
  }

  return {
    km: summary.distance / 1000,
    minutes: Math.round(summary.duration / 60)
  };
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");

    if (!start || !end) {
      return json({ error: "Use ?start=<lat,lon|text>&end=<lat,lon|text>" }, 400);
    }

    const [A, B] = await Promise.all([resolvePoint(start), resolvePoint(end)]);

    const orsKey = process.env.ORS_KEY || "";
    const { km, minutes } = await routeORS(A, B, orsKey);

    const out = {
      distance_km: Math.round(km * 10) / 10,
      duration_min: minutes,
      source: "openrouteservice",
      debug: url.searchParams.get("debug") === "1" ? { start_resolved: A, end_resolved: B } : undefined
    };

    return json(out, 200);
  } catch (e) {
    return json({ error: e?.message || String(e) }, 502);
  }
}
