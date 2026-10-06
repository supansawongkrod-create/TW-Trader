export default async function handler(req, res) {
  try {
    const mode = req.query?.mode === 'all' ? 'all' : 'under40';
    const ua = {'User-Agent':'Mozilla/5.0','Referer':'https://mis.twse.com.tw/'};
    const dayUrl = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
    const dayResp = await fetch(dayUrl, {headers: {'Accept':'application/json'}});
    if (!dayResp.ok) throw new Error('TWSE OpenAPI failed: '+dayResp.status);
    const day = await dayResp.json();

    let candidates = day
      .map(x => ({
        code: String(x.Code || '').trim(),
        name: String(x.Name || '').trim(),
        close: Number(String(x.ClosingPrice || '0').replace(/,/g,'')) || 0,
        prevVolume: Number(String(x.TradeVolume || '0').replace(/,/g,'')) || 0
      }))
      .filter(x => /^\d{4}$/.test(x.code) && x.close > 0);

    if (mode === 'under40') candidates = candidates.filter(x => x.close <= 42);

    const batchSize = 50;
    const batches = [];
    for (let i=0; i<candidates.length; i+=batchSize) batches.push(candidates.slice(i,i+batchSize));

    const results = await Promise.all(batches.map(async batch => {
      try {
        const ex = batch.map(x => `tse_${x.code}.tw`).join('|');
        const u = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(ex)}&json=1&delay=0`;
        const r = await fetch(u, {headers: ua});
        if (!r.ok) return [];
        const j = await r.json();
        const infos = Array.isArray(j.msgArray) ? j.msgArray : [];
        const local = [];
        for (const q of infos) {
          const code = q.c;
          const base = batch.find(x => x.code===code);
          if (!base) continue;
          const price = Number(q.z || q.y || 0);
          const prev = Number(q.y || 0);
          const open = Number(q.o || 0);
          const high = Number(q.h || 0);
          const low = Number(q.l || 0);
          const volume = Number(q.v || 0);
          if (!price || (mode === 'under40' && price > 40)) continue;
          const changePct = prev ? (price-prev)/prev*100 : 0;
          const rangePos = (high>low) ? (price-low)/(high-low) : 0.5;
          const volRatio = base.prevVolume ? volume/base.prevVolume : 0;
          const liquidity = Math.min(1, volume/5000);
          let score = 50;
          score += Math.max(-15, Math.min(25, changePct*5));
          score += (rangePos-0.5)*20;
          score += Math.min(15, volRatio*30);
          score += liquidity*10;
          if (changePct > 6.5) score -= 12;
          score = Math.round(Math.max(0, Math.min(100, score)));
          local.push({
            code, name: q.n || base.name, price, prev, open, high, low, volume,
            changePct: +changePct.toFixed(2), score,
            ts: q.t || '', date: q.d || '', prevDayVolume: base.prevVolume
          });
        }
        return local;
      } catch { return []; }
    }));

    const out = results.flat();
    out.sort((a,b)=>b.score-a.score || b.volume-a.volume);
    res.setHeader('Cache-Control','s-maxage=5, stale-while-revalidate=10');
    res.status(200).json({source:'TWSE OpenAPI + MIS', mode, updatedAt:new Date().toISOString(), count:out.length, data:out.slice(0,30)});
  } catch (e) {
    res.status(500).json({error:String(e?.message||e)});
  }
}
