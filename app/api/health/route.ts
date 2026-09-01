export function GET() {
  return Response.json({ status: "ok", service: "villix-manager" }, {
    headers: { "cache-control": "no-store" },
  });
}
