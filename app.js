/* ====== สถานะหลักของแอป ====== */
const state = {
  settings: { fiatCurrency: "THB", btcUnit: "BTC" },
  price: { value: null, currency: "THB", updatedAt: null },
  txs: [], // {id, type:'buy'|'sell', fiat, btcPrice, sats, createdAt}
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

/* ====== สร้างซีรีส์สะสม “รายวัน” จากประวัติ ======
   - รวมธุรกรรมในวันเดียวกันเข้าด้วยกัน
   - คำนวณค่าสะสม (สกุล BTC) */
function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0,0,0,0);
  return +d;
}
function getCumulativeSeriesDaily() {
  if (state.txs.length === 0) return [];
  // รวม delta ต่อวัน
  const map = new Map(); // key: day(ms at 00:00) -> deltaSats
  state.txs.forEach(t => {
    const day = startOfDay(t.createdAt);
    const delta = (t.type === "buy" ? t.sats : -t.sats);
    map.set(day, (map.get(day) || 0) + delta);
  });
  // จัดเรียงตามวันและทำ cumulative
  const days = Array.from(map.keys()).sort((a,b) => a - b);
  let sumSats = 0;
  return days.map(day => {
    sumSats += map.get(day);
    return { t: day, btc: sumSats / 1e8 };
  });
}

/* ====== สร้าง ticks วันที่สวย ๆ ตามช่วงเวลา ====== */
function generateDateTicks(minX, maxX, desired = 6) {
  const oneDay = 86400000;
  let spanDays = Math.max(1, Math.round((maxX - minX) / oneDay));
  if (spanDays < desired) {
    // ถ้าช่วงสั้นมาก เติมให้ครบ desired โดยก้าวเป็น 1 วัน
    const ticks = [];
    for (let i = 0; i < desired; i++) {
      ticks.push(minX + i * oneDay);
    }
    return ticks.filter(t => t <= maxX);
  }
  const stepDays = Math.max(1, Math.round(spanDays / (desired - 1)));
  const ticks = [];
  let cursor = startOfDay(minX);
  while (cursor <= maxX) {
    ticks.push(cursor);
    cursor += stepDays * oneDay;
  }
  if (ticks[ticks.length - 1] !== startOfDay(maxX)) ticks.push(startOfDay(maxX));
  return ticks.slice(0, desired + 1);
}
function formatDateTick(ts, spanDays) {
  const d = new Date(ts);
  if (spanDays <= 31) return d.toLocaleDateString("th-TH", { day:"2-digit", month:"short" });
  if (spanDays <= 366) return d.toLocaleDateString("th-TH", { day:"2-digit", month:"short" });
  return d.toLocaleDateString("th-TH", { month:"short", year:"numeric" });
}

