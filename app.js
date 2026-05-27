'use strict';

const STORAGE_KEY = 'subtracker_v1';

let subs = [];
let editingId = null;
let calYear, calMonth;

// ── Init ────────────────────────────────
function init() {
  const raw = localStorage.getItem(STORAGE_KEY);
  subs = raw ? JSON.parse(raw) : [];

  const now = new Date();
  calYear  = now.getFullYear();
  calMonth = now.getMonth();

  bindEvents();
  render();
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(subs));
}

// ── Helpers ─────────────────────────────
function daysUntil(dateStr) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setHours(0, 0, 0, 0);
  return Math.ceil((target - now) / 86400000);
}

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
  if (days < 0)  return `${Math.abs(days)}日超過`;
  if (days === 0) return '今日更新';
  return `あと${days}日`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function dateInDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Render all ──────────────────────────
function render() {
  renderHeader();
  renderAlert();
  renderList();
  renderCalendar();
}

function renderHeader() {
  const total = subs.reduce((sum, s) => sum + Number(s.amount), 0);
  document.getElementById('total-amount').textContent = `¥${total.toLocaleString()}`;
  document.getElementById('sub-count').textContent    = `${subs.length}件`;
}

function renderAlert() {
  const urgent = subs.filter(s => {
    const d = daysUntil(s.nextRenewal);
    return d >= 0 && d <= 7;
  });
  const banner = document.getElementById('alert-banner');
  if (urgent.length === 0) { banner.style.display = 'none'; return; }

  const names = urgent
    .sort((a, b) => daysUntil(a.nextRenewal) - daysUntil(b.nextRenewal))
    .map(s => `${s.name}（${daysLabel(daysUntil(s.nextRenewal))}）`)
    .join('、');

  document.getElementById('alert-text').textContent = `⚠️ まもなく更新: ${names}`;
  banner.style.display = 'block';
}

function renderList() {
  const list  = document.getElementById('sub-list');
  const empty = document.getElementById('empty-state');

  if (subs.length === 0) {
    list.innerHTML      = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const sorted = [...subs].sort((a, b) => daysUntil(a.nextRenewal) - daysUntil(b.nextRenewal));

  list.innerHTML = sorted.map(s => {
    const days = daysUntil(s.nextRenewal);
    const memo = s.memo ? `<br>${esc(s.memo)}` : '';
    return `
      <div class="sub-card ${cardClass(days)}">
        <div class="card-top">
          <div class="card-name">${esc(s.name)}</div>
          <span class="badge ${badgeClass(days)}">${daysLabel(days)}</span>
        </div>
        <div class="card-amount">¥${Number(s.amount).toLocaleString()}<small>/月</small></div>
        <div class="card-category">${esc(s.category)}</div>
        <div class="card-meta">次回更新: ${formatDate(s.nextRenewal)}${memo}</div>
        <div class="card-actions">
          <button class="btn-edit" data-id="${s.id}">編集</button>
          <button class="btn-delete" data-id="${s.id}">削除</button>
        </div>
      </div>`;
  }).join('');
}

function renderCalendar() {
  document.getElementById('calendar-title').textContent = `${calYear}年${calMonth + 1}月`;

  const firstDow   = new Date(calYear, calMonth, 1).getDay();
  const daysInMon  = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrev = new Date(calYear, calMonth, 0).getDate();

  const today = new Date(); today.setHours(0, 0, 0, 0);

  // renewal date → [sub, ...] map for this month
  const map = {};
  subs.forEach(s => {
    const d = new Date(s.nextRenewal);
    if (d.getFullYear() === calYear && d.getMonth() === calMonth) {
      const key = d.getDate();
      (map[key] = map[key] || []).push(s);
    }
  });

  const totalCells = Math.ceil((firstDow + daysInMon) / 7) * 7;
  let html = '';

  for (let i = 0; i < totalCells; i++) {
    let day, otherMonth = false;

    if (i < firstDow) {
      day = daysInPrev - firstDow + i + 1;
      otherMonth = true;
    } else if (i >= firstDow + daysInMon) {
      day = i - firstDow - daysInMon + 1;
      otherMonth = true;
    } else {
      day = i - firstDow + 1;
    }

    const cellDate = new Date(
      calYear,
      otherMonth ? (i < firstDow ? calMonth - 1 : calMonth + 1) : calMonth,
      day
    );
    cellDate.setHours(0, 0, 0, 0);
    const isToday = cellDate.getTime() === today.getTime();

    const events = (!otherMonth && map[day]) ? map[day] : [];

    html += `<div class="calendar-day${otherMonth ? ' other-month' : ''}${isToday ? ' today' : ''}">`;
    html += `<div class="day-num">${day}</div>`;
    events.forEach(s => {
      const d = daysUntil(s.nextRenewal);
      const cls = d <= 7 ? 'urgent' : d <= 14 ? 'soon' : '';
      html += `<div class="cal-event ${cls}" title="${esc(s.name)} ¥${Number(s.amount).toLocaleString()}">${esc(s.name)}</div>`;
    });
    html += '</div>';
  }

  document.getElementById('calendar-days').innerHTML = html;
}

// ── Tab switching ────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(el => {
    el.classList.toggle('active', el.textContent.trim() === (tab === 'list' ? '一覧' : 'カレンダー'));
  });
  document.getElementById('view-list').classList.toggle('active', tab === 'list');
  document.getElementById('view-calendar').classList.toggle('active', tab === 'calendar');
}

