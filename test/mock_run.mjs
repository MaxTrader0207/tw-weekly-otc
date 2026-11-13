// 用模擬的櫃買中心回應跑一次抓取程式（不連網）
const QF = ['代號','名稱','收盤','漲跌','開盤','最高','最低','均價','成交股數','成交金額(元)','成交筆數','最後買價','最後買量(張數)','最後賣價','最後賣量(張數)','發行股數','次日 參考價','次日 漲停價','次日 跌停價'];
const IF = ['代號','名稱', ...Array(7).fill(0).flatMap(()=>['買進股數','賣出股數','買賣超股數']), '三大法人買賣超股數合計'];
const HOLI = new Set(['20261110']);  // 模擬一天休市
const TODAY = process.env.TODAY || '20261113';
const NOINSTI_TODAY = !!process.env.NOINSTI;
const BADFMT = !!process.env.BADFMT;
let calls = 0;
const codes = Array.from({length: 150}, (_, i) => String(3000 + i * 7));
globalThis.fetch = async (url) => {
  calls++;
  if (String(url).includes('detail/day.html')) {   // 產業別選單
    if (process.env.NOIND) return new Response('busy', {status: 503});
    return new Response('<select id="type"><option value="EW">所有證券</option><option value="02">食品工業</option>' + ['03塑膠工業','04紡織纖維','05電機機械','06電器電纜','21化學工業','08玻璃陶瓷','10鋼鐵工業','11橡膠工業','14建材營造','15航運業','16觀光餐旅','17金融業','20其他','22生技醫療','23油電燃氣','24半導體業','25電腦及週邊業','26光電業','27通信網路業','28電子零組件業','29電子通路業','30資訊服務業','31其他電子業','32文化創意業','33農業科技'].map(x => `<option value="${x.slice(0,2)}">${x.slice(2)}</option>`).join('') + '</select>', {status: 200});
  }
  if (String(url).includes('mopsfin_t187ap03_O')) {   // 上櫃公司基本資料（含產業別代碼）
    const all = [...codes, ...Array.from({length: 500}, (_, i) => String(6000 + i))];
    return new Response(JSON.stringify(all.map((c, i) => ({SecuritiesCompanyCode: c, CompanyAbbreviation: 'x', SecuritiesIndustryCode: ['24', '22', '17', '28'][i % 4]}))), {status: 200});
  }
  const u = decodeURIComponent(url); const ds = u.match(/date=(\d{4})\/(\d{2})\/(\d{2})/).slice(1).join('');
  const closed = HOLI.has(ds) || ds > TODAY;
  const J = o => new Response(JSON.stringify(o), {status: 200});
  if (u.includes('dailyQuotes')) {
    if (closed) return J({date: ds, stat: 'ok', tables: [{fields: QF, data: []}]});
    const k = +ds.slice(6);
    return J({date: ds, stat: 'ok', tables: [{fields: BADFMT ? QF.slice(1) : QF, data: [['006201','ETF','1','0','1','1','1','1','1','1','1','1','1','1','1','1','1','1','1'], ...codes.map((c, i) => { const cl = 50 + i + k * 0.5; return [c, '公司' + i, cl.toFixed(2), '0.50 ', (cl - 0.3).toFixed(2), (cl + 1).toFixed(2), (cl - 1).toFixed(2), cl.toFixed(2), '1,000,000', String(Math.round(cl * 1e6)), '100', '1', '1', '1', '1', String((i + 1) * 1e7), '1', '1', '1']; })]}]});
  }
  if (u.includes('dailyTrade')) {
    if (closed || (NOINSTI_TODAY && ds === TODAY)) return J({date: ds, stat: 'ok', tables: [{fields: IF, data: []}]});
    return J({date: ds, stat: 'ok', tables: [{fields: IF, data: codes.map((c, i) => { const f1 = (i - 70) * 1000, f2 = 100, it = i * 10, d1 = -50, d2 = 20; const r = [c, 'x', 0, 0, f1, 0, 0, f2, 0, 0, f1 + f2, 0, 0, it, 0, 0, d1, 0, 0, d2, 0, 0, d1 + d2, f1 + f2 + it + d1 + d2]; return r.map((v, k) => k < 2 ? v : Number(v).toLocaleString('en-US')); })}]});
  }
  return new Response('nope', {status: 404});
};
const RealDate = Date; const fake = new RealDate(TODAY.slice(0,4)+'-'+TODAY.slice(4,6)+'-'+TODAY.slice(6)+'T10:30:00Z').getTime();
Date.now = () => fake;
globalThis.setTimeout = (fn) => { fn(); return 0; };
await import('../scripts/fetch_otc.mjs');
await new Promise(r => setImmediate(r));
console.log('calls', calls);
