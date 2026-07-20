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

    try {
      const url = new URL(request.url);
      const type = url.searchParams.get('type') as keyof typeof SECTOR_TYPES | null;
      const sort = url.searchParams.get('sort') || 'f3';
      const order = (url.searchParams.get('order') as 'asc' | 'desc') || 'desc';

      if (!type || !SECTOR_TYPES[type]) {
        return json({ success: false, error: '参数 type 无效，可选：industry, concept, region' }, 400);
      }

      const data = await getCachedSectorData(env, type, sort, order);
      return json({ success: true, data });
    } catch (error) {
      return json({
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      }, 500);
    }
  },
};

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

  const response = await fetch(`${EASTMONEY_API}?${params}`, {
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