// ── Calendar navigation ──────────────────
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

// ── Modal ────────────────────────────────
function openModal(id = null) {
  editingId = id;
  document.getElementById('modal-title').textContent = id ? 'サブスクを編集' : 'サブスクを追加';

  if (id) {
    const s = subs.find(x => x.id === id);
    document.getElementById('f-name').value     = s.name;
    document.getElementById('f-amount').value   = s.amount;
    document.getElementById('f-renewal').value  = s.nextRenewal;
    document.getElementById('f-category').value = s.category;
    document.getElementById('f-memo').value     = s.memo || '';
  } else {
    document.getElementById('sub-form').reset();
    document.getElementById('f-renewal').value = dateInDays(30);
  }

  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('f-name').focus(), 50);
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  editingId = null;
}

function saveSub(e) {
  e.preventDefault();
  const sub = {
    id:          editingId || uid(),
    name:        document.getElementById('f-name').value.trim(),
    amount:      Number(document.getElementById('f-amount').value),
    nextRenewal: document.getElementById('f-renewal').value,
    category:    document.getElementById('f-category').value,
    memo:        document.getElementById('f-memo').value.trim(),
    createdAt:   todayISO(),
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

function deleteSub(id) {
  if (!confirm('このサブスクを削除しますか？')) return;
  subs = subs.filter(s => s.id !== id);
  persist();
  render();
}

// ── Event binding ────────────────────────
function bindEvents() {
  // Tab buttons
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.textContent.trim() === '一覧' ? 'list' : 'calendar';
      switchTab(tab);
    });
  });

  // Modal close buttons
  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);

  // Close on overlay backdrop click
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Close on Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });

  // Form submit
  document.getElementById('sub-form').addEventListener('submit', saveSub);

  // Calendar nav
  document.getElementById('btn-prev-month').addEventListener('click', prevMonth);
  document.getElementById('btn-next-month').addEventListener('click', nextMonth);

  // Add button in header
  document.getElementById('btn-add-header').addEventListener('click', () => openModal());

  // Delegated clicks for edit/delete buttons on cards
  document.getElementById('sub-list').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.classList.contains('btn-edit'))   openModal(id);
    if (btn.classList.contains('btn-delete')) deleteSub(id);
  });

  // Empty state add button
  document.getElementById('btn-add-empty').addEventListener('click', () => openModal());
}

// ── Start ────────────────────────────────
init();
