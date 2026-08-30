import { CURRENT_APP_VERSION } from "@/lib/app-update";

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(CURRENT_APP_VERSION, {
    headers: {
      "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
