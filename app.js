'use strict';

/* =========================================================
 * チャイ レジ  —  GitHub Pages + Google スプレッドシート
 * データはまず端末(localStorage)に保存し、未送信キューから
 * Apps Script へ順に送る。通信が切れてもレジは止まらない。
 * ========================================================= */

// ---------- 保存ヘルパ ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 容量不足など */ } },
};

// cups = 1回押したときに出るチャイの杯数（セットは4杯）
const DEFAULT_MENU = [
  { name: 'ホットチャイ', price: 400, cups: 1, color: '#9a4a24', active: true },
  { name: '知り合い割', price: 200, cups: 1, color: '#c0703a', active: true },
  { name: '4杯セット', price: 1000, cups: 4, color: '#7a3b1d', active: true },
];
const cupsOf = (x) => (x && x.cups != null && x.cups !== '' ? Number(x.cups) : 1);

const state = {
  config: LS.get('pos.config', { gasUrl: '', token: '', register: 'レジ1', startCash: 0 }),
  menu: LS.get('pos.menu', DEFAULT_MENU),
  sales: LS.get('pos.sales', []),      // 全売上(サーバー + 未送信)
  ops: LS.get('pos.ops', []),          // 未送信キュー [{type:'add',sale}|{type:'void',id}]
  cart: {},                            // name -> qty
  syncing: false,
  lastError: '',
};

const $ = (s) => document.querySelector(s);
const yen = (n) => '¥' + Math.round(n).toLocaleString('ja-JP');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const timeStr = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
const isRemote = () => !!state.config.gasUrl;

function persist() {
  LS.set('pos.config', state.config);
  LS.set('pos.menu', state.menu);
  LS.set('pos.sales', state.sales);
  LS.set('pos.ops', state.ops);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2200);
}

// =========================================================
// 通信
// =========================================================
async function api(action, payload = {}) {
  const res = await fetch(state.config.gasUrl, {
    method: 'POST',
    // text/plain にするとプリフライト(OPTIONS)が発生せず Apps Script でも動く
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: state.config.token, ...payload }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'サーバーエラー');
  return data;
}

async function flush() {
  while (state.ops.length) {
    const head = state.ops[0];
    if (head.type === 'add') {
      // 連続する add はまとめて送る
      let n = 0;
      while (n < state.ops.length && state.ops[n].type === 'add' && n < 50) n++;
      await api('addSales', { sales: state.ops.slice(0, n).map((o) => o.sale) });
      state.ops.splice(0, n);
    } else if (head.type === 'void') {
      await api('voidSale', { id: head.id });
      state.ops.shift();
    } else {
      state.ops.shift();
    }
    persist();
  }
}

async function sync({ quiet = true } = {}) {
  if (!isRemote() || state.syncing) { renderSync(); return; }
  state.syncing = true; renderSync();
  try {
    await flush();
    const data = await api('getAll');
    if (Array.isArray(data.menu) && data.menu.length) state.menu = data.menu;
    mergeSales(data.sales || []);
    state.lastError = '';
    persist();
    if (!quiet) toast('同期しました');
  } catch (e) {
    state.lastError = e.message || String(e);
    if (!quiet) toast('同期失敗: ' + state.lastError);
  } finally {
    state.syncing = false;
    renderAll();
  }
}

function mergeSales(serverSales) {
  const map = new Map(serverSales.map((s) => [s.id, s]));
  for (const op of state.ops) {
    if (op.type === 'add' && !map.has(op.sale.id)) map.set(op.sale.id, op.sale);
    if (op.type === 'void' && map.has(op.id)) map.get(op.id).status = '取消';
  }
  state.sales = [...map.values()].sort((a, b) => a.ts - b.ts);
}

const pendingIds = () => new Set(state.ops.flatMap((o) => (o.type === 'add' ? [o.sale.id] : [o.id])));

// =========================================================
// レジ画面
// =========================================================
function activeMenu() { return state.menu.filter((m) => m.active !== false); }

