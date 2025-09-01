/* ====== สถานะหลักของแอป ====== */
const state = {
  settings: { fiatCurrency: "THB", btcUnit: "BTC" },
  price: { value: null, currency: "THB", updatedAt: null },
  txs: [],
  deferredPrompt: null,
};

/* ====== Utils ====== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const format = (v, max = 2) => new Intl.NumberFormat("th-TH", { maximumFractionDigits: max }).format(v ?? 0);

const saveLS = () => {
  localStorage.setItem("bca_settings", JSON.stringify(state.settings));
  localStorage.setItem("bca_transactions", JSON.stringify(state.txs));
  if (state.price.value) {
    localStorage.setItem(`bca_price_${state.price.currency}`, JSON.stringify({
      value: state.price.value, updatedAt: state.price.updatedAt
    }));
  }
};
const loadLS = () => {
  const s = localStorage.getItem("bca_settings");
  if (s) state.settings = { ...state.settings, ...JSON.parse(s) };
  const t = localStorage.getItem("bca_transactions");
  if (t) state.txs = JSON.parse(t);
  const cached = localStorage.getItem(`bca_price_${state.settings.fiatCurrency}`);
  if (cached) {
    const obj = JSON.parse(cached);
    state.price = { value: obj.value, currency: state.settings.fiatCurrency, updatedAt: obj.updatedAt };
  } else {
    state.price.currency = state.settings.fiatCurrency;
  }
};

/* ====== ดึงราคาจาก CoinGecko ====== */
async function fetchPrice(currency) {
  const cur = currency.toLowerCase();
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${cur}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("network");
    const json = await res.json();
    const price = json?.bitcoin?.[cur];
    if (typeof price !== "number") throw new Error("bad price");
    state.price = { value: price, currency, updatedAt: Date.now() };
    saveLS();
    return price;
  } catch {
    const cached = localStorage.getItem(`bca_price_${currency}`);
    if (cached) {
      const { value, updatedAt } = JSON.parse(cached);
      state.price = { value, currency, updatedAt };
      return value;
    }
    return null;
  }
}

/* ====== คำนวณพอร์ต ====== */
function computeStats() {
  const totalSats = state.txs.reduce((a, t) => a + (t.type === "buy" ? t.sats : -t.sats), 0);
  const totalBTC = totalSats / 1e8;
  const totalFiat = state.txs.reduce((a, t) => a + (t.type === "buy" ? t.fiat : -t.fiat), 0);

  const buys = state.txs.filter(t => t.type === "buy");
  const buyBTC = buys.reduce((a, t) => a + (t.sats / 1e8), 0);
  const buyFiat = buys.reduce((a, t) => a + t.fiat, 0);
  const avgCost = buyBTC > 0 ? (buyFiat / buyBTC) : 0;

  const price = state.price.value ?? 0;
  const currentValue = totalBTC * price;
  const pnl = currentValue - totalFiat;
  const pnlPct = totalFiat !== 0 ? (pnl / totalFiat) * 100 : 0;

  return { totalSats, totalBTC, totalFiat, avgCost, currentValue, pnl, pnlPct };
}

/* ====== รายวันจากประวัติ ====== */
function startOfDay(ts){ const d=new Date(ts); d.setHours(0,0,0,0); return +d; }
function getCumulativeSeriesDaily() {
  if (state.txs.length === 0) return [];
  const map = new Map();
  state.txs.forEach(t => {
    const day = startOfDay(t.createdAt);
    const delta = (t.type === "buy" ? t.sats : -t.sats);
    map.set(day, (map.get(day) || 0) + delta);
  });
  const days = Array.from(map.keys()).sort((a,b) => a - b);
  let sumSats = 0;
  return days.map(day => { sumSats += map.get(day); return { t: day, btc: sumS
