'use strict';

const STORAGE_KEY         = 'subtracker_v1';
const STORAGE_KEY_RATINGS = 'subtracker_ratings_v1';
const CATEGORIES  = ['動画', '音楽', 'ソフトウェア', 'ゲーム', 'クラウド', 'その他'];
const CYCLE_LABEL = { monthly: '月', yearly: '年', weekly: '週' };
const RATING_VALUES = ['high', 'mid', 'low'];
const RATING_META = {
  high: { emoji: '👍', label: 'よく使った',   cls: 'rating-high' },
  mid:  { emoji: '🙂', label: 'たまに使った', cls: 'rating-mid'  },
  low:  { emoji: '👎', label: 'ほぼ使わず',   cls: 'rating-low'  },
};

let subs           = [];
let ratings        = [];
let editingId      = null;
let calYear, calMonth;
let searchQuery    = '';
let filterCategory = '';
let lastDeleted    = null;
let toastTimer     = null;
let previousFocus  = null;

// ── Init ────────────────────────────────
function init() {
  loadData();
  loadRatings();

  const now = new Date();
  calYear  = now.getFullYear();
  calMonth = now.getMonth();

  bindEvents();
  render();
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { subs = []; return; }
    const parsed = JSON.parse(raw);
    subs = Array.isArray(parsed) ? parsed.map(normalizeSub).filter(Boolean) : [];
  } catch (err) {
    console.warn('localStorage parse failed, starting fresh', err);
    subs = [];
  }
}

function loadRatings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RATINGS);
    if (!raw) { ratings = []; return; }
    const parsed = JSON.parse(raw);
    ratings = Array.isArray(parsed) ? parsed.filter(isValidRating) : [];
  } catch (err) {
    ratings = [];
  }
}

function isValidRating(r) {
  return r && typeof r.subId === 'string'
    && typeof r.period === 'string' && /^\d{4}-\d{2}$/.test(r.period)
    && RATING_VALUES.includes(r.value);
}

function normalizeSub(s) {
  if (!s || typeof s !== 'object') return null;
  if (!s.name) return null;
  if (typeof s.nextRenewal !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.nextRenewal)) return null;
  const cycle = (s.cycle === 'yearly' || s.cycle === 'weekly') ? s.cycle : 'monthly';
  return {
    id:          s.id || uid(),
    name:        String(s.name).slice(0, 60),
    amount:      Math.max(0, Number(s.amount) || 0),
    cycle,
    nextRenewal: s.nextRenewal,
    category:    CATEGORIES.includes(s.category) ? s.category : 'その他',
    memo:        s.memo ? String(s.memo).slice(0, 120) : '',
    createdAt:   s.createdAt || todayISO(),
  };
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subs));
  } catch (err) {
    showToast('保存に失敗しました（ストレージ容量を確認してください）');
  }
}

function persistRatings() {
  try {
    localStorage.setItem(STORAGE_KEY_RATINGS, JSON.stringify(ratings));
  } catch (err) {
    showToast('評価の保存に失敗しました');
  }
}

