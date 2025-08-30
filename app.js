/* ====== สถานะหลักของแอป ====== */
const state = {
  settings: {
    fiatCurrency: "THB",
    btcUnit: "BTC",
  },
  price: { // ราคาบิตคอยน์ต่อ 1 BTC ในหน่วย fiat ที่เลือก
    value: null,
    currency: "THB",
    updatedAt: null,
  },
  txs: [], // {id, type: 'buy'|'sell', fiat, btcPrice, sats, createdAt}
  deferredPrompt: null, // PWA install prompt
};

/* ====== Utils ====== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const nf = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 8 });
const format = (v, max = 2) => new Intl.NumberFormat("th-TH", { maximumFractionDigits: max }).format(v ?? 0);

const saveLS = () => {
  localStorage.setItem("bca_settings", JSON.stringify(state.settings));
  localStorage.setItem("bca_transactions", JSON.stringify(state.txs));
  if (state.price.value) {
    localStorage.setItem(`bca_price_${state.price.currency}`, JSON.stringify({
      value: state.price.value,
      updatedAt: state.price.updatedAt,
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

    state.price = { value: price, currency: currency, updatedAt: Date.now() };
    saveLS();
    return price;
  } catch (e) {
    // ถ้าล้มเหลว ใช้ราคา cache เดิมถ้ามี
    const cached = localStorage.getItem(`bca_price_${currency}`);
    if (cached) {
      const { value, updatedAt } = JSON.parse(cached);
      state.price = { value, currency, updatedAt };
      return value;
    }
    return null;
  }
}

/* ====== คำนวณสถิติพอร์ต ====== */
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

/* ====== Render Portfolio ====== */
function renderPortfolio() {
  // เติมค่าลง select
  $("#fiatSelect").value = state.settings.fiatCurrency;
  $("#btcUnitSelect").value = state.settings.btcUnit;

  // ป้ายราคา
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
  state.txs
    .slice()
    .reverse()
    .forEach(t => {
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
    const type = $("#txType").value; // 'buy' | 'sell'
    const unit = $("#txUnit").value; // 'BTC' | 'Satoshi'
    const fiat = parseFloat($("#txFiat").value.replace(/,/g,""));
    const price = parseFloat($("#txPrice").value.replace(/,/g,""));
    const amount = parseFloat($("#txAmount").value.replace(/,/g,""));

    if (![fiat,price,amount].every(n => Number.isFinite(n) && n >= 0)) {
      alert("กรุณากรอกตัวเลขให้ถูกต้อง");
      return;
    }
    const sats = unit === "BTC" ? amount * 1e8 : amount;
    const tx = {
      id: Date.now(),
      type, fiat, btcPrice: price, sats,
      createdAt: Date.now(),
    };
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
    // คำนวณซ้ำจากด้านที่แก้ล่าสุด
    if (lastEdited === "fiat") {
      fiatInput.dispatchEvent(new Event("input"));
    } else if (lastEdited === "sats") {
      satsInput.dispatchEvent(new Event("input"));
    }
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
    fiatInput.value = format(fiat);
  });
}

/* ====== Routing (แท็บ) ====== */
function setActiveTab() {
  const hash = location.hash || "#/portfolio";
  $$(".tab").forEach(a => a.classList.toggle("active", a.getAttribute("href") === hash));
  $("#view-portfolio").hidden = !(hash === "#/portfolio");
  $("#view-converter").hidden = !(hash === "#/converter");
}

window.addEventListener("hashchange", setActiveTab);

/* ====== ตั้งค่า/ราคา และ Binding ====== */
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
    // ให้หน้า Converter ใช้สกุลเดียวกันทันที
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

  // ดึงราคาตามสกุลที่ตั้งค่า
  await fetchPrice(state.settings.fiatCurrency);

  // ให้ Converter ใช้สกุลเริ่มต้นเดียวกัน
  $("#convCurrency").value = state.settings.fiatCurrency;
  renderConvBadge();

  renderPortfolio();
  startAutoRefresh();
})();
