export default async function handler(req, res) {
  try {
    const code = String(req.query?.code || '').trim();
    if (!/^\d{4}$/.test(code)) return res.status(400).json({error:'invalid code'});

    const symbol = `${code}.TW`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m&includePrePost=false&events=div%2Csplits`;
    const r = await fetch(url, {headers:{'User-Agent':'Mozilla/5.0'}});
    if (!r.ok) throw new Error('history source failed: '+r.status);
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    if (!result) throw new Error(j?.chart?.error?.description || 'no intraday history');

    const ts = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const closes = q.close || [];
    const volumes = q.volume || [];
    const points = [];
    for (let i=0;i<ts.length;i++) {
      const price = Number(closes[i]);
      if (!Number.isFinite(price) || price<=0) continue;
      const d = new Date(ts[i]*1000);
      const time = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
      points.push({time, price:+price.toFixed(2), volume:Number(volumes[i]||0)});
    }

    res.setHeader('Cache-Control','s-maxage=20, stale-while-revalidate=30');
    res.status(200).json({source:'Yahoo Finance intraday', code, count:points.length, points});
  } catch (e) {
    res.status(500).json({error:String(e?.message||e)});
  }
}
