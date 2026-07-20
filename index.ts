export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'industry';
    const sort = url.searchParams.get('sort') || 'f3';
    const order = url.searchParams.get('order') || 'desc';

    const EASTMONEY_API = 'https://push2.eastmoney.com/api/qt/clist/get';
    const SECTOR_TYPES: Record<string, string> = {
      industry: 'm:90 t:2',
      concept: 'm:999 t:2',
      region: 'm:90 t:3',
    };

    const fs = SECTOR_TYPES[type];
    if (!fs) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid type' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

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

    const json = await response.json();

    if (!json.data || !json.data.diff) {
      return new Response(JSON.stringify({ success: false, error: 'API 数据异常' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const items = json.data.diff.map((item: any) => ({
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

    return new Response(JSON.stringify({ success: true, data: { total: json.data.total, diff: items } }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
