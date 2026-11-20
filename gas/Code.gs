/**
 * チャイ レジ — Google Apps Script バックエンド
 * スプレッドシートの「拡張機能 > Apps Script」に貼り付けて、ウェブアプリとしてデプロイする。
 */

// ★ 合言葉。サイトの「設定」タブにも同じものを入力する。必ず変更すること。
const TOKEN = 'ここを好きな合言葉に変更';

const SHEET_SALES = '売上';
const SHEET_ITEMS = '売上明細';
const SHEET_MENU = 'メニュー';

const HEAD_SALES = ['ID', '日時', 'レジ', '内容', '杯数', '合計', '支払方法', '預り金', 'お釣り', '状態', '明細JSON'];
const HEAD_ITEMS = ['売上ID', '日時', 'レジ', '商品', '単価', '数量', '杯数', '小計', '状態'];
const HEAD_MENU = ['商品名', '価格', '杯数', '色', '表示'];

function doGet() {
  return json({ ok: true, message: 'チャイ レジ API は動作中です' });
}

function doPost(e) {
  let p = {};
  try { p = JSON.parse(e.postData.contents); } catch (_) {}
  try {
    if (p.token !== TOKEN) throw new Error('合言葉が違います');
    ensureSheets();
    switch (p.action) {
      case 'ping': return json({ ok: true });
      case 'getAll': return json({ ok: true, menu: getMenu(), sales: getSales() });
      case 'addSales': return json({ ok: true, added: withLock(() => addSales(p.sales || [])) });
      case 'voidSale': return json({ ok: true, found: withLock(() => voidSale(p.id)) });
      case 'saveMenu': withLock(() => saveMenu(p.menu || [])); return json({ ok: true });
      default: throw new Error('不明な操作: ' + p.action);
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

/** 初回に手動で実行してもよい（シート作成＋権限承認） */
function setup() { ensureSheets(); }

// ---------------------------------------------------------
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function sheet(name) { return SpreadsheetApp.getActive().getSheetByName(name); }

function ensureSheets() {
  const ss = SpreadsheetApp.getActive();
  [[SHEET_SALES, HEAD_SALES], [SHEET_ITEMS, HEAD_ITEMS], [SHEET_MENU, HEAD_MENU]].forEach(([name, head]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
      sh.setFrozenRows(1);
      if (name === SHEET_MENU) {
        sh.getRange(2, 1, 3, 5).setValues([
          ['ホットチャイ', 400, 1, '#9a4a24', true],
          ['知り合い割', 200, 1, '#c0703a', true],
          ['4杯セット', 1000, 4, '#7a3b1d', true],
        ]);
      }
      if (name === SHEET_SALES) sh.getRange('B:B').setNumberFormat('yyyy/mm/dd hh:mm:ss');
      if (name === SHEET_ITEMS) sh.getRange('B:B').setNumberFormat('yyyy/mm/dd hh:mm:ss');
    }
  });
}

function rows(sh) {
  const n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, sh.getLastColumn()).getValues() : [];
}

function getMenu() {
  return rows(sheet(SHEET_MENU))
    .filter(r => String(r[0]).trim())
    .map(r => ({ name: String(r[0]).trim(), price: Number(r[1]) || 0, cups: r[2] === '' ? 1 : Number(r[2]) || 0,
      color: String(r[3] || '#9a4a24'), active: r[4] !== false && String(r[4]).toUpperCase() !== 'FALSE' }));
}

function saveMenu(menu) {
  const sh = sheet(SHEET_MENU);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, HEAD_MENU.length).clearContent();
  const vals = menu.filter(m => m.name).map(m => [m.name, Number(m.price) || 0, m.cups == null ? 1 : Number(m.cups) || 0, m.color || '', m.active !== false]);
  if (vals.length) sh.getRange(2, 1, vals.length, HEAD_MENU.length).setValues(vals);
}

function getSales() {
  return rows(sheet(SHEET_SALES)).filter(r => r[0]).map(r => {
    let items = [];
    try { items = JSON.parse(r[10] || '[]'); } catch (_) {}
    return {
      id: String(r[0]),
      ts: r[1] instanceof Date ? r[1].getTime() : new Date(r[1]).getTime(),
      register: String(r[2]),
      items,
      cups: Number(r[4]) || 0,
      count: items.reduce((a, i) => a + i.qty, 0),
      total: Number(r[5]) || 0,
      method: String(r[6]),
      received: Number(r[7]) || 0,
      change: Number(r[8]) || 0,
      status: String(r[9] || '有効'),
    };
  });
}

function addSales(sales) {
  const shS = sheet(SHEET_SALES), shI = sheet(SHEET_ITEMS);
  const existing = new Set(rows(shS).map(r => String(r[0])));
  const sRows = [], iRows = [];
  sales.forEach(s => {
    if (!s || !s.id || existing.has(s.id)) return;   // 二重送信は無視
    existing.add(s.id);
    const d = new Date(s.ts);
    const items = (s.items || []).map(i => ({ name: String(i.name), price: Number(i.price) || 0, qty: Number(i.qty) || 0, cups: i.cups == null ? 1 : Number(i.cups) || 0 }));
    const cups = items.reduce((a, i) => a + i.cups * i.qty, 0);
    sRows.push([s.id, d, s.register, items.map(i => i.name + '×' + i.qty).join(', '), cups, s.total,
      s.method, s.received, s.change, s.status || '有効', JSON.stringify(items)]);
    items.forEach(i => iRows.push([s.id, d, s.register, i.name, i.price, i.qty, i.cups * i.qty, i.price * i.qty, s.status || '有効']));
  });
  if (sRows.length) shS.getRange(shS.getLastRow() + 1, 1, sRows.length, HEAD_SALES.length).setValues(sRows);
  if (iRows.length) shI.getRange(shI.getLastRow() + 1, 1, iRows.length, HEAD_ITEMS.length).setValues(iRows);
  return sRows.length;
}

function voidSale(id) {
  let found = false;
  const shS = sheet(SHEET_SALES);
  rows(shS).forEach((r, i) => { if (String(r[0]) === id) { shS.getRange(i + 2, 10).setValue('取消'); found = true; } });
  const shI = sheet(SHEET_ITEMS);
  rows(shI).forEach((r, i) => { if (String(r[0]) === id) shI.getRange(i + 2, 9).setValue('取消'); });
  return found;
}
