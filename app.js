// ===================== Mis Gastos - app.js =====================
'use strict';

/* ---------- Datos por defecto ---------- */
const DEFAULT_CATEGORIES = [
  { id: 'alquiler',        name: 'Alquiler',        color: '#4F46E5', icon: '🔑' },
  { id: 'casa',             name: 'Casa',             color: '#16A34A', icon: '🏠' },
  { id: 'colectivo',        name: 'Transporte',       color: '#EA580C', icon: '🚌' },
  { id: 'comida',           name: 'Comida',           color: '#DC2626', icon: '🍔' },
  { id: 'entretenimiento',  name: 'Entretenimiento',  color: '#9333EA', icon: '🎬' },
  { id: 'salud',            name: 'Salud',            color: '#0D9488', icon: '⚕️' },
  { id: 'otros',            name: 'Otros',            color: '#6B7280', icon: '📦' },
];

const VOICE_KEYWORDS = {
  alquiler: ['alquiler', 'renta', 'arriendo'],
  casa: ['casa', 'hogar', 'limpieza', 'mantenimiento', 'muebles'],
  colectivo: ['colectivo', 'bus', 'autobus', 'transporte', 'micro', 'uber', 'taxi', 'nafta', 'bencina', 'combustible', 'peaje', 'subte', 'metro', 'tren', 'colectivos'],
  comida: ['comida', 'almuerzo', 'cena', 'desayuno', 'super', 'supermercado', 'restaurante', 'delivery', 'mercado', 'feria'],
  entretenimiento: ['cine', 'entretenimiento', 'salida', 'streaming', 'netflix', 'bar', 'fiesta', 'juego', 'salidas'],
  salud: ['salud', 'farmacia', 'medico', 'doctor', 'remedio', 'medicamento', 'dentista'],
};

const FILLER_WORDS = new Set(['gaste', 'gasté', 'pague', 'pagué', 'compre', 'compré', 'en', 'de', 'del', 'por', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'pesos', 'peso', 'plata', 'y', 'con']);

/* ---------- Almacenamiento ---------- */
const LS_KEYS = { expenses: 'mg_expenses', categories: 'mg_categories', budgets: 'mg_budgets' };

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

/* ---------- Sincronización con la nube (Claude Artifacts) ----------
   En la versión publicada como Artifact (con la capacidad "artifact"
   habilitada), cada cambio se guarda también en la propia página
   publicada, para que se vea igual sin importar desde qué dispositivo
   se abra el mismo link. En el archivo local (o si la capacidad no está
   disponible) esta sección no hace nada: todo sigue funcionando con
   localStorage como siempre. */
let artifactNs = null;
let pendingPublish = false;
let publishTimer = null;

function scriptSafeText(s) { return s.replace(/<\/script/gi, '<\\/script'); }

function buildSharedDoc(state) {
  if (typeof PAGE_SHELL === 'undefined') return null;
  const dataJson = scriptSafeText(JSON.stringify(state));
  let doc = PAGE_SHELL.replace('%%APP_DATA%%', function () { return dataJson; });
  const selfJson = scriptSafeText(JSON.stringify(PAGE_SHELL));
  const selfScript = '<script>const PAGE_SHELL = ' + selfJson + ';<\/script>';
  // Ojo: usamos el ÚLTIMO "</body>" (no el primero) porque el propio código de
  // esta función contiene el texto "</body>" como literal más arriba (dentro de
  // app.js), y un simple doc.replace() encontraría esa aparición temprana en vez
  // del cierre real del documento.
  const idx = doc.lastIndexOf('</body>');
  if (idx === -1) return null;
  doc = doc.slice(0, idx) + selfScript + doc.slice(idx);
  return doc;
}

