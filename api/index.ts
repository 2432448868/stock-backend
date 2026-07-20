export interface Env {
  ENVIRONMENT: string;
}

// 东方财富 API
const EASTMONEY_API = 'https://push2.eastmoney.com/api/qt/clist/get';

// 板块类型映射
const SECTOR_TYPES = {
  industry: 'm:90 t:2',
  concept: 'm:999 t:2',
  region: 'm:90 t:3',
} as const;

interface SectorItem {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  amount: number;
  turnoverRate: number;
  upCount: number;
  downCount: number;
  flatCount: number;
}

interface ApiResponse {
  success: boolean;
  data?: {
    total: number;
    diff: SectorItem[];
  };
  error?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    try {
      const url = new URL(request.url);
      const type = url.searchParams.get('type') as keyof typeof SECTOR_TYPES;
      const sort = url.searchParams.get('sort') || 'f3';
      const order = (url.searchParams.get('order') as 'asc' | 'desc') || 'desc';

      if (!type || !SECTOR_TYPES[type]) {
        return jsonResponse({
          success: false,
          error: 'Invalid type. Use: industry, concept, region',
        });
      }

      const result = await fetchSectorData(type, sort, order);
      return jsonResponse({ success: true, data: result });
    } catch (error) {
      return jsonResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
};

async function fetchSectorData(
  type: keyof typeof SECTOR_TYPES,
  sort: string,
  order: 'asc' | 'desc'
): Promise<{ total: number; diff: SectorItem[] }> {
  const fs = SECTOR_TYPES[type];
  const params = new URLSearchParams({
    fs,
    fid: sort,
    po: order === 'desc' ? '1' : '0',
    pz: '50',
    pn: '1',
    np: '1',
    fltt: '2',
    invt: '2',
    fields: 'f1,f2,f3,f4,f12,f14,f15,f16,f17,f18,f20,f21,f104,f105,f106,f107,f128,f136,f140,f141',
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

  const json = await response.json();

  if (!json.data || !json.data.diff) {
    throw new Error('API 返回数据格式异常');
  }

  const items: SectorItem[] = json.data.diff.map((item: any) => ({
    code: item.f12,
    name: item.f14,
    price: item.f2 / 100,
    change: item.f4 / 100,
    changePercent: item.f3 / 100,
    volume: item.f5,
    amount: item.f6,
    turnoverRate: item.f8 / 100,
    upCount: item.f104,
    downCount: item.f105,
    flatCount: item.f106,
  }));

  return {
    total: json.data.total,
    diff: items,
  };
}

function jsonResponse(data: any): Response {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
