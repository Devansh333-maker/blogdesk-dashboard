import {saveBlogSummary} from '@/lib/blog-summaries';
import {enrichPublicationRows} from '@/lib/publication-metadata';
export const dynamic = 'force-dynamic';

type DataPayload = Record<string, unknown> | unknown[];

type DataRow = Record<string, unknown>;

async function readTable(endpoint: string): Promise<DataPayload> {
  const response = await fetch(endpoint, {
    headers: process.env.N8N_BLOGS_API_KEY
      ? { Authorization: `Bearer ${process.env.N8N_BLOGS_API_KEY}` }
      : undefined,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`n8n returned ${response.status}`);
  return response.json() as Promise<DataPayload>;
}

function streamedJson(task: () => Promise<Record<string, unknown>>) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Start the response immediately and keep it active while the existing
      // n8n aggregator finishes its (sometimes multi-minute) read-only scan.
      controller.enqueue(encoder.encode('\n'));
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(' \n')), 10_000);

      void task()
        .then((payload) => controller.enqueue(encoder.encode(JSON.stringify(payload))))
        .catch(() => controller.enqueue(encoder.encode(JSON.stringify({
          source: 'preview',
          syncedAt: new Date().toISOString(),
          warning: 'The latest data could not be loaded. Your previous dashboard counts have been kept.',
        }))))
        .finally(() => {
          clearInterval(heartbeat);
          controller.close();
        });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function asObject(payload: DataPayload) {
  return Array.isArray(payload) ? {} : payload;
}

function rowsFrom(payload: DataPayload): DataRow[] {
  if (Array.isArray(payload)) return payload.filter((row): row is DataRow => Boolean(row) && typeof row === 'object');
  for (const key of ['rows', 'data', 'items', 'results']) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) return candidate.filter((row): row is DataRow => Boolean(row) && typeof row === 'object');
  }
  return [];
}

function variationId(row: DataRow) {
  const event = String(row.event_type ?? row.blog_type ?? row.type ?? '').toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');
  const aliases: Record<string, string> = {
    FRESH_52W_HIGH: '52wh', '52W_HIGH': '52wh', '52WH': '52wh',
    FRESH_52W_LOW: '52wl', '52W_LOW': '52wl', '52WL': '52wl',
    PRICE_RISE: 'price-rise', PRICE_FALL: 'price-fall',
    UPPER_CIRCUIT: 'upper-circuit', LOWER_CIRCUIT: 'lower-circuit',
  };
  return aliases[event];
}

function groupRows(payloads: DataPayload[]) {
  const grouped: Record<string, DataRow[]> = {};
  payloads.flatMap(rowsFrom).forEach((row) => {
    const id = variationId(row);
    if (!id) return;
    grouped[id] = [...(grouped[id] ?? []), normalizePayload(row)];
  });
  return grouped;
}

function displayStatus(value: unknown) {
  const status = String(value ?? '').trim().toLowerCase();
  if (['publish', 'published', 'published_verified', 'updated'].includes(status)) return 'Published';
  if (['processing', 'running', 'locked'].includes(status)) return 'Processing';
  if (['failed', 'error'].includes(status)) return 'Failed';
  return value;
}

function normalizePayload<T>(value: T): T {
  if (Array.isArray(value)) return value.map(normalizePayload) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      key === 'status' ? displayStatus(item) : normalizePayload(item),
    ])) as T;
  }
  return value;
}

export async function GET(request: Request) {
  const unified = process.env.N8N_BLOGS_WEBHOOK_URL;
  const categoryEndpoint = process.env.N8N_SYSTEM1_WEBHOOK_URL ?? process.env.N8N_CATEGORY_BLOGS_WEBHOOK_URL;
  const circuitEndpoint = process.env.N8N_CIRCUIT_BLOGS_WEBHOOK_URL;
  const marketEndpoint = process.env.N8N_MARKET_BLOGS_WEBHOOK_URL;

  if (!unified && !categoryEndpoint && !circuitEndpoint && !marketEndpoint) {
    return Response.json({ source: 'preview', syncedAt: new Date().toISOString(), warning: 'Connect the read-only n8n webhook URLs to refresh live data.' });
  }

  // The hosting layer limits a single outbound request to roughly two minutes,
  // while the read-only aggregator can take longer. A browser-side refresh may
  // follow this redirect and wait for n8n without that server-side limit.
  if (unified && new URL(request.url).searchParams.has('direct')) {
    return Response.redirect(unified, 307);
  }

  return streamedJson(async () => {
    if (unified) {
      const payload = await readTable(unified);
      const data = Array.isArray(payload) ? { marketJobs: payload } : payload;
      const normalized = normalizePayload(data);
      const groupedRows = groupRows([payload]);
      const rowsByVariation = Object.keys(groupedRows).length
        ? groupedRows
        : (normalized.rowsByVariation ?? {});
      const classified = await enrichPublicationRows(rowsByVariation as Record<string,DataRow[]>, String(normalized.tradingDate || ''));
      const result = { ...normalized, rowsByVariation: classified, source: 'n8n', syncedAt: new Date().toISOString() };
      // A summary-cache failure must not discard a successful live blog read.
      try { await saveBlogSummary(result as unknown as Parameters<typeof saveBlogSummary>[0]); } catch { /* previous summary retained */ }
      return result;
    }

    const [categoryPayload, circuitPayload, marketPayload] = await Promise.all([
      categoryEndpoint ? readTable(categoryEndpoint) : Promise.resolve({}),
      circuitEndpoint ? readTable(circuitEndpoint) : Promise.resolve({}),
      marketEndpoint ? readTable(marketEndpoint) : Promise.resolve({}),
    ]);
    const category = asObject(categoryPayload);
    const market = asObject(marketPayload);

    return {
      ...normalizePayload(category),
      ...normalizePayload(market),
      categoryPosts: normalizePayload(Array.isArray(categoryPayload) ? categoryPayload : category.categoryPosts),
      marketJobs: normalizePayload(Array.isArray(marketPayload) ? marketPayload : market.marketJobs),
      rowsByVariation: groupRows([categoryPayload, circuitPayload]),
      source: 'n8n',
      syncedAt: new Date().toISOString(),
    };
  });
}