function cartLines() {
  return Object.entries(state.cart)
    .filter(([, q]) => q > 0)
    .map(([name, qty]) => {
      const m = state.menu.find((x) => x.name === name);
      return { name, price: m ? Number(m.price) : 0, qty, cups: cupsOf(m) };
    });
}
const cartTotal = () => cartLines().reduce((s, l) => s + l.price * l.qty, 0);
const cartCups = () => cartLines().reduce((s, l) => s + l.cups * l.qty, 0);
// 古いデータ(cups なし)でも1品=1杯として数える
const saleCups = (s) => (s.cups != null ? s.cups : s.items.reduce((a, i) => a + cupsOf(i) * i.qty, 0));

function renderMenu() {
  $('#menuGrid').innerHTML = activeMenu().map((m) => {
    const q = state.cart[m.name] || 0;
    return `<button class="menu-btn" data-name="${esc(m.name)}" style="background:${esc(m.color || '#9a4a24')}">
      ${q ? `<span class="badge">${q}</span>` : ''}
      <span class="name">${esc(m.name)}</span>
      <span class="price">${yen(m.price)}${cupsOf(m) !== 1 ? ` ／ ${cupsOf(m)}杯` : ''}</span>
    </button>`;
  }).join('') || '<p class="empty">設定タブでメニューを登録してください</p>';
}

function renderCart() {
  const lines = cartLines();
  $('#cart').innerHTML = lines.length
    ? lines.map((l) => `<div class="cart-line">
        <span>${esc(l.name)}</span>
        <span class="qty">
          <button data-dec="${esc(l.name)}">−</button><b>${l.qty}</b><button data-inc="${esc(l.name)}">＋</button>
        </span>
        <span class="sub">${yen(l.price * l.qty)}</span>
      </div>`).join('')
    : '<div class="cart-empty">商品をタップ</div>';

  const total = cartTotal();
  const cups = cartCups();
  $('#total').textContent = (cups ? `${cups}杯 ` : '') + yen(total);
  $('#confirm').disabled = total === 0;
  renderMenu();
}

function resetCart() { state.cart = {}; renderCart(); }

function checkout() {
  const lines = cartLines();
  const total = cartTotal();
  if (!lines.length) return;
  const sale = {
    id: uid(),
    ts: Date.now(),
    register: state.config.register || 'レジ1',
    items: lines,
    count: lines.reduce((s, l) => s + l.qty, 0),
    cups: cartCups(),
    total, method: '現金', received: total, change: 0,
    status: '有効',
  };
  state.sales.push(sale);
  if (isRemote()) state.ops.push({ type: 'add', sale });
  persist();

  toast(`記録しました：${sale.cups}杯 ${yen(total)}`);

  resetCart();
  renderAll();
  sync();
}

// =========================================================
// 履歴
// =========================================================
function dateOptions(sel, withAll) {
  const keys = [...new Set(state.sales.map((s) => dateKey(s.ts)))].sort().reverse();
  const today = dateKey(Date.now());
  if (!keys.includes(today)) keys.unshift(today);
  const cur = sel.value;
  sel.innerHTML = (withAll ? '<option value="all">全期間</option>' : '') +
    keys.map((k) => `<option value="${k}">${k}${k === today ? '（今日）' : ''}</option>`).join('');
  sel.value = cur && [...sel.options].some((o) => o.value === cur) ? cur : today;
}

function renderHistory() {
  const sel = $('#historyDate');
  dateOptions(sel, true);
  const mine = $('#historyMine').checked;
  const pend = pendingIds();
  const list = state.sales
    .filter((s) => sel.value === 'all' || dateKey(s.ts) === sel.value)
    .filter((s) => !mine || s.register === state.config.register)
    .slice().reverse();
  $('#historyList').innerHTML = list.length ? list.map((s) => `
    <li class="${s.status === '取消' ? 'void' : ''}">
      <span class="h-time">${timeStr(s.ts)}</span>
      <span>
        <div class="h-items">${s.items.map((i) => `${esc(i.name)}×${i.qty}`).join('、')}</div>
        <div class="h-meta">${esc(s.register)} ・ ${saleCups(s)}杯
          ${s.status === '取消' ? ' ・ <b>取消済</b>' : ''} ${pend.has(s.id) ? '<span class="pending-mark">未送信</span>' : ''}</div>
      </span>
      <span class="h-total">${yen(s.total)}</span>
      ${s.status === '取消' ? '<span></span>' : `<button class="btn small danger" data-void="${esc(s.id)}">取消</button>`}
    </li>`).join('') : '<li class="empty" style="display:block;border:0;background:none">売上はまだありません</li>';
}

