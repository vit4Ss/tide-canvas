import { getServerConfig } from "@/lib/server-config";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ status: "ok", environment: getServerConfig().environment }, { headers: { "Cache-Control": "no-store" } });
}
