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
const CYCLE_SAFETY = 5000;
const MAX_PENDING_PERIODS = 12;

let subs           = [];
let ratings        = [];
let editingId      = null;
let calYear, calMonth;
let searchQuery    = '';
let filterCategory = '';
let lastDeleted    = null;
let toastTimer     = null;
let previousFocus  = null;

const els = {};

// ── Init ────────────────────────────────
function init() {
  cacheDom();
  loadData();
  loadRatings();

  const now = new Date();
  calYear  = now.getFullYear();
  calMonth = now.getMonth();

  bindEvents();
  render();
}

function cacheDom() {
  const ids = [
    'total-monthly', 'total-yearly', 'sub-count',
    'summary-this-month', 'summary-this-month-count', 'summary-yearly', 'summary-monthly-equiv',
    'alert-banner', 'cancel-candidates', 'category-breakdown',
    'sub-list', 'empty-state', 'empty-text', 'btn-add-empty',
    'calendar-title', 'calendar-days', 'calendar-summary',
    'eval-pending', 'eval-history', 'view-eval',
    'search', 'filter-category',
    'btn-export', 'btn-import', 'file-import',
    'btn-prev-month', 'btn-next-month', 'btn-add-header',
    'modal-overlay', 'modal-title', 'btn-modal-close', 'btn-cancel', 'sub-form',
    'f-name', 'f-amount', 'f-cycle', 'f-renewal', 'f-category', 'f-memo', 'f-trial',
    'confirm-overlay', 'confirm-title', 'confirm-text', 'btn-confirm-ok', 'btn-confirm-cancel',
    'toast', 'toast-text', 'toast-action',
  ];
  ids.forEach(id => {
    els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
  });
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
  const trial = (typeof s.trialEndsAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.trialEndsAt))
    ? s.trialEndsAt : null;
  const renewalDay = parseYMD(s.nextRenewal).getDate();
  const billingDay = (Number.isInteger(s.billingDay) && s.billingDay >= 1 && s.billingDay <= 31)
    ? s.billingDay : renewalDay;
  return {
    id:           s.id || uid(),
    name:         String(s.name).slice(0, 60),
    amount:       Math.max(0, Number(s.amount) || 0),
    cycle,
    nextRenewal:  s.nextRenewal,
    billingDay,
    category:     CATEGORIES.includes(s.category) ? s.category : 'その他',
    memo:         s.memo ? String(s.memo).slice(0, 120) : '',
    createdAt:    s.createdAt || todayISO(),
    trialEndsAt:  trial,
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

// anchorDay keeps the original billing day across month-end shrinkage
// (e.g. 1/31 stays anchored to 31, so the next March returns to 3/31).
function advanceCycle(dateStr, cycle, anchorDay) {
  const d = parseYMD(dateStr);
  if (cycle === 'weekly') {
    d.setDate(d.getDate() + 7);
    return toYMD(d);
  }
  const day = anchorDay || d.getDate();
  d.setDate(1);
  if (cycle === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toYMD(d);
}

function reverseAdvanceCycle(dateStr, cycle, anchorDay) {
  const d = parseYMD(dateStr);
  if (cycle === 'weekly') {
    d.setDate(d.getDate() - 7);
    return toYMD(d);
  }
  const day = anchorDay || d.getDate();
  d.setDate(1);
  if (cycle === 'yearly') {
    d.setFullYear(d.getFullYear() - 1);
  } else {
    d.setMonth(d.getMonth() - 1);
  }
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toYMD(d);
}

function billingsInMonth(s, year, month) {
  const mm = String(month + 1).padStart(2, '0');
  const lastDay = new Date(year, month + 1, 0).getDate();
  const monthStart = `${year}-${mm}-01`;
  const monthEnd   = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
  const out = [];
  let d = s.nextRenewal;
  let safety = 0;
  while (d > monthEnd && safety++ < CYCLE_SAFETY) {
    d = reverseAdvanceCycle(d, s.cycle, s.billingDay);
  }
  while (d >= monthStart && safety++ < CYCLE_SAFETY) {
    out.push(d);
    d = reverseAdvanceCycle(d, s.cycle, s.billingDay);
  }
  return out.sort();
}

function monthlyEquivalent(s) {
  const a = Number(s.amount) || 0;
  if (s.cycle === 'yearly') return a / 12;
  if (s.cycle === 'weekly') return a * 52 / 12;
  return a;
}

// Active (i.e. not currently within a free trial). Used for headline totals
// so trialing subs don't inflate the "current monthly spend".
function activeMonthlyEquivalent(s) {
  if (isInTrial(s)) return 0;
  return monthlyEquivalent(s);
}

function isInTrial(s) {
  if (!s.trialEndsAt) return false;
  return s.trialEndsAt >= todayISO();
}

// ── Rating period helpers ────────────────
function monthBefore(dateStr) {
  const d = parseYMD(dateStr);
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

// All evaluable periods for a sub: walk back through past billing cycles,
// pick each "month before billing date" that has fully ended and falls
// after the sub was created. Covers cases where markPaid jumped over
// multiple unevaluated cycles.
function pendingPeriodsForSub(s) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const createdMonthStart = parseYMD(s.createdAt);
  createdMonthStart.setDate(1);
  createdMonthStart.setHours(0, 0, 0, 0);

  const periods = [];
  const seen = new Set();
  let billing = s.nextRenewal;
  let safety = 0;
  while (safety++ < CYCLE_SAFETY) {
    const period       = monthBefore(billing);
    const [py, pm]     = period.split('-').map(Number);
    const periodStart  = new Date(py, pm - 1, 1);
    const periodEnd    = new Date(py, pm, 0);
    periodEnd.setHours(0, 0, 0, 0);
    if (today > periodEnd && periodStart >= createdMonthStart && !seen.has(period)) {
      if (!findRating(s.id, period)) periods.push(period);
      seen.add(period);
    }
    const prev = reverseAdvanceCycle(billing, s.cycle, s.billingDay);
    if (prev === billing) break;
    billing = prev;
    if (parseYMD(billing) < createdMonthStart) break;
    if (periods.length >= MAX_PENDING_PERIODS) break;
  }
  return periods;
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

// Folds case, full-width ASCII → half-width, and katakana → hiragana
// so search matches across width/script variants common in Japanese input.
function normalizeText(s) {
  return String(s)
    .toLowerCase()
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ')
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// ── Render ───────────────────────────────
function render() {
  renderHeader();
  renderSummary();
  renderAlert();
  renderCancelCandidates();
  renderList();
  renderCalendar();
  renderEval();
  renderCategoryBreakdown();
}

function getCancelCandidates() {
  return subs.map(s => {
    const rs = ratings
      .filter(r => r.subId === s.id)
      .sort((a, b) => b.period.localeCompare(a.period));
    if (rs.length < 2) return null;
    const recent   = rs.slice(0, 3);
    const lowCount = recent.filter(r => r.value === 'low').length;
    if (lowCount < 2) return null;
    return { sub: s, lowCount, recentLength: recent.length };
  }).filter(Boolean)
    .sort((a, b) => activeMonthlyEquivalent(b.sub) - activeMonthlyEquivalent(a.sub));
}

function renderCancelCandidates() {
  const el = els.cancelCandidates;
  if (!el) return;
  const candidates = getCancelCandidates();
  if (candidates.length === 0) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  const savings = candidates.reduce((sum, c) => sum + activeMonthlyEquivalent(c.sub) * 12, 0);

  el.innerHTML = `
    <div class="cancel-candidates-head">
      <div class="cancel-candidates-titlebox">
        <h3 class="cancel-candidates-title">💸 解約候補（${candidates.length}件）</h3>
        <p class="cancel-candidates-subtitle">最近の評価で「👎ほぼ使わず」が続いています</p>
      </div>
      <div class="cancel-candidates-savings">
        <div class="savings-label">解約で年間節約</div>
        <div class="savings-amount">${yen(savings)}</div>
      </div>
    </div>
    <div class="cancel-candidate-list">
      ${candidates.map(({ sub, lowCount, recentLength }) => `
        <div class="cancel-candidate-card">
          <div class="cc-info">
            <div class="cc-name">${esc(sub.name)}</div>
            <div class="cc-meta">月額換算 ${yen(activeMonthlyEquivalent(sub))}・直近${recentLength}回中 👎${lowCount}回</div>
          </div>
          <div class="cc-actions">
            <button type="button" class="btn-edit"   data-id="${sub.id}">編集</button>
            <button type="button" class="btn-delete" data-id="${sub.id}">解約</button>
          </div>
        </div>
      `).join('')}
    </div>`;
}

function renderCategoryBreakdown() {
  const el = els.categoryBreakdown;
  if (!el) return;
  if (subs.length === 0) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }

  const byCat = {};
  CATEGORIES.forEach(c => { byCat[c] = 0; });
  subs.forEach(s => {
    byCat[s.category] = (byCat[s.category] || 0) + activeMonthlyEquivalent(s);
  });
  const entries = Object.entries(byCat)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  const max   = entries[0][1];
  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  el.innerHTML = `
    <h3 class="breakdown-title">カテゴリ別 月額換算</h3>
    <div class="breakdown-rows">
      ${entries.map(([cat, val]) => {
        const pct      = Math.round((val / total) * 100);
        const barWidth = Math.max(4, (val / max) * 100);
        return `
          <div class="breakdown-row">
            <div class="breakdown-name">${esc(cat)}</div>
            <div class="breakdown-bar-bg"><div class="breakdown-bar" style="width: ${barWidth}%"></div></div>
            <div class="breakdown-amount">${yen(val)} <span class="breakdown-pct">(${pct}%)</span></div>
          </div>`;
      }).join('')}
    </div>`;
}

function renderSummary() {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const today = todayISO();

  let total = 0, paid = 0, upcoming = 0, todayCount = 0;
  subs.forEach(s => {
    billingsInMonth(s, y, m).forEach(dateStr => {
      if (s.trialEndsAt && dateStr <= s.trialEndsAt) return;
      total += Number(s.amount) || 0;
      if (dateStr < today)      paid++;
      else if (dateStr === today) { upcoming++; todayCount++; }
      else                       upcoming++;
    });
  });
  const count = paid + upcoming;

  const monthly = subs.reduce((sum, s) => sum + activeMonthlyEquivalent(s), 0);

  els.summaryThisMonth.textContent = yen(total);
  const todaySuffix = todayCount > 0 ? '・今日含む' : '';
  els.summaryThisMonthCount.textContent =
    count === 0 ? '0件' : `${count}件（支払済 ${paid} / 予定 ${upcoming}${todaySuffix}）`;
  els.summaryYearly.textContent       = yen(monthly * 12);
  els.summaryMonthlyEquiv.textContent = `月額換算 ${yen(monthly)}`;
}

function renderHeader() {
  const monthly = subs.reduce((sum, s) => sum + activeMonthlyEquivalent(s), 0);
  els.totalMonthly.textContent = yen(monthly);
  els.totalYearly.textContent  = yen(monthly * 12);
  els.subCount.textContent     = `${subs.length}件`;
}

function renderAlert() {
  const banner = els.alertBanner;
  const lines  = [];
  let hasDanger = false;

  const renewals = subs
    .map(s => ({ s, d: daysUntil(s.nextRenewal) }))
    .filter(({ d }) => d <= 7)
    .sort((a, b) => a.d - b.d);

  const overdue  = renewals.filter(x => x.d <  0);
  const upcoming = renewals.filter(x => x.d >= 0);

  if (overdue.length > 0) {
    hasDanger = true;
    const names = overdue.map(({ s, d }) => `${esc(s.name)}（${daysLabel(d)}）`).join('、');
    lines.push(`<div class="alert-line line-danger">⚠️ 更新期限超過 ${overdue.length}件: ${names}</div>`);
  }
  if (upcoming.length > 0) {
    const names = upcoming.map(({ s, d }) => `${esc(s.name)}（${daysLabel(d)}）`).join('、');
    lines.push(`<div class="alert-line line-warning">⏰ まもなく更新: ${names}</div>`);
  }

  const trials = subs
    .filter(s => s.trialEndsAt)
    .map(s => ({ s, d: daysUntil(s.trialEndsAt) }))
    .filter(({ d }) => d >= 0 && d <= 7)
    .sort((a, b) => a.d - b.d);

  if (trials.length > 0) {
    const names = trials.map(({ s, d }) => `${esc(s.name)}（${d === 0 ? '本日終了' : 'あと' + d + '日'}）`).join('、');
    lines.push(`<div class="alert-line line-trial">🆓 トライアル終了間近: ${names}</div>`);
  }

  banner.classList.remove('alert-danger', 'alert-warning');
  if (lines.length === 0) {
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  banner.classList.add(hasDanger ? 'alert-danger' : 'alert-warning');
  banner.style.display = 'block';
  banner.innerHTML = lines.join('');
}

function getVisibleSubs() {
  const q = normalizeText(searchQuery.trim());
  return subs.filter(s => {
    if (filterCategory && s.category !== filterCategory) return false;
    if (!q) return true;
    const hay = normalizeText([s.name, s.memo || '', s.category || ''].join(' '));
    return hay.includes(q);
  });
}

function renderList() {
  const list      = els.subList;
  const empty     = els.emptyState;
  const emptyText = els.emptyText;
  const emptyBtn  = els.btnAddEmpty;

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
    let trial = '';
    if (isInTrial(s)) {
      const td = daysUntil(s.trialEndsAt);
      const urgent = td <= 3 ? ' trial-urgent' : '';
      const label = td === 0 ? '🆓 本日トライアル終了' : `🆓 トライアル中（あと${td}日）`;
      trial = `<div class="trial-badge${urgent}">${label}</div>`;
    }
    return `
      <div class="sub-card ${cardClass(d)}">
        <div class="card-top">
          <div class="card-name">${esc(s.name)}</div>
          <span class="badge ${badgeClass(d)}">${daysLabel(d)}</span>
        </div>
        <div class="card-amount">${yen(s.amount)}<small> / ${cycleLabel}</small></div>
        ${equiv}
        ${trial}
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
  els.calendarTitle.textContent = `${calYear}年${calMonth + 1}月`;

  const firstDow   = new Date(calYear, calMonth, 1).getDay();
  const daysInMon  = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrev = new Date(calYear, calMonth, 0).getDate();
  const today      = new Date(); today.setHours(0, 0, 0, 0);

  const map = {};
  subs.forEach(s => {
    billingsInMonth(s, calYear, calMonth).forEach(dateStr => {
      const day = parseYMD(dateStr).getDate();
      (map[day] = map[day] || []).push(s);
    });
  });
  // Highest amount first within a day
  Object.keys(map).forEach(day => {
    map[day].sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
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

  els.calendarDays.innerHTML = parts.join('');

  renderCalendarSummary(map);
}

function renderCalendarSummary(map) {
  const summaryEl = els.calendarSummary;
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
  const pendingEl = els.evalPending;
  const historyEl = els.evalHistory;

  const cancelIds = new Set(getCancelCandidates().map(c => c.sub.id));

  const pendingItems = [];
  subs.forEach(s => {
    pendingPeriodsForSub(s).forEach(period => {
      pendingItems.push({ s, period });
    });
  });
  pendingItems.sort((a, b) => a.period.localeCompare(b.period));

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
            <div class="eval-card-name">
              ${esc(s.name)}
              ${cancelIds.has(s.id) ? '<span class="eval-cancel-badge">💸 解約候補</span>' : ''}
            </div>
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
  renderCancelCandidates();
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
  renderCancelCandidates();
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
  els.modalTitle.textContent = id ? 'サブスクを編集' : 'サブスクを追加';

  if (id) {
    const s = subs.find(x => x.id === id);
    if (!s) return;
    els.fName.value     = s.name;
    els.fAmount.value   = s.amount;
    els.fCycle.value    = s.cycle;
    els.fRenewal.value  = s.nextRenewal;
    els.fCategory.value = s.category;
    els.fMemo.value     = s.memo || '';
    els.fTrial.value    = s.trialEndsAt || '';
  } else {
    els.subForm.reset();
    els.fCycle.value   = 'monthly';
    els.fRenewal.value = dateInDays(30);
    els.fTrial.value   = '';
  }

  els.modalOverlay.classList.add('open');
  requestAnimationFrame(() => els.fName.focus());
}

function closeModal() {
  els.modalOverlay.classList.remove('open');
  editingId = null;
  if (previousFocus && document.body.contains(previousFocus)) {
    previousFocus.focus();
  }
  previousFocus = null;
}

function saveSub(e) {
  e.preventDefault();
  const name    = els.fName.value.trim();
  const amount  = Number(els.fAmount.value);
  const renewal = els.fRenewal.value;

  if (!name || !renewal || !Number.isFinite(amount) || amount < 0) {
    showToast('入力内容を確認してください');
    return;
  }

  const trialRaw = els.fTrial.value;
  const trial    = /^\d{4}-\d{2}-\d{2}$/.test(trialRaw) ? trialRaw : null;
  if (trial && trial < todayISO()) {
    showToast('トライアル終了日は今日以降を指定してください');
    return;
  }

  const existing   = editingId ? subs.find(s => s.id === editingId) : null;
  const renewalDay = parseYMD(renewal).getDate();
  // Re-anchor billingDay when the user edits the renewal date — the new day
  // becomes the canonical "billing day" so future cycles return to it after
  // month-end shrinkage.
  const billingDay = (existing && existing.nextRenewal === renewal)
    ? existing.billingDay
    : renewalDay;

  const sub = {
    id:          editingId || uid(),
    name,
    amount,
    cycle:       els.fCycle.value,
    nextRenewal: renewal,
    billingDay,
    category:    els.fCategory.value,
    memo:        els.fMemo.value.trim(),
    createdAt:   existing ? existing.createdAt : todayISO(),
    trialEndsAt: trial,
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
    const overlay   = els.confirmOverlay;
    const titleEl   = els.confirmTitle;
    const textEl    = els.confirmText;
    const okBtn     = els.btnConfirmOk;
    const cancelBtn = els.btnConfirmCancel;
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
  const prevDate = s.nextRenewal;
  const today    = todayISO();
  let next   = advanceCycle(prevDate, s.cycle, s.billingDay);
  let safety = 0;
  while (next <= today && safety++ < CYCLE_SAFETY) {
    next = advanceCycle(next, s.cycle, s.billingDay);
  }
  s.nextRenewal = next;
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
    text:    `「${s.name}」を削除します。関連する評価履歴も一緒に削除されます。`,
    okLabel: '削除',
    danger:  true,
  });
  if (!ok) return;

  const idx           = subs.findIndex(x => x.id === id);
  const removedRatings = ratings.filter(r => r.subId === id);
  lastDeleted          = { sub: s, idx, ratings: removedRatings };

  subs.splice(idx, 1);
  if (removedRatings.length > 0) {
    ratings = ratings.filter(r => r.subId !== id);
    persistRatings();
  }
  persist();
  render();
  showToast(`「${s.name}」を削除しました`, { label: '取り消し', action: undoDelete });
}

function undoDelete() {
  if (!lastDeleted) return;
  const { sub, idx, ratings: oldRatings } = lastDeleted;
  subs.splice(Math.min(idx, subs.length), 0, sub);
  if (oldRatings && oldRatings.length > 0) {
    ratings = ratings.concat(oldRatings);
    persistRatings();
  }
  lastDeleted = null;
  persist();
  render();
}

// ── Toast ────────────────────────────────
function showToast(text, action = null) {
  const toast  = els.toast;
  const textEl = els.toastText;
  const btn    = els.toastAction;
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
  const toast = els.toast;
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
    console.warn('Import failed:', err);
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
  els.btnModalClose.addEventListener('click', closeModal);
  els.btnCancel.addEventListener('click', closeModal);
  els.modalOverlay.addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  els.subForm.addEventListener('submit', saveSub);

  // ESC + focus trap for edit modal
  document.addEventListener('keydown', e => {
    if (!els.modalOverlay.classList.contains('open')) return;
    if (e.key === 'Escape') { closeModal(); return; }
    trapFocus(els.modalOverlay, e);
  });

  // Calendar nav
  els.btnPrevMonth.addEventListener('click', prevMonth);
  els.btnNextMonth.addEventListener('click', nextMonth);

  // Add buttons
  els.btnAddHeader.addEventListener('click', () => openModal());
  els.btnAddEmpty.addEventListener('click', () => openModal());

  // Card actions
  els.subList.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;
    if (btn.classList.contains('btn-edit'))   openModal(id);
    if (btn.classList.contains('btn-delete')) deleteSub(id);
    if (btn.classList.contains('btn-pay'))    markPaid(id);
  });

  // Cancel candidate panel actions
  els.cancelCandidates.addEventListener('click', e => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains('btn-edit'))   openModal(id);
    if (btn.classList.contains('btn-delete')) deleteSub(id);
  });

  // Evaluation tab actions
  els.viewEval.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'rate')  setRating(btn.dataset.sub, btn.dataset.period, btn.dataset.value);
    if (action === 'clear') clearRating(btn.dataset.sub, btn.dataset.period);
  });

  // Search & filter
  els.search.addEventListener('input', e => {
    searchQuery = e.target.value;
    renderList();
  });
  els.filterCategory.addEventListener('change', e => {
    filterCategory = e.target.value;
    renderList();
  });

  // Export / Import
  els.btnExport.addEventListener('click', exportData);
  els.btnImport.addEventListener('click', () => els.fileImport.click());
  els.fileImport.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importData(file);
    e.target.value = '';
  });
}

// ── Start ────────────────────────────────
init();
