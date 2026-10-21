const DASHBOARD_TIME_ZONE = 'UTC';
const MODEL_USAGE_ENDPOINTS = [
  'completions',
  'embeddings',
  'moderations',
  'images',
  'audio_speeches',
  'audio_transcriptions',
  'web_search_calls',
] as const;

type UsageEndpoint = typeof MODEL_USAGE_ENDPOINTS[number];
type Bucket<T> = { start_time: number; end_time: number; results: T[] };
type BucketPage<T> = { data: Bucket<T>[]; has_more: boolean; next_page?: string | null };
type CostResult = {
  amount?: { value?: number; currency?: string };
  project_id?: string | null;
  line_item?: string | null;
  quantity?: number | null;
  quantity_unit?: string | null;
};
type UsageResult = {
  [key: string]: unknown;
  model?: string | null;
  num_model_requests?: number;
  input_tokens?: number;
  output_tokens?: number;
  input_cached_tokens?: number;
  input_audio_tokens?: number;
  output_audio_tokens?: number;
  images?: number;
  num_images?: number;
  characters?: number;
  seconds?: number;
  num_requests?: number;
};

export type CostAnalysis = {
  scope: { name: string; description: string };
  dailyUsage: { date: string; source: string; model: string; serviceTier: string | null; batch: boolean | null; metrics: Record<string, number | null> }[];
  period: {
    from: string;
    to: string;
    startTime: number;
    endTimeExclusive: number;
    timeZone: typeof DASHBOARD_TIME_ZONE;
  };
  actualBilledCosts: {
    source: 'OpenAI organization Costs API';
    status: 'ready' | 'unavailable';
    totalsByCurrency: { currency: string; amount: number }[];
    daily: { date: string; currency: string; amount: number }[];
    dailyLineItems: { date: string; currency: string; amount: number; lineItem: string | null; projectId: string | null }[];
    byProject: { projectId: string | null; projectName: string | null; currency: string; amount: number }[];
    byLineItem: {
      lineItem: string | null;
      currency: string;
      amount: number;
      quantities: { unit: string | null; value: number }[];
    }[];
  };
  usageByModel: {
    status: 'ready' | 'partial' | 'unavailable';
    models: {
      model: string;
      modelRequests: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cachedInputTokens: number;
      audioInputTokens: number;
      audioOutputTokens: number;
      images: number;
      speechCharacters: number;
      transcriptionSeconds: number;
      webSearchCalls: number;
      sources: string[];
    }[];
  };
  modelCostEstimates: {
    included: false;
    reason: string;
  };
  warnings: { section: string; code: 'temporarily_unavailable' | 'partial_data' }[];
  generatedAt: string;
};

export class OpenAIAdminError extends Error {
  constructor(public readonly code: 'auth' | 'rate_limit' | 'temporary' | 'request') {
    super(code);
  }
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function todayInIndia() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DASHBOARD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function istMidnightSeconds(value: string) {
  return Math.floor(Date.parse(`${value}T00:00:00Z`) / 1000);
}

export function parseCostDateRange(from: string, to: string) {
  if (!validDate(from) || !validDate(to) || from > to || to > todayInIndia()) return null;
  const startTime = istMidnightSeconds(from);
  const endTimeExclusive = istMidnightSeconds(to) + 86_400;
  const dayCount = Math.round((endTimeExclusive - startTime) / 86_400);
  if (dayCount < 1 || dayCount > 180) return null;
  return { from, to, startTime, endTimeExclusive, dayCount };
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isBucketPage<T>(value: unknown): value is BucketPage<T> {
  if (!value || typeof value !== 'object') return false;
  const page = value as Partial<BucketPage<T>>;
  return Array.isArray(page.data)
    && typeof page.has_more === 'boolean'
    && page.data.every((bucket) => bucket
      && typeof bucket === 'object'
      && Number.isFinite(bucket.start_time)
      && Number.isFinite(bucket.end_time)
      && Array.isArray(bucket.results));
}

async function openAIFetch(path: string, params: URLSearchParams) {
  const url = process.env.N8N_OPENAI_COSTS_WEBHOOK_URL;
  if (!url) throw new OpenAIAdminError('temporary');
  const resource = path.split('/').at(-1);
  const parameters = Object.fromEntries(params);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ resource, parameters }),
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      if (attempt < 2) continue;
      // This hop contains no OpenAI credential. Strip addresses from diagnostic text.
      const reason = error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[endpoint]').replace(/sk-\S+/g, '[redacted]').slice(0, 180) : 'Unknown transport failure';
      console.warn('OpenAI reporting transport unavailable', { endpoint: path, reason });
      throw new OpenAIAdminError('temporary');
    }
    if (response.ok) {
      try {
        return await response.json() as unknown;
      } catch {
        throw new OpenAIAdminError('temporary');
      }
    }
    // Log only fixed endpoint paths and status numbers, never response bodies or headers.
    console.warn('OpenAI reporting request failed', { endpoint: path, status: response.status });
    if (response.status === 401 || response.status === 403) throw new OpenAIAdminError('auth');
    if (response.status === 400 || response.status === 422) throw new OpenAIAdminError('request');
    if (response.status === 429) {
      if (attempt < 2) continue;
      throw new OpenAIAdminError('rate_limit');
    }
    if (response.status >= 500 && attempt < 2) continue;
    throw new OpenAIAdminError('temporary');
  }
  throw new OpenAIAdminError('temporary');
}