function voidSale(id) {
  const s = state.sales.find((x) => x.id === id);
  if (!s) return;
  if (!confirm(`${timeStr(s.ts)} の会計 ${yen(s.total)} を取り消しますか？`)) return;
  s.status = '取消';
  if (isRemote()) state.ops.push({ type: 'void', id });
  persist(); renderAll(); sync();
}

// =========================================================
// 集計
// =========================================================
function selectedSales() {
  const v = $('#summaryDate').value;
  return state.sales.filter((s) => s.status !== '取消' && (v === 'all' || dateKey(s.ts) === v));
}

function renderSummary() {
  dateOptions($('#summaryDate'), true);
  const list = selectedSales();
  const sum = (arr) => arr.reduce((a, s) => a + s.total, 0);
  const cups = list.reduce((a, s) => a + saleCups(s), 0);
  const voids = state.sales.filter((s) => s.status === '取消' && ($('#summaryDate').value === 'all' || dateKey(s.ts) === $('#summaryDate').value)).length;

  $('#summaryCards').innerHTML = [
    ['売上合計', yen(sum(list))],
    ['販売杯数', cups + ' 杯'],
    ['会計件数', list.length + ' 件'],
    ['1杯あたり', cups ? yen(sum(list) / cups) : '—'],
    ['取消', voids + ' 件'],
  ].map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  // 商品別
  const byItem = new Map();
  for (const s of list) for (const i of s.items) {
    const r = byItem.get(i.name) || { qty: 0, cups: 0, amt: 0 };
    r.qty += i.qty; r.cups += i.qty * cupsOf(i); r.amt += i.qty * i.price; byItem.set(i.name, r);
  }
  const itemRows = [...byItem.entries()].sort((a, b) => b[1].amt - a[1].amt);
  const maxAmt = Math.max(1, ...itemRows.map(([, r]) => r.amt));
  $('#itemTable').innerHTML = '<tr><th>商品</th><th class="num">回数</th><th class="num">杯数</th><th class="num">金額</th><th style="width:25%"></th></tr>' +
    (itemRows.map(([n, r]) => `<tr><td>${esc(n)}</td><td class="num">${r.qty}</td><td class="num">${r.cups}</td><td class="num">${yen(r.amt)}</td>
      <td><div class="bar" style="width:${(r.amt / maxAmt) * 100}%"></div></td></tr>`).join('') ||
      '<tr><td colspan="5" class="note">データなし</td></tr>');

  // 時間帯別
  const byHour = new Map();
  for (const s of list) {
    const h = new Date(s.ts).getHours();
    const r = byHour.get(h) || { n: 0, cups: 0, amt: 0 };
    r.n++; r.cups += saleCups(s); r.amt += s.total; byHour.set(h, r);
  }
  const hourRows = [...byHour.entries()].sort((a, b) => a[0] - b[0]);
  const maxH = Math.max(1, ...hourRows.map(([, r]) => r.amt));
  $('#hourTable').innerHTML = '<tr><th>時間</th><th class="num">件数</th><th class="num">杯数</th><th class="num">金額</th><th style="width:25%"></th></tr>' +
    (hourRows.map(([h, r]) => `<tr><td>${h}:00〜</td><td class="num">${r.n}</td><td class="num">${r.cups}</td><td class="num">${yen(r.amt)}</td>
      <td><div class="bar" style="width:${(r.amt / maxH) * 100}%"></div></td></tr>`).join('') ||
      '<tr><td colspan="5" class="note">データなし</td></tr>');

  // レジ別
  const byReg = new Map();
  for (const s of list) {
    const r = byReg.get(s.register) || { n: 0, cups: 0, amt: 0 };
    r.n++; r.cups += saleCups(s); r.amt += s.total; byReg.set(s.register, r);
  }
  $('#registerTable').innerHTML = '<tr><th>レジ</th><th class="num">件数</th><th class="num">杯数</th><th class="num">売上</th></tr>' +
    ([...byReg.entries()].map(([name, r]) => {
      const mine = name === state.config.register;
      return `<tr><td>${esc(name)}${mine ? '（この端末）' : ''}</td><td class="num">${r.n}</td><td class="num">${r.cups}</td><td class="num">${yen(r.amt)}</td></tr>`;
    }).join('') || '<tr><td colspan="4" class="note">データなし</td></tr>');
}

