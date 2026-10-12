import { getServerConfig } from "@/lib/server-config";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(getServerConfig().publicConfig, { headers: { "Cache-Control": "no-store" } });
}
