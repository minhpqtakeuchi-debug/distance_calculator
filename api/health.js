export const config = { runtime: "edge" };
export default async () =>
  new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" }
  });
