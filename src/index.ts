export interface Env {
  STOCK_CACHE: KVNamespace;
  ENVIRONMENT: string;
}

const EASTMONEY_API = 'https://push2.eastmoney.com/api/qt/clist/get';

const SECTOR_TYPES = {
  industry: 'm:90 t:2',
  concept: 'm:90 t:3',
  region: 'm:90 t:1',
} as const;

/** 缓存 TTL：10 秒，保证近实时 */
const CACHE_TTL = 10;

/** 请求超时：5 秒，防止东方财富卡死拖垮 Worker */
const FETCH_TIMEOUT = 5000;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // 诊断接口：排查连通性
    if (url.pathname === '/health') {
      return handleHealthCheck(env);
    }

    try {
      const type = url.searchParams.get('type') as keyof typeof SECTOR_TYPES | null;
      const sort = url.searchParams.get('sort') || 'f3';
      const order = (url.searchParams.get('order') as 'asc' | 'desc') || 'desc';

      if (!type || !SECTOR_TYPES[type]) {
        return json({ success: false, error: '参数 type 无效，可选：industry, concept, region' }, 400);
      }

      const data = await getCachedSectorData(env, type, sort, order);
      return json({ success: true, data });
    } catch (error) {
      const errMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      return json({ success: false, error: errMsg }, 500);
    }
  },
};

/** 诊断接口：检查 KV 连通性 + 东方财富 API 连通性 */
async function handleHealthCheck(env: Env): Promise<Response> {
  const checks: Record<string, any> = {};

  // 检查 KV 绑定
  checks.kv_bound = !!env.STOCK_CACHE;
  if (env.STOCK_CACHE) {
    try {
      await env.STOCK_CACHE.get('__health_check__');
      checks.kv_accessible = true;
    } catch (e: any) {
      checks.kv_accessible = false;
      checks.kv_error = e.message;
    }
  }

  // 检查东方财富 API 连通性
  try {
    const testUrl = `${EASTMONEY_API}?${new URLSearchParams({
      fs: SECTOR_TYPES.industry,
      fid: 'f3', po: '1', pz: '1', pn: '1', np: '1', fltt: '2', invt: '2',
      fields: 'f12,f14',
    })}`;
    const res = await fetchWithTimeout(testUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://quote.eastmoney.com/',
      },
    });
    checks.eastmoney_status = res.status;
    checks.eastmoney_ok = res.ok;
    if (res.ok) {
      const data: any = await res.json();
      checks.eastmoney_has_data = !!(data?.data?.diff);
    } else {
      checks.eastmoney_body = await res.text();
    }
  } catch (e: any) {
    checks.eastmoney_ok = false;
    checks.eastmoney_error = `${e.name}: ${e.message}`;
  }

  return json({ success: true, checks });
}

/** 带 KV 缓存的板块数据获取 */
async function getCachedSectorData(
  env: Env,
  type: keyof typeof SECTOR_TYPES,
  sort: string,
  order: 'asc' | 'desc'
) {
  const cacheKey = `sector:${type}:${sort}:${order}`;

  // 优先读缓存
  if (env.STOCK_CACHE) {
    const cached = await env.STOCK_CACHE.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  // 缓存未命中，请求东方财富
  const data = await fetchSectorData(type, sort, order);

  // 写入 KV 缓存
  if (env.STOCK_CACHE) {
    await env.STOCK_CACHE.put(cacheKey, JSON.stringify(data), { expirationTtl: CACHE_TTL });
  }

  return data;
}

/** 请求东方财富 API */
async function fetchSectorData(
  type: keyof typeof SECTOR_TYPES,
  sort: string,
  order: 'asc' | 'desc'
) {
  const params = new URLSearchParams({
    fs: SECTOR_TYPES[type],
    fid: sort,
    po: order === 'desc' ? '1' : '0',
    pz: '50',
    pn: '1',
    np: '1',
    fltt: '2',
    invt: '2',
    fields: 'f1,f2,f3,f4,f5,f6,f8,f12,f14,f15,f16,f17,f18,f20,f21,f104,f105,f106,f107,f128,f136,f140,f141',
  });

  const response = await fetchWithTimeout(`${EASTMONEY_API}?${params}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://quote.eastmoney.com/',
    },
  });

  if (!response.ok) {
    throw new Error(`东方财富 API 请求失败：${response.status}`);
  }

  const result: any = await response.json();

  if (!result.data?.diff) {
    throw new Error('API 返回数据格式异常');
  }

  return {
    total: result.data.total,
    timestamp: Date.now(),
    diff: result.data.diff.map((item: any) => ({
      code: item.f12,
      name: item.f14,
      price: item.f2 / 100,
      changePercent: item.f3 / 100,
      change: item.f4 / 100,
      volume: item.f5,
      amount: item.f6,
      turnoverRate: item.f8 / 100,
      upCount: item.f104,
      downCount: item.f105,
      flatCount: item.f106,
      high: item.f15 / 100,
      low: item.f16 / 100,
      open: item.f17 / 100,
      prevClose: item.f18 / 100,
      marketCap: item.f20,
      floatCap: item.f21,
      leadingStock: item.f128 || '',
      leadingStockCode: item.f140 || '',
      leadingStockChange: item.f136 ? item.f136 / 100 : 0,
    })),
  };
}

/** JSON 响应（统一带 CORS 头） */
function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
    },
  });
}

/** 带超时的 fetch，防止外部 API 卡死 */
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`请求超时（${FETCH_TIMEOUT}ms）：${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