function exportCsv() {
  const v = $('#summaryDate').value;
  const rows = [['ID', '日時', 'レジ', '商品', '単価', '数量', '杯数', '小計', '状態']];
  for (const s of state.sales.filter((x) => v === 'all' || dateKey(x.ts) === v)) {
    const d = new Date(s.ts);
    const dt = `${dateKey(s.ts)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    for (const i of s.items) rows.push([s.id, dt, s.register, i.name, i.price, i.qty, i.qty * cupsOf(i), i.price * i.qty, s.status]);
  }
  const csv = '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `売上_${v}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// =========================================================
// 設定
// =========================================================
function renderSettings() {
  const c = state.config;
  $('#cfgUrl').value = c.gasUrl || '';
  $('#cfgToken').value = c.token || '';
  $('#cfgRegister').value = c.register || '';
  renderMenuEditor();
}

let menuDraft = [];
function renderMenuEditor() {
  $('#menuEditor').innerHTML = menuDraft.map((m, i) => `
    <div class="menu-row" data-i="${i}">
      <input type="text" data-f="name" value="${esc(m.name)}" placeholder="商品名">
      <input type="number" data-f="price" value="${Number(m.price) || 0}" min="0" step="10" inputmode="numeric" title="価格">
      <input type="number" data-f="cups" value="${cupsOf(m)}" min="0" step="1" inputmode="numeric" title="杯数">
      <input type="color" data-f="color" value="${esc(m.color || '#9a4a24')}">
      <label><input type="checkbox" data-f="active" ${m.active !== false ? 'checked' : ''}>表示</label>
      <button class="icon" data-move="-1" title="上へ">↑</button>
      <button class="icon" data-move="1" title="下へ">↓</button>
      <button class="icon" data-del title="削除">✕</button>
    </div>`).join('');
}

function readMenuDraft() {
  document.querySelectorAll('#menuEditor .menu-row').forEach((row) => {
    const m = menuDraft[Number(row.dataset.i)];
    m.name = row.querySelector('[data-f=name]').value.trim();
    m.price = Number(row.querySelector('[data-f=price]').value) || 0;
    m.cups = Number(row.querySelector('[data-f=cups]').value) || 0;
    m.color = row.querySelector('[data-f=color]').value;
    m.active = row.querySelector('[data-f=active]').checked;
  });
}

async function saveMenu() {
  readMenuDraft();
  const cleaned = menuDraft.filter((m) => m.name);
  const names = cleaned.map((m) => m.name);
  if (new Set(names).size !== names.length) { toast('同じ商品名が重複しています'); return; }
  state.menu = cleaned.map((m) => ({ ...m }));
  persist(); renderAll();
  if (isRemote()) {
    try { await api('saveMenu', { menu: state.menu }); toast('メニューを保存しました（共有済み）'); }
    catch (e) { toast('端末には保存。共有に失敗: ' + e.message); }
  } else toast('メニューを保存しました');
}

// =========================================================
// 共通描画
// =========================================================
function renderSync() {
  const el = $('#syncStatus');
  el.className = 'sync';
  if (!isRemote()) { el.classList.add('local'); el.textContent = 'ローカルモード'; return; }
  if (state.syncing) { el.classList.add('pending'); el.textContent = '同期中…'; return; }
  if (state.lastError) { el.classList.add('err'); el.textContent = `未接続${state.ops.length ? `・未送信${state.ops.length}件` : ''}`; el.title = state.lastError; return; }
  if (state.ops.length) { el.classList.add('pending'); el.textContent = `未送信 ${state.ops.length}件`; return; }
  el.classList.add('ok'); el.textContent = '同期済み'; el.title = '';
}

function renderAll() {
  $('#regName').textContent = state.config.register || '';
  renderCart();
  const v = document.querySelector('.view.active')?.id;
  if (v === 'view-history') renderHistory();
  if (v === 'view-summary') renderSummary();
  renderSync();
}

// =========================================================
// イベント
// =========================================================
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + t.dataset.view));
  if (t.dataset.view === 'settings') { menuDraft = state.menu.map((m) => ({ ...m })); renderSettings(); }
  renderAll();
}));

