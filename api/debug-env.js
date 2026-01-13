export const config = { runtime: "edge" };
export default async () => {
  const present = !!(globalThis.process && process.env && process.env.ORS_KEY);
  return new Response(JSON.stringify({ ors_key_present: present }), {
    headers: { "Content-Type": "application/json" }
  });
};