async function syncToCloud() {
  if (!artifactNs) return;
  const doc = buildSharedDoc({ expenses, categories, budgets });
  if (!doc) return;
  try {
    await artifactNs.publish(doc);
  } catch (e) {
    // "conflict" es normal (otro dispositivo guardó justo antes): no reintentamos,
    // esa vista se va a actualizar sola. Cualquier otro error queda en silencio;
    // el dato de todos modos sigue seguro en localStorage de este navegador.
  }
}

function schedulePublish() {
  if (!artifactNs) { pendingPublish = true; return; }
  clearTimeout(publishTimer);
  publishTimer = setTimeout(syncToCloud, 900);
}

function readEmbeddedState() {
  try {
    const el = document.getElementById('app-data');
    if (!el) return null;
    const txt = el.textContent.trim();
    if (!txt) return null;
    const data = JSON.parse(txt);
    return (data && typeof data === 'object') ? data : null;
  } catch (e) { return null; }
}

function hasRealData(s) {
  if (!s) return false;
  const hasExpenses = Array.isArray(s.expenses) && s.expenses.length > 0;
  const hasCats = Array.isArray(s.categories) && s.categories.some(c => !DEFAULT_CATEGORIES.some(d => d.id === c.id));
  const b = s.budgets;
  const hasBudgets = !!(b && ((b.monthly && Object.keys(b.monthly).length) || (b.weekly && Object.keys(b.weekly).length)));
  return hasExpenses || hasCats || hasBudgets;
}

if (window.claude && typeof window.claude.use === 'function') {
  window.claude.use('artifact').then((ns) => {
    artifactNs = ns;
    if (ns && pendingPublish) { pendingPublish = false; schedulePublish(); }
  }).catch(() => {});
}

/* ---------- Estado ---------- */
const __embedded = readEmbeddedState();
const __localExpenses = load(LS_KEYS.expenses, []);
const __localCategories = load(LS_KEYS.categories, DEFAULT_CATEGORIES);
const __localBudgets = load(LS_KEYS.budgets, { monthly: {}, weekly: {} });

let expenses, categories, budgets;
if (hasRealData(__embedded)) {
  // La página publicada ya tiene datos reales guardados: es la fuente de verdad.
  expenses = __embedded.expenses || [];
  categories = (Array.isArray(__embedded.categories) && __embedded.categories.length) ? __embedded.categories : DEFAULT_CATEGORIES;
  budgets = (__embedded.budgets && typeof __embedded.budgets === 'object') ? __embedded.budgets : { monthly: {}, weekly: {} };
  save(LS_KEYS.expenses, expenses); save(LS_KEYS.categories, categories); save(LS_KEYS.budgets, budgets);
} else if (hasRealData({ expenses: __localExpenses, categories: __localCategories, budgets: __localBudgets })) {
  // Todavía no hay nada en la nube, pero este navegador ya tenía gastos cargados: los usamos como base y los subimos.
  expenses = __localExpenses; categories = __localCategories; budgets = __localBudgets;
  pendingPublish = true;
} else {
  expenses = []; categories = DEFAULT_CATEGORIES; budgets = { monthly: {}, weekly: {} };
}

function persistExpenses() { save(LS_KEYS.expenses, expenses); schedulePublish(); }
function persistCategories() { save(LS_KEYS.categories, categories); schedulePublish(); }
function persistBudgets() { save(LS_KEYS.budgets, budgets); schedulePublish(); }

function categoryById(id) { return categories.find(c => c.id === id) || categories[categories.length - 1]; }