// ── Date helpers (timezone-safe) ─────────
function parseYMD(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toYMD(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function todayISO()      { return toYMD(new Date()); }
function dateInDays(n)   { const d = new Date(); d.setDate(d.getDate() + n); return toYMD(d); }

function daysUntil(dateStr) {
  const now    = new Date(); now.setHours(0, 0, 0, 0);
  const target = parseYMD(dateStr); target.setHours(0, 0, 0, 0);
  return Math.round((target - now) / 86400000);
}

function advanceCycle(dateStr, cycle) {
  const d = parseYMD(dateStr);
  if (cycle === 'weekly') {
    d.setDate(d.getDate() + 7);
  } else if (cycle === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
  }
  return toYMD(d);
}

function monthlyEquivalent(s) {
  const a = Number(s.amount) || 0;
  if (s.cycle === 'yearly') return a / 12;
  if (s.cycle === 'weekly') return a * 52 / 12;
  return a;
}

// ── Rating period helpers ────────────────
function periodForEval(s) {
  // The calendar month immediately before the next renewal date
  const d = parseYMD(s.nextRenewal);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function periodLabel(period) {
  const [y, m] = period.split('-').map(Number);
  return `${y}年${m}月`;
}

function findRating(subId, period) {
  return ratings.find(r => r.subId === subId && r.period === period);
}

function shouldShowEval(s, period) {
  const [y, m] = period.split('-').map(Number);
  const periodStart = new Date(y, m - 1, 1);
  const created = parseYMD(s.createdAt);
  return created <= periodStart;
}

// ── Display helpers ──────────────────────
function badgeClass(days) {
  if (days <= 7)  return 'badge-danger';
  if (days <= 14) return 'badge-warning';
  return 'badge-ok';
}

function cardClass(days) {
  if (days <= 7)  return 'urgent';
  if (days <= 14) return 'soon';
  return '';
}

function daysLabel(days) {
  if (days < 0)   return `${Math.abs(days)}日超過`;
  if (days === 0) return '今日更新';
  return `あと${days}日`;
}

function formatDate(dateStr) {
  const d = parseYMD(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function yen(n) {
  return `¥${Math.round(n).toLocaleString()}`;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ── Render ───────────────────────────────
function render() {
  renderHeader();
  renderSummary();
  renderAlert();
  renderList();
  renderCalendar();
  renderEval();
}

function renderSummary() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();

  let thisMonthTotal = 0, thisMonthCount = 0;
  subs.forEach(s => {
    const d = parseYMD(s.nextRenewal);
    if (d.getFullYear() === y && d.getMonth() === m) {
      thisMonthTotal += Number(s.amount) || 0;
      thisMonthCount++;
    }
  });

  const monthly = subs.reduce((sum, s) => sum + monthlyEquivalent(s), 0);

  document.getElementById('summary-this-month').textContent       = yen(thisMonthTotal);
  document.getElementById('summary-this-month-count').textContent = `${thisMonthCount}件`;
  document.getElementById('summary-yearly').textContent           = yen(monthly * 12);
  document.getElementById('summary-monthly-equiv').textContent    = `月額換算 ${yen(monthly)}`;
}

function renderHeader() {
  const monthly = subs.reduce((sum, s) => sum + monthlyEquivalent(s), 0);
  document.getElementById('total-monthly').textContent = yen(monthly);
  document.getElementById('total-yearly').textContent  = yen(monthly * 12);
  document.getElementById('sub-count').textContent     = `${subs.length}件`;
}

function renderAlert() {
  const items = subs
    .map(s => ({ s, d: daysUntil(s.nextRenewal) }))
    .filter(({ d }) => d <= 7)
    .sort((a, b) => a.d - b.d);

  const banner = document.getElementById('alert-banner');
  if (items.length === 0) {
    banner.style.display = 'none';
    return;
  }

  const overdue = items.filter(x => x.d < 0).length;
  const prefix  = overdue > 0 ? `⚠️ 更新期限超過 ${overdue}件 / ` : '⚠️ まもなく更新: ';
  const names   = items.map(({ s, d }) => `${s.name}（${daysLabel(d)}）`).join('、');
  document.getElementById('alert-text').textContent = prefix + names;
  banner.style.display = 'block';
}

function getVisibleSubs() {
  const q = searchQuery.trim().toLowerCase();
  return subs.filter(s => {
    if (filterCategory && s.category !== filterCategory) return false;
    if (q && !s.name.toLowerCase().includes(q) && !(s.memo || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderList() {
  const list      = document.getElementById('sub-list');
  const empty     = document.getElementById('empty-state');
  const emptyText = document.getElementById('empty-text');
  const emptyBtn  = document.getElementById('btn-add-empty');

  if (subs.length === 0) {
    list.innerHTML        = '';
    empty.style.display   = 'block';
    emptyText.textContent = 'サブスクがまだ登録されていません';
    emptyBtn.style.display = '';
    return;
  }

  const visible = getVisibleSubs();
  if (visible.length === 0) {
    list.innerHTML        = '';
    empty.style.display   = 'block';
    emptyText.textContent = '条件に一致するサブスクはありません';
    emptyBtn.style.display = 'none';
    return;
  }

  empty.style.display = 'none';

  const sorted = visible
    .map(s => ({ s, d: daysUntil(s.nextRenewal) }))
    .sort((a, b) => a.d - b.d);

  list.innerHTML = sorted.map(({ s, d }) => {
    const memo       = s.memo ? `<br>${esc(s.memo)}` : '';
    const cycleLabel = CYCLE_LABEL[s.cycle] || '月';
    const equiv      = s.cycle !== 'monthly'
      ? `<div class="card-equiv">≈ ${yen(monthlyEquivalent(s))} / 月</div>`
      : '';
    return `
      <div class="sub-card ${cardClass(d)}">
        <div class="card-top">
          <div class="card-name">${esc(s.name)}</div>
          <span class="badge ${badgeClass(d)}">${daysLabel(d)}</span>
        </div>
        <div class="card-amount">${yen(s.amount)}<small> / ${cycleLabel}</small></div>
        ${equiv}
        <div class="card-category">${esc(s.category)}</div>
        <div class="card-meta">次回更新: ${formatDate(s.nextRenewal)}${memo}</div>
        <div class="card-actions">
          <button type="button" class="btn-pay"    data-id="${s.id}" title="次サイクルへ更新">✓ 支払済</button>
          <button type="button" class="btn-edit"   data-id="${s.id}">編集</button>
          <button type="button" class="btn-delete" data-id="${s.id}">削除</button>
        </div>
      </div>`;
  }).join('');
}

function renderCalendar() {
  document.getElementById('calendar-title').textContent = `${calYear}年${calMonth + 1}月`;

  const firstDow   = new Date(calYear, calMonth, 1).getDay();
  const daysInMon  = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrev = new Date(calYear, calMonth, 0).getDate();
  const today      = new Date(); today.setHours(0, 0, 0, 0);

  const map = {};
  subs.forEach(s => {
    const d = parseYMD(s.nextRenewal);
    if (d.getFullYear() === calYear && d.getMonth() === calMonth) {
      const key = d.getDate();
      (map[key] = map[key] || []).push(s);
    }
  });

  const totalCells = Math.ceil((firstDow + daysInMon) / 7) * 7;
  const parts = [];

  for (let i = 0; i < totalCells; i++) {
    let day, otherMonth = false, monthOffset = 0;

    if (i < firstDow) {
      day = daysInPrev - firstDow + i + 1;
      otherMonth = true;
      monthOffset = -1;
    } else if (i >= firstDow + daysInMon) {
      day = i - firstDow - daysInMon + 1;
      otherMonth = true;
      monthOffset = 1;
    } else {
      day = i - firstDow + 1;
    }

    const cellDate = new Date(calYear, calMonth + monthOffset, day);
    cellDate.setHours(0, 0, 0, 0);
    const isToday = cellDate.getTime() === today.getTime();

    const events = (!otherMonth && map[day]) ? map[day] : [];

    parts.push(`<div class="calendar-day${otherMonth ? ' other-month' : ''}${isToday ? ' today' : ''}">`);
    parts.push(`<div class="day-num">${day}</div>`);
    events.forEach(s => {
      const d   = daysUntil(s.nextRenewal);
      const cls = d <= 7 ? 'urgent' : d <= 14 ? 'soon' : '';
      const lbl = `${s.name} ${yen(s.amount)}/${CYCLE_LABEL[s.cycle] || '月'}`;
      parts.push(`<div class="cal-event ${cls}" title="${esc(lbl)}">${esc(s.name)}</div>`);
    });
    parts.push('</div>');
  }

  document.getElementById('calendar-days').innerHTML = parts.join('');

  renderCalendarSummary(map);
}

function renderCalendarSummary(map) {
  const summaryEl = document.getElementById('calendar-summary');
  const title = `${calYear}年${calMonth + 1}月の支払い予定`;

  const items = [];
  Object.keys(map)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach(day => map[day].forEach(s => items.push({ s, day })));

  if (items.length === 0) {
    summaryEl.innerHTML = `
      <div class="cal-summary-head">
        <h3 class="cal-summary-title">${title}</h3>
      </div>
      <p class="cal-summary-empty">この月の更新予定はありません</p>`;
    return;
  }

  const total = items.reduce((sum, { s }) => sum + (Number(s.amount) || 0), 0);

  summaryEl.innerHTML = `
    <div class="cal-summary-head">
      <h3 class="cal-summary-title">${title}</h3>
      <div class="cal-summary-total">${yen(total)} <span class="cal-summary-count">(${items.length}件)</span></div>
    </div>
    <ul class="cal-summary-list">
      ${items.map(({ s, day }) => {
        const cycleLabel = CYCLE_LABEL[s.cycle] || '月';
        return `
          <li class="cal-summary-item">
            <span class="cal-summary-date">${day}日</span>
            <span class="cal-summary-name">${esc(s.name)}</span>
            <span class="cal-summary-cat">${esc(s.category)}</span>
            <span class="cal-summary-amount">${yen(s.amount)}<small> / ${cycleLabel}</small></span>
          </li>`;
      }).join('')}
    </ul>`;
}

// ── Evaluation tab ───────────────────────
function renderEval() {
  const pendingEl = document.getElementById('eval-pending');
  const historyEl = document.getElementById('eval-history');

  const pendingItems = subs
    .map(s => ({ s, period: periodForEval(s) }))
    .filter(({ s, period }) => !findRating(s.id, period) && shouldShowEval(s, period))
    .sort((a, b) => a.period.localeCompare(b.period));

  if (pendingItems.length === 0) {
    pendingEl.innerHTML = `
      <div class="eval-empty">
        <div class="empty-icon">✨</div>
        <p>評価待ちのサブスクはありません</p>
      </div>`;
  } else {
    pendingEl.innerHTML = `
      <h3 class="eval-section-title">評価待ち (${pendingItems.length}件)</h3>
      ${pendingItems.map(({ s, period }) => `
        <div class="eval-card">
          <div class="eval-card-head">
            <div class="eval-card-name">${esc(s.name)}</div>
            <div class="eval-card-period">${periodLabel(period)}の利用度を評価</div>
          </div>
          <div class="eval-buttons">
            ${RATING_VALUES.map(v => `
              <button type="button" class="eval-btn ${RATING_META[v].cls}"
                      data-action="rate" data-sub="${s.id}" data-period="${period}" data-value="${v}">
                <span class="eval-emoji">${RATING_META[v].emoji}</span>
                <span>${RATING_META[v].label}</span>
              </button>`).join('')}
          </div>
        </div>`).join('')}`;
  }

  const sorted = [...ratings].sort((a, b) => {
    const p = b.period.localeCompare(a.period);
    if (p !== 0) return p;
    return (b.ratedAt || '').localeCompare(a.ratedAt || '');
  });

  if (sorted.length === 0) {
    historyEl.innerHTML = '';
    return;
  }

  historyEl.innerHTML = `
    <h3 class="eval-section-title">履歴 (${sorted.length}件)</h3>
    <div class="eval-history-list">
      ${sorted.map(r => {
        const sub  = subs.find(s => s.id === r.subId);
        const name = sub ? sub.name : '(削除済み)';
        const meta = RATING_META[r.value];
        return `
          <div class="eval-history-item">
            <div class="eval-history-name">${esc(name)}</div>
            <div class="eval-history-period">${periodLabel(r.period)}</div>
            <div class="eval-history-rating ${meta.cls}">${meta.emoji} ${meta.label}</div>
            <button type="button" class="btn-text eval-change"
                    data-action="clear" data-sub="${r.subId}" data-period="${r.period}">変更</button>
          </div>`;
      }).join('')}
    </div>`;
}

function setRating(subId, period, value) {
  const existing = findRating(subId, period);
  if (existing) {
    existing.value   = value;
    existing.ratedAt = todayISO();
  } else {
    ratings.push({ subId, period, value, ratedAt: todayISO() });
  }
  persistRatings();
  renderEval();
  const meta = RATING_META[value];
  const sub  = subs.find(s => s.id === subId);
  if (sub) showToast(`${sub.name} ${periodLabel(period)}: ${meta.emoji} ${meta.label}`);
}

function clearRating(subId, period) {
  const idx = ratings.findIndex(r => r.subId === subId && r.period === period);
  if (idx < 0) return;
  ratings.splice(idx, 1);
  persistRatings();
  renderEval();
}

// ── Tab switching ────────────────────────
function switchTab(tab) {
  document.querySelectorAll('[role="tab"]').forEach(el => {
    const active = el.dataset.tab === tab;
    el.classList.toggle('active', active);
    el.setAttribute('aria-selected', active ? 'true' : 'false');
    el.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('active', v.id === `view-${tab}`);
  });
}

// ── Calendar nav ─────────────────────────
function prevMonth() {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
}

function nextMonth() {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
}

// ── Add / Edit modal ─────────────────────
function openModal(id = null) {
  editingId     = id;
  previousFocus = document.activeElement;
  document.getElementById('modal-title').textContent = id ? 'サブスクを編集' : 'サブスクを追加';

  if (id) {
    const s = subs.find(x => x.id === id);
    if (!s) return;
    document.getElementById('f-name').value     = s.name;
    document.getElementById('f-amount').value   = s.amount;
    document.getElementById('f-cycle').value    = s.cycle;
    document.getElementById('f-renewal').value  = s.nextRenewal;
    document.getElementById('f-category').value = s.category;
    document.getElementById('f-memo').value     = s.memo || '';
  } else {
    document.getElementById('sub-form').reset();
    document.getElementById('f-cycle').value   = 'monthly';
    document.getElementById('f-renewal').value = dateInDays(30);
  }

  document.getElementById('modal-overlay').classList.add('open');
  requestAnimationFrame(() => document.getElementById('f-name').focus());
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  editingId = null;
  if (previousFocus && document.body.contains(previousFocus)) {
    previousFocus.focus();
  }
  previousFocus = null;
}

function saveSub(e) {
  e.preventDefault();
  const name    = document.getElementById('f-name').value.trim();
  const amount  = Number(document.getElementById('f-amount').value);
  const renewal = document.getElementById('f-renewal').value;

  if (!name || !renewal || !(amount >= 1)) {
    showToast('入力内容を確認してください');
    return;
  }

  const existing = editingId ? subs.find(s => s.id === editingId) : null;
  const sub = {
    id:          editingId || uid(),
    name,
    amount,
    cycle:       document.getElementById('f-cycle').value,
    nextRenewal: renewal,
    category:    document.getElementById('f-category').value,
    memo:        document.getElementById('f-memo').value.trim(),
    createdAt:   existing ? existing.createdAt : todayISO(),
  };

  if (editingId) {
    const idx = subs.findIndex(s => s.id === editingId);
    subs[idx] = sub;
  } else {
    subs.push(sub);
  }

  persist();
  closeModal();
  render();
}

// ── Confirm modal (Promise-based) ────────
function showConfirm({ title = '確認', text = '', okLabel = 'OK', danger = false } = {}) {
  return new Promise(resolve => {
    const overlay   = document.getElementById('confirm-overlay');
    const titleEl   = document.getElementById('confirm-title');
    const textEl    = document.getElementById('confirm-text');
    const okBtn     = document.getElementById('btn-confirm-ok');
    const cancelBtn = document.getElementById('btn-confirm-cancel');
    const prevFocus = document.activeElement;

    titleEl.textContent  = title;
    textEl.textContent   = text;
    okBtn.textContent    = okLabel;
    okBtn.className      = danger ? 'btn-danger' : 'btn-save';

    overlay.classList.add('open');
    requestAnimationFrame(() => okBtn.focus());

    const cleanup = (result) => {
      overlay.classList.remove('open');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      if (prevFocus && document.body.contains(prevFocus)) prevFocus.focus();
      resolve(result);
    };
    const onOk      = () => cleanup(true);
    const onCancel  = () => cleanup(false);
    const onOverlay = (e) => { if (e.target === overlay) cleanup(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') { cleanup(false); return; }
      if (e.key === 'Tab')    trapFocus(overlay, e);
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}

// ── Mark as paid ─────────────────────────
function markPaid(id) {
  const s = subs.find(x => x.id === id);
  if (!s) return;
  const prevDate  = s.nextRenewal;
  s.nextRenewal   = advanceCycle(prevDate, s.cycle);
  persist();
  render();
  showToast(`${s.name} を ${formatDate(s.nextRenewal)} に更新しました`, {
    label: '取り消し',
    action: () => {
      const cur = subs.find(x => x.id === id);
      if (!cur) return;
      cur.nextRenewal = prevDate;
      persist();
      render();
    },
  });
}

// ── Delete ───────────────────────────────
async function deleteSub(id) {
  const s = subs.find(x => x.id === id);
  if (!s) return;
  const ok = await showConfirm({
    title:   '削除しますか？',
    text:    `「${s.name}」を削除します。`,
    okLabel: '削除',
    danger:  true,
  });
  if (!ok) return;

  const idx = subs.findIndex(x => x.id === id);
  lastDeleted = { sub: s, idx };
  subs.splice(idx, 1);
  persist();
  render();
  showToast(`「${s.name}」を削除しました`, { label: '取り消し', action: undoDelete });
}

function undoDelete() {
  if (!lastDeleted) return;
  const { sub, idx } = lastDeleted;
  subs.splice(Math.min(idx, subs.length), 0, sub);
  lastDeleted = null;
  persist();
  render();
}

// ── Toast ────────────────────────────────
function showToast(text, action = null) {
  const toast  = document.getElementById('toast');
  const textEl = document.getElementById('toast-text');
  const btn    = document.getElementById('toast-action');
  textEl.textContent = text;

  if (action) {
    btn.textContent = action.label;
    btn.hidden      = false;
    btn.onclick = () => { action.action(); hideToast(); };
  } else {
    btn.hidden  = true;
    btn.onclick = null;
  }

  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('show'));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  const toast = document.getElementById('toast');
  toast.classList.remove('show');
  setTimeout(() => { toast.hidden = true; }, 200);
}

// ── Export / Import ──────────────────────
function exportData() {
  const payload = { subs, ratings, exportedAt: todayISO(), version: 2 };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `subtracker-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(`${subs.length}件のサブスク + ${ratings.length}件の評価をエクスポートしました`);
}

async function importData(file) {
  try {
    const text   = await file.text();
    const parsed = JSON.parse(text);

    let importSubs, importRatings;
    if (Array.isArray(parsed)) {
      importSubs    = parsed.map(normalizeSub).filter(Boolean);
      importRatings = [];
    } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.subs)) {
      importSubs    = parsed.subs.map(normalizeSub).filter(Boolean);
      importRatings = Array.isArray(parsed.ratings) ? parsed.ratings.filter(isValidRating) : [];
    } else {
      throw new Error('invalid format');
    }
    if (importSubs.length === 0) throw new Error('no valid entries');

    const ok = await showConfirm({
      title:   'インポート',
      text:    `${importSubs.length}件のサブスク + ${importRatings.length}件の評価を読み込みます。既存データ（${subs.length}件 / ${ratings.length}件）は置き換えられます。`,
      okLabel: '置き換える',
      danger:  true,
    });
    if (!ok) return;

    subs    = importSubs;
    ratings = importRatings;
    persist();
    persistRatings();
    render();
    showToast('インポートしました');
  } catch (err) {
    showToast('インポートに失敗しました（JSONを確認してください）');
  }
}

// ── Focus trap ───────────────────────────
function trapFocus(container, e) {
  if (e.key !== 'Tab') return;
  const focusable = container.querySelectorAll(
    'button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ── Events ───────────────────────────────
function bindEvents() {
  // Tabs
  const tablist = document.querySelector('[role="tablist"]');
  tablist.addEventListener('click', e => {
    const tab = e.target.closest('[role="tab"]');
    if (tab) switchTab(tab.dataset.tab);
  });
  tablist.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const cur  = tabs.indexOf(document.activeElement);
    if (cur === -1) return;
    let next = cur;
    if      (e.key === 'ArrowRight') next = (cur + 1) % tabs.length;
    else if (e.key === 'ArrowLeft')  next = (cur - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home')       next = 0;
    else if (e.key === 'End')        next = tabs.length - 1;
    e.preventDefault();
    tabs[next].focus();
    switchTab(tabs[next].dataset.tab);
  });

  // Edit modal
  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  document.getElementById('sub-form').addEventListener('submit', saveSub);

  // ESC + focus trap for edit modal
  document.addEventListener('keydown', e => {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay.classList.contains('open')) return;
    if (e.key === 'Escape') { closeModal(); return; }
    trapFocus(overlay, e);
  });

  // Calendar nav
  document.getElementById('btn-prev-month').addEventListener('click', prevMonth);
  document.getElementById('btn-next-month').addEventListener('click', nextMonth);

  // Add buttons
  document.getElementById('btn-add-header').addEventListener('click', () => openModal());
  document.getElementById('btn-add-empty').addEventListener('click', () => openModal());

  // Card actions
  document.getElementById('sub-list').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;
    if (btn.classList.contains('btn-edit'))   openModal(id);
    if (btn.classList.contains('btn-delete')) deleteSub(id);
    if (btn.classList.contains('btn-pay'))    markPaid(id);
  });

  // Evaluation tab actions
  document.getElementById('view-eval').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'rate')  setRating(btn.dataset.sub, btn.dataset.period, btn.dataset.value);
    if (action === 'clear') clearRating(btn.dataset.sub, btn.dataset.period);
  });

  // Search & filter
  document.getElementById('search').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderList();
  });
  document.getElementById('filter-category').addEventListener('change', e => {
    filterCategory = e.target.value;
    renderList();
  });

  // Export / Import
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-import').click();
  });
  document.getElementById('file-import').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = '';
  });
}

// ── Start ────────────────────────────────
init();