$('#menuGrid').addEventListener('click', (e) => {
  const b = e.target.closest('.menu-btn'); if (!b) return;
  const n = b.dataset.name; state.cart[n] = (state.cart[n] || 0) + 1; renderCart();
});
$('#cart').addEventListener('click', (e) => {
  const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]');
  if (inc) state.cart[inc.dataset.inc]++;
  if (dec) { const n = dec.dataset.dec; state.cart[n]--; if (state.cart[n] <= 0) delete state.cart[n]; }
  renderCart();
});
$('#clearCart').addEventListener('click', resetCart);
$('#confirm').addEventListener('click', checkout);

$('#historyDate').addEventListener('change', renderHistory);
$('#historyMine').addEventListener('change', renderHistory);
$('#historyList').addEventListener('click', (e) => { const b = e.target.closest('[data-void]'); if (b) voidSale(b.dataset.void); });

$('#summaryDate').addEventListener('change', renderSummary);
$('#exportCsv').addEventListener('click', exportCsv);

$('#saveConfig').addEventListener('click', () => {
  const prevRemote = isRemote();
  state.config.gasUrl = $('#cfgUrl').value.trim();
  state.config.token = $('#cfgToken').value;
  state.config.register = $('#cfgRegister').value.trim() || 'レジ1';
  // ローカルモードで記録した売上を、接続したときにまとめて送る
  if (!prevRemote && isRemote()) {
    const queued = pendingIds();
    for (const s of state.sales) if (!queued.has(s.id)) state.ops.push({ type: 'add', sale: s });
  }
  persist(); renderAll(); toast('設定を保存しました');
  sync({ quiet: false });
});
$('#testConn').addEventListener('click', async () => {
  const url = $('#cfgUrl').value.trim();
  if (!url) { $('#connMsg').textContent = 'URLを入力してください'; return; }
  $('#connMsg').textContent = '接続中…';
  const keep = { ...state.config };
  state.config.gasUrl = url; state.config.token = $('#cfgToken').value;
  try { await api('ping'); $('#connMsg').textContent = '✅ 接続できました。「保存」を押してください。'; }
  catch (e) { $('#connMsg').textContent = '❌ 接続できません: ' + e.message; }
  finally { state.config = keep; }
});
$('#reload').addEventListener('click', () => sync({ quiet: false }));

$('#addMenu').addEventListener('click', () => {
  readMenuDraft(); menuDraft.push({ name: '', price: 0, cups: 1, color: '#9a4a24', active: true }); renderMenuEditor();
});
$('#menuEditor').addEventListener('click', (e) => {
  const row = e.target.closest('.menu-row'); if (!row) return;
  const i = Number(row.dataset.i);
  const mv = e.target.closest('[data-move]'), del = e.target.closest('[data-del]');
  if (!mv && !del) return;
  readMenuDraft();
  if (del) menuDraft.splice(i, 1);
  if (mv) { const j = i + Number(mv.dataset.move); if (j >= 0 && j < menuDraft.length) [menuDraft[i], menuDraft[j]] = [menuDraft[j], menuDraft[i]]; }
  renderMenuEditor();
});
$('#saveMenu').addEventListener('click', saveMenu);

window.addEventListener('online', () => sync());
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
setInterval(() => sync(), 20000);

renderAll();
sync();
