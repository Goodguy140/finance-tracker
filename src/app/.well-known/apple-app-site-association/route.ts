import { NextResponse } from "next/server";
import { appleAppId, appleAppSiteAssociation } from "@/lib/apple-app-site";

// Read at request time: `APPLE_APP_ID` comes from the container's environment, not the build.
export const dynamic = "force-dynamic";

/**
 * GET /.well-known/apple-app-site-association — public, outside the session gate
 * (`src/proxy.ts`). Apple's servers fetch it with no cookies and follow no redirects, and it
 * must be JSON. 404 unless this server is the phone app's home server (`APPLE_APP_ID`).
 */
export function GET() {
  const appId = appleAppId();
  if (!appId) return new NextResponse(null, { status: 404 });
  return NextResponse.json(appleAppSiteAssociation(appId), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
