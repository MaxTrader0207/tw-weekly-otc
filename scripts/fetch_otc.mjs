// 台股週報｜上櫃資料抓取（GitHub Actions 每個交易日執行）
// 來源：證券櫃檯買賣中心（櫃買中心）公開資料
//   - 上櫃股票每日收盤行情：/www/zh-tw/afterTrading/dailyQuotes
//   - 三大法人買賣明細：/www/zh-tw/insti/dailyTrade
// 產出：data/otc_week.json（台股週報 Worker 每天 19:00、22:00 讀取這一個檔案）
// 原則：查不到就不寫，格式不符就讓整次執行失敗，不產生錯誤數字。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, 'cache'), OUT = path.join(ROOT, 'data');
const BASE = 'https://www.tpex.org.tw/www/zh-tw';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const KLINE_DAYS = 20, LOOKBACK_CAL_DAYS = 45, KEEP_CACHE_DAYS = 60;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const slash = d => `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
const addD = (d, n) => new Date(d.getTime() + n * 864e5);
const num = s => { if (s == null) return null; const t = String(s).replace(/,/g, '').replace(/\s/g, ''); if (!t || /^-+$/.test(t)) return null; const v = +t; return Number.isFinite(v) ? v : null; };
const isStock = c => /^[1-9]\d{3}$/.test(c);   // 上櫃普通股（排除 ETF、債券、權證等）
const twNow = () => new Date(Date.now() + 8 * 3600e3);
const twToday = () => { const t = twNow(); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())); };

async function getJ(url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, {headers: {'User-Agent': UA, 'Accept': 'application/json,text/plain,*/*', 'Referer': 'https://www.tpex.org.tw/'}, redirect: 'manual', signal: AbortSignal.timeout(30000)});
      if (r.status >= 300 && r.status < 400) throw new Error(`HTTP ${r.status} 轉址到 ${r.headers.get('location')}（可能被擋）`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { last = e; console.log(`  第 ${i + 1} 次失敗：${e.message}`); await sleep(3000 * (i + 1)); }
  }
  throw last;
}

// 每日收盤行情 → {code: [名稱, 收盤, 漲跌, 開盤, 最高, 最低, 均價, 成交股數, 成交金額, 發行股數]}
async function fetchQuotes(d) {
  const j = await getJ(`${BASE}/afterTrading/dailyQuotes?date=${encodeURIComponent(slash(d))}&type=EW&response=json`);
  const t = (j.tables || [])[0];
  if (!t || !(t.data || []).length) return null;                     // 非交易日或尚未公布
  if (j.date && j.date !== ymd(d)) return null;                      // 回傳的不是要查的那天
  const F = (t.fields || []).map(s => String(s).replace(/\s/g, ''));
  const col = n => F.findIndex(f => f === n || f.startsWith(n));
  const ix = ['名稱', '收盤', '漲跌', '開盤', '最高', '最低', '均價', '成交股數', '成交金額', '發行股數'].map(col);
  if (F[0] !== '代號' || ix.some(i => i < 0)) throw new Error('收盤行情格式不符：' + F.join(','));
  const o = {};
  for (const r of t.data) {
    const c = String(r[0]).trim(); if (!isStock(c)) continue;
    const v = ix.map((i, k) => k === 0 ? String(r[i]).trim() : num(r[i]));
    if (v[1] == null) continue;                                       // 當日無成交
    o[c] = v;
  }
  return Object.keys(o).length > 100 ? o : null;
}

// 三大法人買賣明細 → {code: [外資及陸資合計買賣超, 投信買賣超, 自營商合計買賣超]}（股）
async function fetchInsti(d) {
  const j = await getJ(`${BASE}/insti/dailyTrade?type=Daily&sect=EW&date=${encodeURIComponent(slash(d))}&response=json`);
  const t = (j.tables || [])[0];
  if (!t || !(t.data || []).length) return null;
  if (j.date && j.date !== ymd(d)) return null;
  const F = (t.fields || []).map(String);
  if (F.length < 24 || F[0] !== '代號' || !/合計/.test(F[23])) throw new Error('三大法人格式不符：' + F.join(','));
  // 欄位順序：外資(不含自營) 2-4、外資自營 5-7、外資合計 8-10、投信 11-13、自營(自行) 14-16、自營(避險) 17-19、自營合計 20-22、三大法人合計 23
  let checked = 0;
  const o = {};
  for (const r of t.data) {
    const c = String(r[0]).trim(), v = r.map(num);
    if (checked < 30 && v[23] != null) {                              // 用加總關係驗證欄位位置沒有改變
      if (v[10] !== (v[4] || 0) + (v[7] || 0) || v[22] !== (v[16] || 0) + (v[19] || 0) || v[23] !== (v[10] || 0) + (v[13] || 0) + (v[22] || 0)) throw new Error(`三大法人欄位加總不符（${c}），可能已改版`);
      checked++;
    }
    if (isStock(c)) o[c] = [v[10] || 0, v[13] || 0, v[22] || 0];
  }
  return Object.keys(o).length > 50 ? o : null;
}

const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

async function main() {
  fs.mkdirSync(CACHE, {recursive: true}); fs.mkdirSync(OUT, {recursive: true});
  const today = twToday();
  const tradeDays = [];   // 由新到舊
  let fetched = 0;
  for (let k = 0; k <= LOOKBACK_CAL_DAYS && tradeDays.length < KLINE_DAYS + 6; k++) {
    const d = addD(today, -k), dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const f = path.join(CACHE, ymd(d) + '.json');
    let c = readJ(f);
    if (c && c.closed) continue;
    if (!c || !c.i) {                                                   // 沒有快取，或三大法人還沒抓到
      const q = c && c.q ? c.q : await fetchQuotes(d); await sleep(1500);
      if (!q) { if (k >= 2) fs.writeFileSync(f, JSON.stringify({closed: true})); continue; }   // 兩天前仍查無資料＝休市
      const i = await fetchInsti(d); await sleep(1500); fetched++;
      console.log(`${slash(d)}：行情 ${Object.keys(q).length} 檔、三大法人 ${i ? Object.keys(i).length + ' 檔' : '尚未公布'}`);
      c = {date: slash(d), q, i: i || null};
      fs.writeFileSync(f, JSON.stringify(c));
    }
    tradeDays.push({d, c});
  }
  // 最新一個「行情與三大法人都齊全」的交易日
  const ready = tradeDays.filter(x => x.c.i);
  if (!ready.length) throw new Error('近期沒有完整的上櫃資料');
  const L = ready[0].d, mon = addD(L, -((L.getUTCDay() + 6) % 7));
  const week = ready.filter(x => x.d >= mon).reverse();               // 由舊到新
  const baseDay = tradeDays.find(x => x.d < mon);
  if (!baseDay) throw new Error('找不到上週最後交易日');
  const kd = tradeDays.filter(x => x.d <= L).slice(0, KLINE_DAYS).reverse();

  const lastQ = week[week.length - 1].c.q, codes = Object.keys(lastQ);
  const out = {
    v: 1, source: '證券櫃檯買賣中心（上櫃股票每日收盤行情、三大法人買賣明細）',
    generatedAt: twNow().toISOString().replace('T', ' ').slice(0, 16) + '（台灣時間）',
    base: slash(baseDay.d), days: week.map(x => slash(x.d)),
    names: Object.fromEntries(codes.map(c => [c, lastQ[c][0]])),
    issued: Object.fromEntries(codes.filter(c => lastQ[c][9]).map(c => [c, lastQ[c][9]])),
    // 每日行情：[收盤, 漲跌, 均價, 成交金額]（基準日＋本週各交易日）
    q: Object.fromEntries([baseDay, ...week].map(x => [slash(x.d), Object.fromEntries(Object.entries(x.c.q).map(([c, v]) => [c, [v[1], v[2], v[6], v[8]]]))])),
    // 每日三大法人買賣超股數：[外資, 投信, 自營商]
    i: Object.fromEntries(week.map(x => [slash(x.d), x.c.i])),
    // 近 20 日 K 線：dates 與每檔 [開, 高, 低, 收] 對齊，無成交為 null
    k: {dates: kd.map(x => slash(x.d)), d: Object.fromEntries(codes.map(c => [c, kd.map(x => { const v = x.c.q[c]; return v && v[3] != null ? [v[3], v[4], v[5], v[1]] : null; })]))},
  };
  fs.writeFileSync(path.join(OUT, 'otc_week.json'), JSON.stringify(out));
  // 清掉太舊的快取
  for (const f of fs.readdirSync(CACHE)) { const m = f.match(/^(\d{4})(\d{2})(\d{2})\.json$/); if (m && Date.UTC(+m[1], +m[2] - 1, +m[3]) < addD(today, -KEEP_CACHE_DAYS).getTime()) fs.unlinkSync(path.join(CACHE, f)); }
  console.log(`完成：本週 ${out.days.join('、')}（基準日 ${out.base}），${codes.length} 檔；K 線 ${kd.length} 日；本次新抓 ${fetched} 日`);
}

main().catch(e => { console.error('失敗：' + e.message); process.exit(1); });