/* ---------- Utilidades de fecha ---------- */
function toLocalISO(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayStr() { return toLocalISO(new Date()); }
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfWeek(d) { // lunes
  const day = d.getDay(); // 0=domingo
  const diff = (day === 0 ? -6 : 1 - day);
  const r = new Date(d); r.setDate(d.getDate() + diff); r.setHours(0, 0, 0, 0); return r;
}
function endOfWeek(d) { const s = startOfWeek(d); const r = new Date(s); r.setDate(s.getDate() + 6); return r; }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_ABR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function monthLabel(d) { return `${MESES[d.getMonth()]} ${d.getFullYear()}`; }
function weekLabel(d) {
  const s = startOfWeek(d), e = endOfWeek(d);
  if (s.getFullYear() !== e.getFullYear()) return `${s.getDate()} ${MESES_ABR[s.getMonth()]} ${s.getFullYear()} – ${e.getDate()} ${MESES_ABR[e.getMonth()]} ${e.getFullYear()}`;
  if (s.getMonth() !== e.getMonth()) return `${s.getDate()} ${MESES_ABR[s.getMonth()]} – ${e.getDate()} ${MESES_ABR[e.getMonth()]} ${e.getFullYear()}`;
  return `${s.getDate()} – ${e.getDate()} ${MESES_ABR[s.getMonth()]} ${e.getFullYear()}`;
}

function fmtMoney(n) {
  n = Math.round(n || 0);
  try { return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n); }
  catch (e) { return '$' + n.toLocaleString(); }
}
function fmtShort(n) {
  n = Math.round(n || 0);
  if (Math.abs(n) >= 1000) return Math.round(n / 1000) + 'k';
  return String(n);
}

/* ---------- Estado de período ---------- */
let mode = 'month'; // 'month' | 'week'
let monthAnchor = startOfMonth(new Date());
let weekAnchor = startOfWeek(new Date());
let historyFilter = 'all';

function currentRange() {
  if (mode === 'month') return { start: startOfMonth(monthAnchor), end: endOfMonth(monthAnchor) };
  return { start: startOfWeek(weekAnchor), end: endOfWeek(weekAnchor) };
}
function expensesInRange(start, end) {
  const s = toLocalISO(start), e = toLocalISO(end);
  return expenses.filter(x => x.date >= s && x.date <= e);
}
function currentPeriodExpenses() { const { start, end } = currentRange(); return expensesInRange(start, end); }

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- Render: header/período/resumen ---------- */
function renderPeriodHeader() {
  document.getElementById('periodLabel').textContent = mode === 'month' ? monthLabel(monthAnchor) : weekLabel(weekAnchor);
  document.getElementById('modeMonthBtn').classList.toggle('active', mode === 'month');
  document.getElementById('modeWeekBtn').classList.toggle('active', mode === 'week');
  document.getElementById('weeklyBarsCard').style.display = mode === 'month' ? '' : 'none';
}

function renderSummary() {
  const items = currentPeriodExpenses();
  const total = items.reduce((a, x) => a + x.amount, 0);
  document.getElementById('sumTotal').textContent = fmtMoney(total);

  const budgetMap = mode === 'month' ? budgets.monthly : budgets.weekly;
  const totalBudget = categories.reduce((a, c) => a + (Number(budgetMap[c.id]) || 0), 0);

  const pctEl = document.getElementById('sumPct');
  const bar = document.getElementById('sumBar');
  if (totalBudget > 0) {
    const pct = (total / totalBudget) * 100;
    pctEl.textContent = Math.round(pct) + '%';
    bar.style.width = Math.min(pct, 100) + '%';
    bar.classList.toggle('over', pct > 100);
  } else {
    pctEl.textContent = 'Sin definir';
    bar.style.width = '0%';
    bar.classList.remove('over');
  }
}

/* ---------- Tab: Registrar ---------- */
let selectedAddCat = DEFAULT_CATEGORIES[0].id;

function renderAddCatGrid() {
  const grid = document.getElementById('addCatGrid');
  grid.innerHTML = '';
  categories.forEach(cat => {
    const chip = document.createElement('div');
    chip.className = 'cat-chip' + (cat.id === selectedAddCat ? ' selected' : '');
    chip.innerHTML = `<div class="dot" style="background:${cat.color}"></div>${cat.icon} ${cat.name}`;
    chip.addEventListener('click', () => { selectedAddCat = cat.id; renderAddCatGrid(); });
    grid.appendChild(chip);
  });
}

