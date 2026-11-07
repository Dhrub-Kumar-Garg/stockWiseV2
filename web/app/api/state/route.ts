import {NextResponse} from "next/server";
import path from "node:path";
import {dashboardAccess} from "../../../../scripts/v2/dashboard.mjs";
import {readDashboard} from "../../../../scripts/v2/paper_store.mjs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export async function GET(request: Request) {
  const secret = process.env.STOCKWISE_DASHBOARD_TOKEN;
  if (secret && secret !== "disabled" && secret !== "none" && secret !== "false" && process.env.STOCKWISE_AUTH_DISABLED !== "true") {
    const access = dashboardAccess(request.headers);
    if (!access.ok) return NextResponse.json({error: access.error}, {status: access.status, headers: {"Cache-Control": "no-store"}});
  }
  const data = process.env.STOCKWISE_DATA_DIR || path.resolve(process.cwd(), "../data/paper");
  try {return NextResponse.json(readDashboard(data),{headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
  catch {return NextResponse.json({error:"Paper data unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});}
}