/* ====== กราฟสะสม: วาด + ใส่วันที่ + ทูลทิป ====== */
function renderAccumChart() {
  const svg = $("#accChart");
  const path = $("#accPath");
  const area = $("#accArea");
  const xTicks = $("#accXTicks");
  const yTicks = $("#accYTicks");
  const grid = $("#accGrid");
  const dot = $("#accDot");
  const hoverLine = $("#accHoverLine");
  const tip = $("#accTooltip");
  const empty = $("#accEmpty");
  if (!svg) return;

  const w = svg.clientWidth || svg.parentElement.clientWidth || 680;
  const h = 260;
  const pad = { l: 48, r: 12, t: 12, b: 30 };
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);

  const data = getCumulativeSeriesDaily();
  xTicks.innerHTML = ""; yTicks.innerHTML = ""; grid.innerHTML = "";

  if (!data.length) {
    path.setAttribute("d", ""); area.setAttribute("d", "");
    hoverLine.setAttribute("visibility","hidden");
    dot.setAttribute("visibility","hidden");
    tip.hidden = true;
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const xs = data.map(d => d.t);
  const ys = data.map(d => d.btc);
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  if (minX === maxX) { maxX = minX + 86400000; } // อย่างน้อย 1 วัน
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  if (minY === maxY) { minY = Math.min(0,minY - 0.0000001); maxY = maxY + 0.0000001; }

  const xScale = x => pad.l + ((x - minX) / (maxX - minX)) * (w - pad.l - pad.r);
  const yScale = y => (h - pad.b) - ((y - minY) / (maxY - minY)) * (h - pad.t - pad.b);
  const xInvert = px => ((px - pad.l) / (w - pad.l - pad.r)) * (maxX - minX) + minX;

  // เส้นกราฟ
  let d = "";
  data.forEach((pt,i) => {
    const X = xScale(pt.t), Y = yScale(pt.btc);
    d += (i===0 ? `M ${X} ${Y}` : ` L ${X} ${Y}`);
  });
  path.setAttribute("d", d);

  // พื้นที่ใต้กราฟ
  const firstX = xScale(data[0].t);
  const lastX = xScale(data[data.length-1].t);
  const baseY = yScale(minY);
  const areaD = `${d} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;
  area.setAttribute("d", areaD);

  // เส้นตารางแนวนอน + Y ticks
  const ySteps = 4;
  for (let i=0; i<=ySteps; i++){
    const yy = minY + (i*(maxY-minY)/ySteps);
    const Y = yScale(yy);
    const g = document.createElementNS("http://www.w3.org/2000/svg","path");
    g.setAttribute("d", `M ${pad.l} ${Y} H ${w - pad.r}`);
    g.setAttribute("class","chart-grid");
    grid.appendChild(g);

    const t = document.createElementNS("http://www.w3.org/2000/svg","text");
    t.setAttribute("x", pad.l - 8);
    t.setAttribute("y", Y + 4);
    t.setAttribute("text-anchor","end");
    t.setAttribute("class","chart-tick");
    t.textContent = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 8 }).format(yy);
    yTicks.appendChild(t);
  }

  // X ticks (วันที่หลายจุด)
  const spanDays = Math.round((maxX - minX) / 86400000);
  const tickDates = generateDateTicks(minX, maxX, 6);
  tickDates.forEach(ts => {
    const X = xScale(ts);
    // เส้นตารางแนวตั้ง
    const v = document.createElementNS("http://www.w3.org/2000/svg","path");
    v.setAttribute("d", `M ${X} ${pad.t} V ${h - pad.b}`);
    v.setAttribute("class","chart-grid");
    grid.appendChild(v);
    // ป้ายวันที่
    const xt = document.createElementNS("http://www.w3.org/2000/svg","text");
    xt.setAttribute("x", X);
    xt.setAttribute("y", h - 8);
    xt.setAttribute("text-anchor","middle");
    xt.setAttribute("class","chart-tick");
    xt.textContent = formatDateTick(ts, spanDays);
    xTicks.appendChild(xt);
  });

  // ----- Tooltip / Hover -----
  function nearestIndex(px) {
    const targetT = xInvert(px);
    // binary search
    let lo = 0, hi = data.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (data[mid].t < targetT) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && Math.abs(data[lo].t - targetT) > Math.abs(data[lo-1].t - targetT)) lo = lo - 1;
    return lo;
  }
  function showAt(i) {
    const pt = data[i];
    const X = xScale(pt.t), Y = yScale(pt.btc);
    dot.setAttribute("cx", X); dot.setAttribute("cy", Y); dot.setAttribute("visibility","visible");
    hoverLine.setAttribute("x1", X); hoverLine.setAttribute("x2", X);
    hoverLine.setAttribute("y1", pad.t); hoverLine.setAttribute("y2", h - pad.b);
    hoverLine.setAttribute("visibility","visible");

    const elWrap = $("#accChartWrap");
    const rect = svg.getBoundingClientRect();
    const wrapRect = elWrap.getBoundingClientRect();
    tip.hidden = false;
    tip.innerHTML = `<strong>${format(pt.btc,8)} BTC</strong><br>${new Date(pt.t).toLocaleDateString("th-TH",{ day:"2-digit", month:"short", year:"numeric" })}`;
    const tipX = (rect.left - wrapRect.left) + X;
    const tipY = (rect.top - wrapRect.top) + Y;
    tip.style.left = `${tipX}px`;
    tip.style.top = `${tipY}px`;
  }
  function hideTip() {
    dot.setAttribute("visibility","hidden");
    hoverLine.setAttribute("visibility","hidden");
    tip.hidden = true;
  }

  // ผูกอีเวนต์ (เมาส์/ทัช)
  svg.onmousemove = (e) => {
    const px = e.offsetX ?? (e.clientX - svg.getBoundingClientRect().left);
    const i = nearestIndex(px);
    showAt(i);
  };
  svg.ontouchstart = svg.ontouchmove = (e) => {
    const touch = e.touches[0];
    const rect = svg.getBoundingClientRect();
    const px = touch.clientX - rect.left;
    const i = nearestIndex(px);
    showAt(i);
  };
  svg.onmouseleave = hideTip;
}

/* ====== Render Portfolio & List ====== */
function renderPortfolio() {
  $("#fiatSelect").value = state.settings.fiatCurrency;
  $("#btcUnitSelect").value = state.settings.btcUnit;

  const badge = $("#priceBadge");
  if (state.price.value) {
    const ts = state.price.updatedAt ? new Date(state.price.updatedAt).toLocaleTimeString("th-TH") : "";
    badge.textContent = `ราคา ${state.price.currency}: ${format(state.price.value)} (อัปเดต ${ts})`;
  } else {
    badge.textContent = "กำลังดึงราคา…";
  }

  const s = computeStats();
  $("#totalFiat").textContent = `${format(s.totalFiat)} ${state.settings.fiatCurrency}`;
  $("#avgCost").textContent = s.avgCost ? `${format(s.avgCost)} ${state.settings.fiatCurrency}/BTC` : "-";
  if (state.settings.btcUnit === "BTC") {
    $("#totalBTCOrSats").textContent = `${format(s.totalBTC, 8)} BTC`;
  } else {
    $("#totalBTCOrSats").textContent = `${format(s.totalSats, 0)} Satoshi`;
  }
  $("#currentValue").textContent = `${format(s.currentValue)} ${state.settings.fiatCurrency}`;
  const pnlEl = $("#pnl");
  pnlEl.textContent = `${format(s.pnl)} ${state.settings.fiatCurrency}`;
  pnlEl.style.color = s.pnl >= 0 ? "var(--primary)" : "var(--danger)";
  $("#pnlPct").textContent = `${format(s.pnlPct)}%`;

  renderTxList();
  renderAccumChart();
}

function renderTxList() {
  const box = $("#txList");
  box.innerHTML = "";
  if (state.txs.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "ยังไม่มีรายการ";
    box.appendChild(p);
    return;
  }
  state.txs.slice().reverse().forEach(t => {
    const el = document.createElement("div");
    el.className = "tx";
    const left = document.createElement("div");
    left.className = "tx__left";
    const icon = document.createElement("div");
    icon.className = "tx__icon";
    icon.textContent = t.type === "buy" ? "🟢" : "🔴";
    const text = document.createElement("div");
    const title = document.createElement("p");
    title.className = "tx__title";
    title.innerHTML = `<strong>${t.type === "buy" ? "ซื้อ" : "ขาย"}</strong> · ${format(t.fiat)} ${state.settings.fiatCurrency}`;
    const meta = document.createElement("div");
    meta.className = "tx__meta";
    const amountBTC = t.sats / 1e8;
    const amtDisplay = state.settings.btcUnit === "BTC"
      ? `${t.type === "sell" ? "-" : ""}${format(amountBTC, 8)} BTC`
      : `${t.type === "sell" ? "-" : ""}${format(t.sats, 0)} Satoshi`;
    meta.textContent = `ราคา: ${format(t.btcPrice)} ${state.settings.fiatCurrency} · จำนวน: ${amtDisplay}`;
    text.appendChild(title); text.appendChild(meta);
    left.appendChild(icon); left.appendChild(text);
    const right = document.createElement("div");
    right.className = "tx__meta";
    right.textContent = new Date(t.createdAt).toLocaleString("th-TH");
    el.appendChild(left); el.appendChild(right);
    box.appendChild(el);
  });
}

/* ====== Modal เพิ่มรายการ ====== */
function openModal() { $("#modal").hidden = false; }
function closeModal() { $("#modal").hidden = true; }
function bindModal() {
  $("#openAddTx").addEventListener("click", () => {
    $("#txType").value = "buy";
    $("#txUnit").value = "BTC";
    $("#txFiat").value = "";
    $("#txPrice").value = "";
    $("#txAmount").value = "";
    $("#amountLabel").textContent = "จำนวนที่ได้";
    openModal();
  });
  $("#closeModal").addEventListener("click", closeModal);
  $("#txType").addEventListener("change", (e) => {
    $("#amountLabel").textContent = e.target.value === "buy" ? "จำนวนที่ได้" : "จำนวนที่ขาย";
  });
  $("#saveTx").addEventListener("click", () => {
    const type = $("#txType").value; // buy | sell
    const unit = $("#txUnit").value; // BTC | Satoshi
    const fiat = parseFloat($("#txFiat").value.replace(/,/g,""));
    const price = parseFloat($("#txPrice").value.replace(/,/g,""));
    const amount = parseFloat($("#txAmount").value.replace(/,/g,""));
    if (![fiat,price,amount].every(n => Number.isFinite(n) && n >= 0)) {
      alert("กรุณากรอกตัวเลขให้ถูกต้อง");
      return;
    }
    const sats = unit === "BTC" ? amount * 1e8 : amount;
    const tx = { id: Date.now(), type, fiat, btcPrice: price, sats, createdAt: Date.now() };
    state.txs.push(tx);
    saveLS();
    closeModal();
    renderPortfolio();
  });
}

/* ====== Converter ====== */
let lastEdited = null; // 'fiat' | 'sats'
function renderConvBadge() {
  const badge = $("#convBadge");
  if (state.price.currency === $("#convCurrency").value && state.price.value) {
    badge.textContent = `ราคา ${state.price.currency}: ${format(state.price.value)} (อัปเดต ${new Date(state.price.updatedAt).toLocaleTimeString("th-TH")})`;
  } else {
    badge.textContent = "กำลังดึงราคา…";
  }
}
function bindConverter() {
  const fiatInput = $("#fiatInput");
  const satsInput = $("#satsInput");
  const currencySel = $("#convCurrency");
  currencySel.value = state.settings.fiatCurrency;

  currencySel.addEventListener("change", async () => {
    await fetchPrice(currencySel.value);
    renderConvBadge();
    if (lastEdited === "fiat") fiatInput.dispatchEvent(new Event("input"));
    else if (lastEdited === "sats") satsInput.dispatchEvent(new Event("input"));
  });

  fiatInput.addEventListener("input", () => {
    lastEdited = "fiat";
    const v = parseFloat(fiatInput.value.replace(/,/g,""));
    if (!Number.isFinite(v) || !state.price.value) return;
    const sats = (v / state.price.value) * 1e8;
    satsInput.value = Math.max(0, Math.floor(sats)).toString();
  });
  satsInput.addEventListener("input", () => {
    lastEdited = "sats";
    const v = parseFloat(satsInput.value.replace(/,/g,""));
    if (!Number.isFinite(v) || !state.price.value) return;
    const fiat = (v / 1e8) * state.price.value;
    $("#fiatInput").value = format(fiat);
  });
}

/* ====== Routing (แท็บ) ====== */
function setActiveTab() {
  const hash = location.hash || "#/portfolio";
  $$(".tab").forEach(a => a.classList.toggle("active", a.getAttribute("href") === hash));
  $("#view-portfolio").hidden = !(hash === "#/portfolio");
  $("#view-converter").hidden = !(hash === "#/converter");
  if (hash === "#/portfolio") setTimeout(renderAccumChart, 50);
}
window.addEventListener("hashchange", setActiveTab);
window.addEventListener("resize", () => {
  if (!$("#view-portfolio").hidden) renderAccumChart();
});

/* ====== Settings binding ====== */
function bindSettings() {
  const fiatSel = $("#fiatSelect");
  const unitSel = $("#btcUnitSelect");
  fiatSel.value = state.settings.fiatCurrency;
  unitSel.value = state.settings.btcUnit;

  fiatSel.addEventListener("change", async () => {
    state.settings.fiatCurrency = fiatSel.value;
    await fetchPrice(state.settings.fiatCurrency);
    saveLS();
    renderPortfolio();
    $("#convCurrency").value = state.settings.fiatCurrency;
    renderConvBadge();
  });

  unitSel.addEventListener("change", () => {
    state.settings.btcUnit = unitSel.value;
    saveLS();
    renderPortfolio();
  });
}

/* ====== Auto refresh ราคา ====== */
let priceTimer = null;
function startAutoRefresh() {
  if (priceTimer) clearInterval(priceTimer);
  priceTimer = setInterval(async () => {
    await fetchPrice(state.settings.fiatCurrency);
    renderPortfolio();
    renderConvBadge();
  }, 45000);

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      await fetchPrice(state.settings.fiatCurrency);
      renderPortfolio();
      renderConvBadge();
    }
  });
}

/* ====== Install prompt ====== */
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  state.deferredPrompt = e;
  $("#installBtn").hidden = false;
});
$("#installBtn")?.addEventListener("click", async () => {
  if (!state.deferredPrompt) return;
  state.deferredPrompt.prompt();
  await state.deferredPrompt.userChoice;
  state.deferredPrompt = null;
  $("#installBtn").hidden = true;
});

/* ====== Service Worker ====== */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

/* ====== Boot ====== */
(async function init() {
  loadLS();
  setActiveTab();

  bindSettings();
  bindConverter();
  bindModal();

  await fetchPrice(state.settings.fiatCurrency);
  $("#convCurrency").value = state.settings.fiatCurrency;
  renderConvBadge();

  renderPortfolio();
  startAutoRefresh();
})();