function addExpense() {
  const amountInput = document.getElementById('addAmount');
  const amount = parseFloat(amountInput.value);
  if (!amount || amount <= 0) { toast('Ingresá un monto válido'); return; }
  const desc = document.getElementById('addDesc').value.trim();
  const date = document.getElementById('addDate').value || todayStr();
  const cat = categoryById(selectedAddCat);
  expenses.push({
    id: 'e' + Date.now() + Math.random().toString(36).slice(2, 7),
    amount, categoryId: cat.id,
    description: desc || cat.name,
    date, createdAt: Date.now(),
  });
  persistExpenses();
  amountInput.value = '';
  document.getElementById('addDesc').value = '';
  document.getElementById('addDate').value = todayStr();
  toast('Gasto agregado ✓');
  renderAll();
}

/* ---------- Tab: Voz ---------- */
let recognition = null;
let listening = false;
let voicePending = null;
let selectedVoiceCat = null;

function renderVpCatGrid() {
  const grid = document.getElementById('vpCatGrid');
  if (!grid) return;
  grid.innerHTML = '';
  categories.forEach(cat => {
    const chip = document.createElement('div');
    chip.className = 'cat-chip' + (cat.id === selectedVoiceCat ? ' selected' : '');
    chip.innerHTML = `<div class="dot" style="background:${cat.color}"></div>${cat.icon} ${cat.name}`;
    chip.addEventListener('click', () => { selectedVoiceCat = cat.id; renderVpCatGrid(); });
    grid.appendChild(chip);
  });
}

function normalizeText(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function parseVoiceText(text) {
  const norm = normalizeText(text);
  const amountMatch = norm.match(/\d+(?:[.,]\d+)?/);
  // Los montos se hablan como enteros (pesos, sin decimales), así que cualquier
  // separador detectado (3.500 / 3,500) se interpreta como separador de miles.
  let amount = amountMatch ? parseInt(amountMatch[0].replace(/[.,]/g, ''), 10) : null;

  let foundCatId = null;
  for (const cat of categories) {
    const keywords = VOICE_KEYWORDS[cat.id] || [normalizeText(cat.name)];
    if (keywords.some(k => norm.includes(k))) { foundCatId = cat.id; break; }
  }
  if (!foundCatId) foundCatId = 'otros';

  const keywordsUsed = VOICE_KEYWORDS[foundCatId] || [normalizeText(categoryById(foundCatId).name)];
  const words = text.split(/\s+/).filter(Boolean);
  const leftover = words.filter(w => {
    const nw = normalizeText(w).replace(/[^a-z0-9]/g, '');
    if (!nw) return false;
    if (/^\d+([.,]\d+)?$/.test(nw)) return false;
    if (FILLER_WORDS.has(nw)) return false;
    if (keywordsUsed.includes(nw)) return false;
    return true;
  });
  let description = leftover.join(' ').trim();
  if (description) description = description.charAt(0).toUpperCase() + description.slice(1);
  if (!description) description = categoryById(foundCatId).name;

  return { amount, categoryId: foundCatId, description };
}

function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById('micBtn');
  if (!SR) {
    document.getElementById('voiceUnsupported').style.display = 'block';
    micBtn.disabled = true;
    micBtn.style.opacity = '0.4';
    return;
  }
  recognition = new SR();
  recognition.lang = (navigator.language && navigator.language.startsWith('es')) ? navigator.language : 'es-CL';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    listening = true;
    micBtn.classList.add('listening');
    document.getElementById('micStatus').textContent = 'Escuchando… hablá ahora';
  };
  recognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    const tEl = document.getElementById('voiceTranscript');
    tEl.style.display = 'block';
    tEl.textContent = '"' + text + '"';
    const parsed = parseVoiceText(text);
    voicePending = true; // hay una previsualización activa para editar/guardar
    document.getElementById('vpAmount').value = parsed.amount || '';
    document.getElementById('vpDesc').value = parsed.description;
    document.getElementById('vpDate').value = todayStr();
    selectedVoiceCat = parsed.categoryId;
    renderVpCatGrid();
    document.getElementById('voicePreview').style.display = 'block';
    document.getElementById('micStatus').textContent = parsed.amount
      ? 'Revisá los datos y tocá "Guardar" (podés corregir cualquier campo)'
      : 'No detecté el monto — completalo abajo antes de guardar';
  };
  recognition.onerror = (e) => {
    document.getElementById('micStatus').textContent = 'No entendí bien, probá de nuevo';
  };
  recognition.onend = () => {
    listening = false;
    micBtn.classList.remove('listening');
  };

  micBtn.addEventListener('click', () => {
    if (listening) { recognition.stop(); return; }
    document.getElementById('voicePreview').style.display = 'none';
    document.getElementById('voiceTranscript').style.display = 'none';
    voicePending = null;
    try { recognition.start(); } catch (e) { /* ya iniciado */ }
  });

  document.getElementById('vpConfirm').addEventListener('click', () => {
    if (!voicePending) return;
    const amount = parseFloat(document.getElementById('vpAmount').value);
    if (!amount || amount <= 0) { toast('Ingresá un monto válido'); return; }
    const catId = selectedVoiceCat || 'otros';
    const desc = document.getElementById('vpDesc').value.trim() || categoryById(catId).name;
    const date = document.getElementById('vpDate').value || todayStr();
    expenses.push({
      id: 'e' + Date.now() + Math.random().toString(36).slice(2, 7),
      amount, categoryId: catId, description: desc, date, createdAt: Date.now(),
    });
    persistExpenses();
    voicePending = null;
    document.getElementById('voicePreview').style.display = 'none';
    document.getElementById('voiceTranscript').style.display = 'none';
    document.getElementById('micStatus').textContent = 'Guardado ✓ Tocá el micrófono para otro gasto';
    toast('Gasto agregado por voz ✓');
    renderAll();
  });
  document.getElementById('vpCancel').addEventListener('click', () => {
    voicePending = null;
    document.getElementById('voicePreview').style.display = 'none';
    document.getElementById('micStatus').textContent = 'Toca el micrófono y di algo como "Gasté 3500 en colectivo"';
  });
}

