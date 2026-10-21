export const dynamic = 'force-dynamic';
function retired() {
  return Response.json({ error: 'API credentials are managed in n8n. Dashboard setup is no longer used.' }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}
export const GET = retired;
export const POST = retired;