async function fetchBucketPages<T>(
  path: string,
  baseParams: URLSearchParams,
  maxPages: number,
) {
  const buckets: Bucket<T>[] = [];
  let page: string | undefined;
  let previousPage: string | undefined;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const params = new URLSearchParams(baseParams);
    if (page) params.set('page', page);
    const payload = await openAIFetch(path, params);
    if (!isBucketPage<T>(payload)) throw new OpenAIAdminError('temporary');
    buckets.push(...payload.data);
    if (!payload.has_more) return buckets;
    if (!payload.next_page || payload.next_page === page || payload.next_page === previousPage) {
      throw new OpenAIAdminError('temporary');
    }
    previousPage = page;
    page = payload.next_page;
  }
  throw new OpenAIAdminError('temporary');
}

function bucketParams(startTime: number, endTimeExclusive: number, limit: number, groups: string[]) {
  const params = new URLSearchParams({
    start_time: String(startTime),
    end_time: String(endTimeExclusive),
    bucket_width: '1d',
    limit: String(limit),
  });
  for (const group of groups) params.append('group_by[]', group);
  return params;
}

async function fetchCosts(startTime: number, endTimeExclusive: number) {
  return fetchBucketPages<CostResult>(
    '/organization/costs',
    bucketParams(startTime, endTimeExclusive, 180, ['project_id', 'line_item']),
    3,
  );
}

async function fetchUsage(
  endpoint: UsageEndpoint,
  startTime: number,
  endTimeExclusive: number,
  dayCount: number,
) {
  return fetchBucketPages<UsageResult>(
    `/organization/usage/${endpoint}`,
    bucketParams(startTime, endTimeExclusive, 31, ['model']),
    Math.ceil(dayCount / 31) + 2,
  );
}

async function fetchProjectNames() {
  const names = new Map<string, string>();
  let after: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ limit: '100', include_archived: 'true' });
    if (after) params.set('after', after);
    const payload = await openAIFetch('/organization/projects', params) as {
      data?: { id?: unknown; name?: unknown }[];
      has_more?: unknown;
      last_id?: unknown;
    };
    if (!Array.isArray(payload.data) || typeof payload.has_more !== 'boolean') return names;
    for (const project of payload.data) {
      if (typeof project.id === 'string' && typeof project.name === 'string') names.set(project.id, project.name);
    }
    if (!payload.has_more) return names;
    if (typeof payload.last_id !== 'string' || !payload.last_id || payload.last_id === after) return names;
    after = payload.last_id;
  }
  return names;
}

function dateInIndia(epochSeconds: number) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DASHBOARD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochSeconds * 1000));
}