/* ---------- Tab: Historial ---------- */
function renderHistoryFilters() {
  const wrap = document.getElementById('histFilters');
  wrap.innerHTML = '';
  const all = document.createElement('div');
  all.className = 'filter-chip' + (historyFilter === 'all' ? ' active' : '');
  all.textContent = 'Todas';
  all.addEventListener('click', () => { historyFilter = 'all'; renderHistory(); renderHistoryFilters(); });
  wrap.appendChild(all);
  categories.forEach(cat => {
    const chip = document.createElement('div');
    chip.className = 'filter-chip' + (historyFilter === cat.id ? ' active' : '');
    chip.textContent = cat.icon + ' ' + cat.name;
    chip.addEventListener('click', () => { historyFilter = cat.id; renderHistory(); renderHistoryFilters(); });
    wrap.appendChild(chip);
  });
}

function renderHistory() {
  const list = document.getElementById('histList');
  let items = currentPeriodExpenses();
  if (historyFilter !== 'all') items = items.filter(x => x.categoryId === historyFilter);
  items = items.slice().sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

  if (items.length === 0) {
    list.innerHTML = '<div class="empty">No hay gastos registrados en este período.</div>';
    return;
  }
  list.innerHTML = '';
  items.forEach(x => {
    const cat = categoryById(x.categoryId);
    const row = document.createElement('div');
    row.className = 'hist-item';
    const d = parseISO(x.date);
    row.innerHTML = `
      <div class="hist-dot" style="background:${cat.color}22;color:${cat.color}">${cat.icon}</div>
      <div class="hist-info">
        <div class="desc">${escapeHtml(x.description)}</div>
        <div class="meta">${cat.name} · ${d.getDate()} ${MESES_ABR[d.getMonth()]}</div>
      </div>
      <div class="hist-amount">${fmtMoney(x.amount)}</div>
      <button class="hist-del" data-id="${x.id}">✕</button>`;
    list.appendChild(row);
  });
  list.querySelectorAll('.hist-del').forEach(btn => {
    btn.addEventListener('click', () => {
      expenses = expenses.filter(x => x.id !== btn.dataset.id);
      persistExpenses();
      toast('Gasto eliminado');
      renderAll();
    });
  });
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------- Tab: Gráfico ---------- */
function renderDonut() {
  const items = currentPeriodExpenses();
  const total = items.reduce((a, x) => a + x.amount, 0);
  const svg = document.getElementById('donutSvg');
  const legend = document.getElementById('donutLegend');
  const emptyEl = document.getElementById('donutEmpty');
  svg.innerHTML = '';
  legend.innerHTML = '';

  if (total <= 0) { emptyEl.style.display = 'block'; return; }
  emptyEl.style.display = 'none';

  const byCategory = {};
  items.forEach(x => { byCategory[x.categoryId] = (byCategory[x.categoryId] || 0) + x.amount; });
  const rows = categories
    .map(c => ({ cat: c, amount: byCategory[c.id] || 0 }))
    .filter(r => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const r = 70, cx = 90, cy = 90, sw = 26;
  const circumference = 2 * Math.PI * r;
  const ns = 'http://www.w3.org/2000/svg';

  const bg = document.createElementNS(ns, 'circle');
  bg.setAttribute('cx', cx); bg.setAttribute('cy', cy); bg.setAttribute('r', r);
  bg.setAttribute('fill', 'none'); bg.setAttribute('stroke', '#EEF0F3'); bg.setAttribute('stroke-width', sw);
  svg.appendChild(bg);

  const group = document.createElementNS(ns, 'g');
  group.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
  svg.appendChild(group);

  let cumulative = 0;
  rows.forEach(row => {
    const pct = row.amount / total;
    const dash = pct * circumference;
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', r);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', row.cat.color);
    circle.setAttribute('stroke-width', sw);
    circle.setAttribute('stroke-dasharray', `${dash} ${circumference - dash}`);
    circle.setAttribute('stroke-dashoffset', -cumulative);
    group.appendChild(circle);
    cumulative += dash;
  });

  const t1 = document.createElementNS(ns, 'text');
  t1.setAttribute('x', cx); t1.setAttribute('y', cy - 4); t1.setAttribute('text-anchor', 'middle');
  t1.setAttribute('font-size', '10'); t1.setAttribute('fill', '#6B7280'); t1.textContent = 'Total';
  svg.appendChild(t1);
  const t2 = document.createElementNS(ns, 'text');
  t2.setAttribute('x', cx); t2.setAttribute('y', cy + 14); t2.setAttribute('text-anchor', 'middle');
  t2.setAttribute('font-size', '14'); t2.setAttribute('font-weight', '700'); t2.setAttribute('fill', '#111827');
  t2.textContent = fmtShort(total);
  svg.appendChild(t2);

  rows.forEach(row => {
    const pct = Math.round((row.amount / total) * 100);
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<div class="legend-dot" style="background:${row.cat.color}"></div>
      <div class="legend-name">${row.cat.icon} ${row.cat.name}</div>
      <div class="legend-amt">${fmtMoney(row.amount)}</div>
      <div class="legend-pct">${pct}%</div>`;
    legend.appendChild(item);
  });
}

function renderWeeklyBars() {
  const wrap = document.getElementById('weeklyBars');
  wrap.innerHTML = '';
  if (mode !== 'month') return;
  const s = startOfMonth(monthAnchor), e = endOfMonth(monthAnchor);
  const items = expensesInRange(s, e);

  const weeks = [];
  let cursor = 1;
  let idx = 1;
  while (cursor <= e.getDate()) {
    const wStart = cursor;
    const wEnd = Math.min(cursor + 6, e.getDate());
    weeks.push({ label: 'Sem ' + idx, start: wStart, end: wEnd, total: 0 });
    cursor = wEnd + 1; idx++;
  }
  items.forEach(x => {
    const day = parseISO(x.date).getDate();
    const w = weeks.find(w => day >= w.start && day <= w.end);
    if (w) w.total += x.amount;
  });
  const max = Math.max(1, ...weeks.map(w => w.total));
  weeks.forEach(w => {
    const col = document.createElement('div');
    col.className = 'bar-col';
    const h = Math.max(3, (w.total / max) * 100);
    col.innerHTML = `<div class="bar-val">${w.total > 0 ? fmtShort(w.total) : ''}</div>
      <div class="bar-fill" style="height:${h}%"></div>
      <div class="bar-label">${w.label}</div>`;
    wrap.appendChild(col);
  });
}

/* ---------- Tab: Presupuesto ---------- */
function renderBudgetSection(containerId, type) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const map = type === 'monthly' ? budgets.monthly : budgets.weekly;
  const range = type === 'monthly' ? { start: startOfMonth(monthAnchor), end: endOfMonth(monthAnchor) } : { start: startOfWeek(weekAnchor), end: endOfWeek(weekAnchor) };
  const items = expensesInRange(range.start, range.end);
  const spentByCat = {};
  items.forEach(x => { spentByCat[x.categoryId] = (spentByCat[x.categoryId] || 0) + x.amount; });

  categories.forEach(cat => {
    const spent = spentByCat[cat.id] || 0;
    const limit = Number(map[cat.id]) || 0;
    const row = document.createElement('div');
    row.className = 'budget-row';
    const pct = limit > 0 ? (spent / limit) * 100 : 0;
    row.innerHTML = `
      <div class="budget-head">
        <div class="budget-name"><span>${cat.icon}</span>${cat.name}</div>
        <input type="number" class="budget-input" placeholder="Sin límite" value="${map[cat.id] || ''}" data-cat="${cat.id}">
      </div>
      <div class="progress-track" style="height:6px;"><div class="progress-fill${pct > 100 ? ' over' : ''}" style="width:${Math.min(pct, 100)}%;height:6px;background:${pct > 100 ? '' : cat.color}"></div></div>
      <div class="budget-sub">${limit > 0 ? `Gastado ${fmtMoney(spent)} de ${fmtMoney(limit)} (${Math.round(pct)}%)` : `Gastado ${fmtMoney(spent)} · sin límite definido`}</div>`;
    container.appendChild(row);
    const input = row.querySelector('.budget-input');
    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      if (!v || v <= 0) delete map[cat.id]; else map[cat.id] = v;
      persistBudgets();
      renderAll();
    });
  });
}

function addCategory() {
  const nameInput = document.getElementById('newCatName');
  const colorInput = document.getElementById('newCatColor');
  const name = nameInput.value.trim();
  if (!name) { toast('Ingresá un nombre'); return; }
  const id = 'c' + Date.now();
  categories.push({ id, name, color: colorInput.value, icon: '🏷️' });
  persistCategories();
  nameInput.value = '';
  toast('Categoría agregada ✓');
  renderAll();
}

/* ---------- CSV ---------- */
function exportCsv() {
  const s = startOfMonth(monthAnchor), e = endOfMonth(monthAnchor);
  const items = expensesInRange(s, e).slice().sort((a, b) => a.date.localeCompare(b.date));
  const rows = [['Fecha', 'Categoría', 'Descripción', 'Monto']];
  items.forEach(x => rows.push([x.date, categoryById(x.categoryId).name, x.description, x.amount]));
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  downloadBlob(csv, `gastos_${monthAnchor.getFullYear()}-${String(monthAnchor.getMonth() + 1).padStart(2, '0')}.csv`, 'text/csv;charset=utf-8;', 'CSV descargado');
}
function csvEscape(v) {
  const s = String(v);
  if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
async function downloadBlob(content, filename, type, successMsg) {
  // En páginas publicadas como Artifact (con la capacidad "downloads" habilitada),
  // se ofrece el archivo mediante la API del visor. En el archivo local (o si no
  // está disponible) se cae al método clásico de descarga del navegador.
  if (window.claude && typeof window.claude.use === 'function') {
    try {
      const downloads = await window.claude.use('downloads');
      if (downloads) {
        await downloads.save({ filename, data: '﻿' + content });
        if (successMsg) toast(successMsg);
        return;
      }
    } catch (e) {
      if (e && e.code === 'declined') return; // el usuario canceló, sin mensaje
      // cualquier otro error: seguir con el método clásico como respaldo
    }
  }
  try {
    const blob = new Blob(['﻿' + content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (successMsg) toast(successMsg);
  } catch (e) {
    toast('No se pudo descargar el archivo');
  }
}

/* ---------- Backup ---------- */
function exportBackup() {
  const data = { expenses, categories, budgets, exportedAt: new Date().toISOString(), app: 'MisGastos', version: 1 };
  downloadBlob(JSON.stringify(data, null, 2), `misgastos_backup_${todayStr()}.json`, 'application/json', 'Backup exportado');
}
function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.expenses)) throw new Error('formato inválido');
      expenses = data.expenses;
      categories = Array.isArray(data.categories) && data.categories.length ? data.categories : DEFAULT_CATEGORIES;
      budgets = data.budgets && typeof data.budgets === 'object' ? data.budgets : { monthly: {}, weekly: {} };
      persistExpenses(); persistCategories(); persistBudgets();
      toast('Backup restaurado ✓');
      renderAll();
    } catch (e) {
      toast('No se pudo leer el archivo');
    }
  };
  reader.readAsText(file);
}

/* ---------- Pestañas ---------- */
function switchTab(pageId) {
  document.querySelectorAll('.tabpage').forEach(p => p.classList.toggle('active', p.id === pageId));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.page === pageId));
}

/* ---------- Render global ---------- */
function renderAll() {
  renderPeriodHeader();
  renderSummary();
  renderAddCatGrid();
  renderHistoryFilters();
  renderHistory();
  renderDonut();
  renderWeeklyBars();
  renderBudgetSection('budgetMonthly', 'monthly');
  renderBudgetSection('budgetWeekly', 'weekly');
}

/* ---------- Inicialización ---------- */
function init() {
  document.getElementById('addDate').value = todayStr();
  renderAddCatGrid();

  document.getElementById('btnAddExpense').addEventListener('click', addExpense);
  document.getElementById('btnAddCat').addEventListener('click', addCategory);
  document.getElementById('btnCsv').addEventListener('click', exportCsv);
  document.getElementById('btnBackupExport').addEventListener('click', exportBackup);
  document.getElementById('btnBackupImport').addEventListener('click', () => document.getElementById('backupFile').click());
  document.getElementById('backupFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('modeMonthBtn').addEventListener('click', () => { mode = 'month'; renderAll(); });
  document.getElementById('modeWeekBtn').addEventListener('click', () => { mode = 'week'; renderAll(); });
  document.getElementById('prevPeriod').addEventListener('click', () => {
    if (mode === 'month') monthAnchor = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1);
    else { const d = new Date(weekAnchor); d.setDate(d.getDate() - 7); weekAnchor = startOfWeek(d); }
    renderAll();
  });
  document.getElementById('nextPeriod').addEventListener('click', () => {
    if (mode === 'month') monthAnchor = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1);
    else { const d = new Date(weekAnchor); d.setDate(d.getDate() + 7); weekAnchor = startOfWeek(d); }
    renderAll();
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.page));
  });

  setupVoice();
  renderAll();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