function addAmount(map: Map<string, number>, key: string, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function aggregateCosts(buckets: Bucket<CostResult>[], projectNames: Map<string, string>) {
  const dailyLineItems: CostAnalysis['actualBilledCosts']['dailyLineItems'] = [];
  const totals = new Map<string, number>();
  const daily = new Map<string, number>();
  const projects = new Map<string, number>();
  const lineItems = new Map<string, { amount: number; quantities: Map<string, number> }>();
  for (const bucket of buckets) {
    const date = dateInIndia(bucket.start_time);
    for (const result of bucket.results) {
      const amount = finiteNumber(result.amount?.value);
      const currency = typeof result.amount?.currency === 'string' && result.amount.currency
        ? result.amount.currency.toLowerCase()
        : 'unknown';
      const projectId = typeof result.project_id === 'string' ? result.project_id : null;
      const lineItem = typeof result.line_item === 'string' ? result.line_item : null;
      dailyLineItems.push({ date, currency, amount, lineItem, projectId });
      addAmount(totals, currency, amount);
      addAmount(daily, JSON.stringify([date, currency]), amount);
      addAmount(projects, JSON.stringify([projectId, currency]), amount);
      const lineKey = JSON.stringify([lineItem, currency]);
      const line = lineItems.get(lineKey) ?? { amount: 0, quantities: new Map<string, number>() };
      line.amount += amount;
      if (Number.isFinite(result.quantity)) {
        const unit = typeof result.quantity_unit === 'string' ? result.quantity_unit : '';
        line.quantities.set(unit, (line.quantities.get(unit) ?? 0) + finiteNumber(result.quantity));
      }
      lineItems.set(lineKey, line);
    }
  }
  return {
    totalsByCurrency: [...totals].map(([currency, amount]) => ({ currency, amount })),
    dailyLineItems,
    daily: [...daily].map(([key, amount]) => {
      const [date, currency] = JSON.parse(key) as [string, string];
      return { date, currency, amount };
    }).sort((left, right) => left.date.localeCompare(right.date) || left.currency.localeCompare(right.currency)),
    byProject: [...projects].map(([key, amount]) => {
      const [projectId, currency] = JSON.parse(key) as [string | null, string];
      return { projectId, projectName: projectId ? projectNames.get(projectId) ?? null : null, currency, amount };
    }).sort((left, right) => right.amount - left.amount),
    byLineItem: [...lineItems].map(([key, value]) => {
      const [lineItem, currency] = JSON.parse(key) as [string | null, string];
      return {
        lineItem,
        currency,
        amount: value.amount,
        quantities: [...value.quantities].map(([unit, quantity]) => ({ unit: unit || null, value: quantity })),
      };
    }).sort((left, right) => right.amount - left.amount),
  };
}

function aggregateUsage(successful: { endpoint: UsageEndpoint; buckets: Bucket<UsageResult>[] }[]) {
  const models = new Map<string, Omit<CostAnalysis['usageByModel']['models'][number], 'totalTokens' | 'sources'> & { sources: Set<string> }>();
  for (const { endpoint, buckets } of successful) {
    for (const bucket of buckets) {
      for (const result of bucket.results) {
        const model = typeof result.model === 'string' && result.model ? result.model : 'Unspecified model';
        const row = models.get(model) ?? {
          model,
          modelRequests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          audioInputTokens: 0,
          audioOutputTokens: 0,
          images: 0,
          speechCharacters: 0,
          transcriptionSeconds: 0,
          webSearchCalls: 0,
          sources: new Set<string>(),
        };
        row.modelRequests += finiteNumber(result.num_model_requests);
        row.inputTokens += finiteNumber(result.input_tokens);
        row.outputTokens += finiteNumber(result.output_tokens);
        row.cachedInputTokens += finiteNumber(result.input_cached_tokens);
        row.audioInputTokens += finiteNumber(result.input_audio_tokens);
        row.audioOutputTokens += finiteNumber(result.output_audio_tokens);
        row.images += finiteNumber(result.images) || finiteNumber(result.num_images);
        row.speechCharacters += finiteNumber(result.characters);
        row.transcriptionSeconds += finiteNumber(result.seconds);
        row.webSearchCalls += finiteNumber(result.num_requests);
        row.sources.add(endpoint);
        models.set(model, row);
      }
    }
  }
  return [...models.values()].map((row) => ({
    ...row,
    totalTokens: row.inputTokens + row.outputTokens,
    sources: [...row.sources].sort(),
  })).sort((left, right) => right.totalTokens - left.totalTokens || right.modelRequests - left.modelRequests);
}

export async function getOpenAICostAnalysis(
  range: NonNullable<ReturnType<typeof parseCostDateRange>>,
): Promise<CostAnalysis> {
  const warnings: CostAnalysis['warnings'] = [];
  let costBuckets: Bucket<CostResult>[] = [];
  let costStatus: CostAnalysis['actualBilledCosts']['status'] = 'ready';
  try {
    costBuckets = await fetchCosts(range.startTime, range.endTimeExclusive);
  } catch (error) {
    if (error instanceof OpenAIAdminError && error.code === 'auth') throw error;
    costStatus = 'unavailable';
    warnings.push({ section: 'actual_billed_costs', code: 'temporarily_unavailable' });
  }

  let projectNames = new Map<string, string>();
  if (costStatus === 'ready') {
    try {
      projectNames = await fetchProjectNames();
    } catch {
      warnings.push({ section: 'project_names', code: 'partial_data' });
    }
  }

  const usageResults = await Promise.allSettled(MODEL_USAGE_ENDPOINTS.map(async (endpoint) => ({
    endpoint,
    buckets: await fetchUsage(endpoint, range.startTime, range.endTimeExclusive, range.dayCount),
  })));
  const successfulUsage: { endpoint: UsageEndpoint; buckets: Bucket<UsageResult>[] }[] = [];
  let authenticatedFailure = false;
  for (const result of usageResults) {
    if (result.status === 'fulfilled') successfulUsage.push(result.value);
    else if (result.reason instanceof OpenAIAdminError && result.reason.code === 'auth') authenticatedFailure = true;
  }
  if (authenticatedFailure && successfulUsage.length === 0) throw new OpenAIAdminError('auth');
  const usageStatus: CostAnalysis['usageByModel']['status'] = successfulUsage.length === MODEL_USAGE_ENDPOINTS.length
    ? 'ready'
    : successfulUsage.length > 0 ? 'partial' : 'unavailable';
  if (usageStatus !== 'ready') {
    warnings.push({
      section: 'usage_by_model',
      code: usageStatus === 'partial' ? 'partial_data' : 'temporarily_unavailable',
    });
  }

  const costs = aggregateCosts(costBuckets, projectNames);
  return {
    scope: { name: 'blog-news-automation', description: 'Default project · blog-news-automation API activity only' },
    dailyUsage: successfulUsage.flatMap(({ endpoint, buckets }) => buckets.flatMap(bucket => bucket.results.map(result => ({
      date: dateInIndia(bucket.start_time), source: endpoint,
      model: typeof result.model === 'string' ? result.model : 'Unspecified model',
      serviceTier: typeof result.service_tier === 'string' ? result.service_tier : null,
      batch: typeof result.batch === 'boolean' ? result.batch : null,
      metrics: Object.fromEntries(['num_model_requests','input_tokens','output_tokens','input_cached_tokens','input_cache_write_tokens','input_uncached_tokens','input_text_tokens','output_text_tokens','input_cached_text_tokens','input_audio_tokens','input_cached_audio_tokens','output_audio_tokens','input_image_tokens','input_cached_image_tokens','output_image_tokens','images','characters','seconds','num_requests'].map(key => [key, typeof result[key] === 'number' && Number.isFinite(result[key]) ? result[key] as number : null])),
    })))).sort((a,b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model)),
    period: {
      from: range.from,
      to: range.to,
      startTime: range.startTime,
      endTimeExclusive: range.endTimeExclusive,
      timeZone: DASHBOARD_TIME_ZONE,
    },
    actualBilledCosts: {
      source: 'OpenAI organization Costs API',
      status: costStatus,
      ...costs,
    },
    usageByModel: { status: usageStatus, models: aggregateUsage(successfulUsage) },
    modelCostEstimates: {
      included: false,
      reason: 'Usage grouped by model is not reconciled to billed costs. Actual costs come only from the organization Costs API.',
    },
    warnings,
    generatedAt: new Date().toISOString(),
  };
}
