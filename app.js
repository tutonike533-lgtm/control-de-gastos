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

const FILLER_WORDS = new Set(['gaste', 'gasté', 'pague', 'pagué', 'compre', 'compré', 'en', 'de', 'del', 'por', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'pesos', 'peso', 'plata', 'y', 'con', 'al', 'a', 'para', 'me', 'mi', 'lo', 'se']);

/* ---------- Almacenamiento ---------- */
const LS_KEYS = {
  expenses: 'mg_expenses',
  categories: 'mg_categories',
  budgets: 'mg_budgets',
  incomes: 'mg_incomes',
  livestock: 'mg_livestock',
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) { return fallback; }
}

/* Devuelve true si guardó. El caso que importa es quedarse sin espacio, que en
   la práctica pasa por las fotos del ganado: ahí avisamos en vez de fallar mudo. */
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    const sinEspacio = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
    toast(sinEspacio
      ? 'Sin espacio en el teléfono. Borrá alguna foto de ganado.'
      : 'No se pudo guardar el cambio.');
    return false;
  }
}

/* Cuánto ocupan los datos de la app, para mostrarlo en Ajustes. */
function storageUsedBytes() {
  let total = 0;
  for (const k of Object.values(LS_KEYS)) {
    const v = localStorage.getItem(k);
    if (v) total += v.length + k.length;
  }
  return total * 2; // UTF-16: ~2 bytes por caracter
}
function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

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
  const doc = buildSharedDoc({ expenses, categories, budgets, incomes, livestock });
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
  const hasIncomes = Array.isArray(s.incomes) && s.incomes.length > 0;
  const hasLivestock = Array.isArray(s.livestock) && s.livestock.length > 0;
  const hasCats = Array.isArray(s.categories) && s.categories.some(c => !DEFAULT_CATEGORIES.some(d => d.id === c.id));
  const b = s.budgets;
  const hasBudgets = !!(b && ((b.monthly && Object.keys(b.monthly).length) || (b.weekly && Object.keys(b.weekly).length)));
  return hasExpenses || hasIncomes || hasLivestock || hasCats || hasBudgets;
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
const __localIncomes = load(LS_KEYS.incomes, []);
const __localLivestock = load(LS_KEYS.livestock, []);

let expenses, categories, budgets, incomes, livestock;
if (hasRealData(__embedded)) {
  // La página publicada ya tiene datos reales guardados: es la fuente de verdad.
  expenses = __embedded.expenses || [];
  categories = (Array.isArray(__embedded.categories) && __embedded.categories.length) ? __embedded.categories : DEFAULT_CATEGORIES;
  budgets = (__embedded.budgets && typeof __embedded.budgets === 'object') ? __embedded.budgets : { monthly: {}, weekly: {} };
  incomes = Array.isArray(__embedded.incomes) ? __embedded.incomes : [];
  livestock = Array.isArray(__embedded.livestock) ? __embedded.livestock : [];
  save(LS_KEYS.expenses, expenses); save(LS_KEYS.categories, categories); save(LS_KEYS.budgets, budgets);
  save(LS_KEYS.incomes, incomes); save(LS_KEYS.livestock, livestock);
} else if (hasRealData({ expenses: __localExpenses, categories: __localCategories, budgets: __localBudgets, incomes: __localIncomes, livestock: __localLivestock })) {
  // Todavía no hay nada en la nube, pero este navegador ya tenía datos: los usamos como base y los subimos.
  expenses = __localExpenses; categories = __localCategories; budgets = __localBudgets;
  incomes = __localIncomes; livestock = __localLivestock;
  pendingPublish = true;
} else {
  expenses = []; categories = DEFAULT_CATEGORIES; budgets = { monthly: {}, weekly: {} };
  incomes = []; livestock = [];
}

function persistExpenses() { save(LS_KEYS.expenses, expenses); schedulePublish(); }
function persistCategories() { save(LS_KEYS.categories, categories); schedulePublish(); }
function persistBudgets() { save(LS_KEYS.budgets, budgets); schedulePublish(); }
function persistIncomes() { save(LS_KEYS.incomes, incomes); schedulePublish(); }
function persistLivestock() { return save(LS_KEYS.livestock, livestock) && (schedulePublish(), true); }

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
let mode = 'month'; // 'day' | 'week' | 'month' | 'range'
let monthAnchor = startOfMonth(new Date());
let weekAnchor = startOfWeek(new Date());
let dayAnchor = (function () { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
let rangeStartISO = toLocalISO(startOfMonth(new Date()));
let rangeEndISO = todayStr();
let historyFilter = 'all';
let historyKind = 'all'; // 'all' | 'expense' | 'income'

function currentRange() {
  if (mode === 'day') return { start: dayAnchor, end: dayAnchor };
  if (mode === 'week') return { start: startOfWeek(weekAnchor), end: endOfWeek(weekAnchor) };
  if (mode === 'range') {
    let s = parseISO(rangeStartISO), e = parseISO(rangeEndISO);
    if (s > e) { const t = s; s = e; e = t; } // si los invierte, los damos vuelta
    return { start: s, end: e };
  }
  return { start: startOfMonth(monthAnchor), end: endOfMonth(monthAnchor) };
}
function expensesInRange(start, end) {
  const s = toLocalISO(start), e = toLocalISO(end);
  return expenses.filter(x => x.date >= s && x.date <= e);
}
function incomesInRange(start, end) {
  const s = toLocalISO(start), e = toLocalISO(end);
  return incomes.filter(x => x.date >= s && x.date <= e);
}
function currentPeriodExpenses() { const { start, end } = currentRange(); return expensesInRange(start, end); }
function currentPeriodIncomes() { const { start, end } = currentRange(); return incomesInRange(start, end); }

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
function dayLabel(d) {
  const hoy = todayStr();
  const iso = toLocalISO(d);
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  if (iso === hoy) return 'Hoy · ' + d.getDate() + ' ' + MESES_ABR[d.getMonth()];
  if (iso === toLocalISO(ayer)) return 'Ayer · ' + d.getDate() + ' ' + MESES_ABR[d.getMonth()];
  return DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MESES_ABR[d.getMonth()] + ' ' + d.getFullYear();
}

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
  let label = '';
  if (mode === 'day') label = dayLabel(dayAnchor);
  else if (mode === 'week') label = weekLabel(weekAnchor);
  else if (mode === 'month') label = monthLabel(monthAnchor);
  document.getElementById('periodLabel').textContent = label;

  document.getElementById('modeDayBtn').classList.toggle('active', mode === 'day');
  document.getElementById('modeWeekBtn').classList.toggle('active', mode === 'week');
  document.getElementById('modeMonthBtn').classList.toggle('active', mode === 'month');
  document.getElementById('modeRangeBtn').classList.toggle('active', mode === 'range');

  // En modo rango el usuario elige las fechas a mano, así que las flechas no aplican.
  document.getElementById('periodNav').style.display = mode === 'range' ? 'none' : 'flex';
  document.getElementById('rangeNav').classList.toggle('on', mode === 'range');
  document.getElementById('rangeStart').value = rangeStartISO;
  document.getElementById('rangeEnd').value = rangeEndISO;

  document.getElementById('weeklyBarsCard').style.display = mode === 'month' ? '' : 'none';
}

function renderSummary() {
  const gastos = currentPeriodExpenses().reduce((a, x) => a + x.amount, 0);
  const ingresos = currentPeriodIncomes().reduce((a, x) => a + x.amount, 0);
  const balance = ingresos - gastos;

  document.getElementById('sumTotal').textContent = fmtMoney(gastos);
  document.getElementById('sumIncome').textContent = fmtMoney(ingresos);
  const balEl = document.getElementById('sumBalance');
  balEl.textContent = fmtMoney(balance);
  balEl.classList.toggle('neg', balance < 0);

  // El presupuesto está definido por mes y por semana; en día y rango no aplica.
  const budgetMap = mode === 'week' ? budgets.weekly : budgets.monthly;
  const totalBudget = (mode === 'month' || mode === 'week')
    ? categories.reduce((a, c) => a + (Number(budgetMap[c.id]) || 0), 0)
    : 0;

  const pctEl = document.getElementById('sumPct');
  const bar = document.getElementById('sumBar');
  if (totalBudget > 0) {
    const pct = (gastos / totalBudget) * 100;
    pctEl.textContent = Math.round(pct) + '% de ' + fmtMoney(totalBudget);
    bar.style.width = Math.min(pct, 100) + '%';
    bar.classList.toggle('over', pct > 100);
  } else {
    pctEl.textContent = (mode === 'month' || mode === 'week') ? 'Sin definir' : 'Solo por semana o mes';
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

/* ---------- Tab: Registrar — Ingresos ---------- */
function addIncome() {
  const amountInput = document.getElementById('incAmount');
  const amount = parseFloat(amountInput.value);
  if (!amount || amount <= 0) { toast('Ingresá un monto válido'); return; }
  const sourceInput = document.getElementById('incSource');
  const source = sourceInput.value.trim() || 'Ingreso';
  const date = document.getElementById('incDate').value || todayStr();
  incomes.push({
    id: 'i' + Date.now() + Math.random().toString(36).slice(2, 7),
    amount, source, date, createdAt: Date.now(),
  });
  persistIncomes();
  amountInput.value = '';
  sourceInput.value = '';
  document.getElementById('incDate').value = todayStr();
  toast('Ingreso agregado ✓');
  renderAll();
}

/* Sugerencias de origen: lo que el usuario ya escribió antes, sin repetir. */
function renderIncomeSuggestions() {
  const list = document.getElementById('incSourceList');
  if (!list) return;
  const vistos = [];
  for (let i = incomes.length - 1; i >= 0 && vistos.length < 8; i--) {
    const s = (incomes[i].source || '').trim();
    if (s && !vistos.some(v => v.toLowerCase() === s.toLowerCase())) vistos.push(s);
  }
  if (!vistos.length) vistos.push('Sueldo');
  list.innerHTML = vistos.map(s => '<option value="' + escapeHtml(s) + '"></option>').join('');
}

function setRegisterMode(kind) {
  const esIngreso = kind === 'income';
  document.getElementById('formGasto').style.display = esIngreso ? 'none' : '';
  document.getElementById('formIngreso').style.display = esIngreso ? '' : 'none';
  const gBtn = document.getElementById('segGasto');
  const iBtn = document.getElementById('segIngreso');
  gBtn.classList.toggle('active', !esIngreso);
  iBtn.classList.toggle('active', esIngreso);
  iBtn.classList.toggle('income', esIngreso);
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

/* Locales de dictado que Android/Chrome aceptan realmente. Ojo: navigator.language
   suele devolver "es-419" (español de Latinoamérica), que NO es un locale válido de
   reconocimiento de voz y hace fallar el dictado con language-not-supported. */
const SPEECH_LANGS = [
  'es-AR', 'es-BO', 'es-CL', 'es-CO', 'es-CR', 'es-DO', 'es-EC', 'es-SV',
  'es-ES', 'es-US', 'es-GT', 'es-HN', 'es-MX', 'es-NI', 'es-PA', 'es-PY',
  'es-PE', 'es-PR', 'es-UY', 'es-VE',
];

function pickSpeechLang() {
  const cands = [];
  if (navigator.languages && navigator.languages.length) cands.push(...navigator.languages);
  if (navigator.language) cands.push(navigator.language);
  for (const c of cands) {
    if (!c) continue;
    const norm = String(c).replace('_', '-').toLowerCase();
    const exact = SPEECH_LANGS.find(l => l.toLowerCase() === norm);
    if (exact) return exact;
  }
  // "es", "es-419" o cualquier variante no reconocida → es-US, el de soporte más amplio.
  return 'es-US';
}

const DICTATE_HINT = ' Usá el campo de acá abajo con el micrófono de tu teclado 👇';

const VOICE_ERRORS = {
  'no-speech': 'No escuché nada. Tocá el micrófono y hablá cerca del teléfono.',
  'audio-capture': 'No se pudo usar el micrófono. Fijate que no lo esté usando otra app.',
  'not-allowed': 'Falta el permiso de micrófono para este sitio. Tocá el candado 🔒 al lado de la dirección y activá Micrófono.',
  // Típico en teléfonos sin servicios de Google (Huawei nuevos): el dictado del
  // navegador manda el audio a Google, así que no hay forma de que funcione ahí.
  'service-not-allowed': 'Este teléfono no tiene el servicio de voz de Google.' + DICTATE_HINT,
  'network': 'No se pudo contactar al servicio de voz (necesita internet y servicios de Google).' + DICTATE_HINT,
  'aborted': 'Se cortó la escucha. Probá de nuevo.',
  'language-not-supported': 'Este teléfono no soporta el idioma del dictado.' + DICTATE_HINT,
};

let voiceGotResult = false;

function setMicStatus(msg) {
  const el = document.getElementById('micStatus');
  if (el) el.textContent = msg;
}

/* Muestra la vista previa editable a partir de una frase, venga del dictado del
   navegador o del campo de texto (donde se puede usar el micrófono del teclado
   del teléfono, que funciona incluso sin los servicios de Google). */
function showVoicePreview(text) {
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
  setMicStatus(parsed.amount
    ? 'Revisá los datos y tocá "Guardar" (podés corregir cualquier campo)'
    : 'No detecté el monto — completalo abajo antes de guardar');
}

/* Campo de texto + botón: la vía que sí funciona en teléfonos sin servicios de
   Google (Huawei nuevos, por ejemplo), usando el micrófono del teclado. */
function setupDictateField() {
  const input = document.getElementById('dictateInput');
  const btn = document.getElementById('dictateBtn');
  if (!input || !btn) return;

  const run = () => {
    const text = input.value.trim();
    if (!text) { toast('Escribí o dictá una frase primero'); input.focus(); return; }
    showVoicePreview(text);
    input.value = '';
    input.blur();
  };

  btn.addEventListener('click', run);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); run(); }
  });
}

/* Botones Guardar/Descartar de la vista previa. Van aparte de setupVoice() porque
   se necesitan SIEMPRE: aunque el dictado del navegador no exista, la frase puede
   llegar por el campo de texto. */
function setupVoicePreviewActions() {
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
    setMicStatus('Guardado ✓ Cargá otro gasto cuando quieras');
    toast('Gasto agregado por voz ✓');
    renderAll();
  });
  document.getElementById('vpCancel').addEventListener('click', () => {
    voicePending = null;
    document.getElementById('voicePreview').style.display = 'none';
    document.getElementById('voiceTranscript').style.display = 'none';
    setMicStatus('Toca el micrófono y di algo como "Gasté 3500 en colectivo"');
  });
}

function setupVoice() {
  setupDictateField();        // siempre disponible, funcione o no el dictado del navegador
  setupVoicePreviewActions(); // idem: sin esto el botón "Guardar" no hace nada

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const micBtn = document.getElementById('micBtn');
  if (!SR) {
    document.getElementById('voiceUnsupported').style.display = 'block';
    micBtn.disabled = true;
    micBtn.style.opacity = '0.4';
    return;
  }
  recognition = new SR();
  recognition.lang = pickSpeechLang();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    listening = true;
    voiceGotResult = false;
    micBtn.classList.add('listening');
    setMicStatus('Escuchando… hablá ahora');
  };
  recognition.onresult = (e) => {
    voiceGotResult = true;
    showVoicePreview(e.results[0][0].transcript);
  };
  recognition.onerror = (e) => {
    const code = e && e.error ? e.error : 'desconocido';
    voiceGotResult = true; // ya informamos el problema; que onend no lo pise
    const msg = VOICE_ERRORS[code] || ('Falló el dictado (' + code + '). Probá de nuevo.');
    setMicStatus(msg + '  ·  [' + code + ' / ' + recognition.lang + ']');
  };
  recognition.onend = () => {
    listening = false;
    micBtn.classList.remove('listening');
    if (!voiceGotResult) {
      setMicStatus('No llegó nada del micrófono.' + DICTATE_HINT);
    }
  };

  micBtn.addEventListener('click', async () => {
    if (listening) { recognition.stop(); return; }
    document.getElementById('voicePreview').style.display = 'none';
    document.getElementById('voiceTranscript').style.display = 'none';
    voicePending = null;
    voiceGotResult = false;

    // Pedimos el micrófono explícitamente: en Android esto hace que el diálogo de
    // permiso aparezca de forma confiable ANTES de arrancar el reconocimiento, en vez
    // de que el dictado falle en silencio.
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      setMicStatus('Pidiendo acceso al micrófono…');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
      } catch (err) {
        const name = err && err.name ? err.name : 'error';
        setMicStatus(name === 'NotAllowedError'
          ? 'Bloqueaste el micrófono para este sitio. Tocá el candado 🔒 al lado de la dirección y activá Micrófono.'
          : 'No se pudo abrir el micrófono (' + name + ').');
        return;
      }
    }

    try {
      recognition.lang = pickSpeechLang();
      recognition.start();
    } catch (e) {
      setMicStatus('No se pudo iniciar el dictado: ' + (e && e.message ? e.message : e));
    }
  });

}

/* ---------- Tab: Historial ---------- */
function renderHistoryFilters() {
  // Los filtros por categoría solo tienen sentido cuando se ven gastos.
  const wrap = document.getElementById('histFilters');
  wrap.style.display = historyKind === 'income' ? 'none' : '';
  wrap.innerHTML = '';
  if (historyKind === 'income') return;

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

function setHistoryKind(kind) {
  historyKind = kind;
  document.getElementById('histAll').classList.toggle('active', kind === 'all');
  document.getElementById('histExp').classList.toggle('active', kind === 'expense');
  const incBtn = document.getElementById('histInc');
  incBtn.classList.toggle('active', kind === 'income');
  incBtn.classList.toggle('income', kind === 'income');
  renderHistoryFilters();
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById('histList');
  const filas = [];

  if (historyKind !== 'income') {
    let gastos = currentPeriodExpenses();
    if (historyFilter !== 'all') gastos = gastos.filter(x => x.categoryId === historyFilter);
    gastos.forEach(x => filas.push({ kind: 'expense', item: x }));
  }
  if (historyKind !== 'expense') {
    currentPeriodIncomes().forEach(x => filas.push({ kind: 'income', item: x }));
  }

  filas.sort((a, b) => {
    const k = b.item.date.localeCompare(a.item.date);
    return k !== 0 ? k : (b.item.createdAt || 0) - (a.item.createdAt || 0);
  });

  if (filas.length === 0) {
    const que = historyKind === 'income' ? 'ingresos' : historyKind === 'expense' ? 'gastos' : 'movimientos';
    list.innerHTML = '<div class="empty">No hay ' + que + ' registrados en este período.</div>';
    return;
  }

  list.innerHTML = '';
  filas.forEach(({ kind, item }) => {
    const d = parseISO(item.date);
    const fecha = d.getDate() + ' ' + MESES_ABR[d.getMonth()];
    const row = document.createElement('div');
    row.className = 'hist-item';
    if (kind === 'income') {
      row.innerHTML = `
        <div class="hist-dot" style="background:#16A34A22;color:#16A34A">💵</div>
        <div class="hist-info">
          <div class="desc">${escapeHtml(item.source)}</div>
          <div class="meta">Ingreso · ${fecha}</div>
        </div>
        <div class="hist-amount inc">+${fmtMoney(item.amount)}</div>
        <button class="hist-del" data-id="${item.id}" data-kind="income">✕</button>`;
    } else {
      const cat = categoryById(item.categoryId);
      row.innerHTML = `
        <div class="hist-dot" style="background:${cat.color}22;color:${cat.color}">${cat.icon}</div>
        <div class="hist-info">
          <div class="desc">${escapeHtml(item.description)}</div>
          <div class="meta">${cat.name} · ${fecha}</div>
        </div>
        <div class="hist-amount">${fmtMoney(item.amount)}</div>
        <button class="hist-del" data-id="${item.id}" data-kind="expense">✕</button>`;
    }
    list.appendChild(row);
  });

  list.querySelectorAll('.hist-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (btn.dataset.kind === 'income') {
        incomes = incomes.filter(x => x.id !== id);
        persistIncomes();
        toast('Ingreso eliminado');
      } else {
        expenses = expenses.filter(x => x.id !== id);
        persistExpenses();
        toast('Gasto eliminado');
      }
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

/* ---------- Tab: Ganado ----------
   Las fotos se guardan como data URL dentro de localStorage, que es chico
   (unos pocos MB). Por eso toda foto se reduce y recomprime antes de guardar:
   sin esto, tres o cuatro fotos de cámara llenan el almacenamiento. */
const PHOTO_MAX_DIM = 900;
const PHOTO_QUALITY = 0.7;

function compressImage(file, maxDim = PHOTO_MAX_DIM, quality = PHOTO_QUALITY) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo abrir la imagen'));
      img.onload = () => {
        try {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (!w || !h) { reject(new Error('Imagen vacía')); return; }
          if (w > maxDim || h > maxDim) {
            const escala = maxDim / Math.max(w, h);
            w = Math.max(1, Math.round(w * escala));
            h = Math.max(1, Math.round(h * escala));
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (err) { reject(err); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

let editingAnimalId = null;
let pendingPhoto = null; // data URL de la foto elegida, todavía sin guardar

function setAnimalPhoto(dataUrl) {
  pendingPhoto = dataUrl;
  const prev = document.getElementById('anPhotoPreview');
  const picker = document.getElementById('anPhotoPicker');
  const rm = document.getElementById('anPhotoRemove');
  if (dataUrl) {
    prev.src = dataUrl;
    prev.style.display = '';
    picker.textContent = '📷 Cambiar foto';
    rm.style.display = '';
  } else {
    prev.removeAttribute('src');
    prev.style.display = 'none';
    picker.textContent = '📷 Tocá para sacar una foto o elegir de la galería';
    rm.style.display = 'none';
  }
}

function clearAnimalForm() {
  editingAnimalId = null;
  document.getElementById('anName').value = '';
  document.getElementById('anType').value = 'Vaca';
  document.getElementById('anWeight').value = '';
  document.getElementById('anNotes').value = '';
  setAnimalPhoto(null);
  document.getElementById('animalFormTitle').textContent = 'Agregar animal';
  document.getElementById('btnSaveAnimal').textContent = 'Guardar animal';
  document.getElementById('btnCancelAnimal').style.display = 'none';
}

function startEditAnimal(id) {
  const a = livestock.find(x => x.id === id);
  if (!a) return;
  editingAnimalId = id;
  document.getElementById('anName').value = a.name || '';
  document.getElementById('anType').value = a.type || 'Vaca';
  document.getElementById('anWeight').value = a.weight != null ? a.weight : '';
  document.getElementById('anNotes').value = a.notes || '';
  setAnimalPhoto(a.photo || null);
  document.getElementById('animalFormTitle').textContent = 'Editar animal';
  document.getElementById('btnSaveAnimal').textContent = 'Guardar cambios';
  document.getElementById('btnCancelAnimal').style.display = '';
  document.getElementById('animalFormTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function saveAnimal() {
  const name = document.getElementById('anName').value.trim();
  if (!name) { toast('Ponele un nombre al animal'); return; }
  const type = document.getElementById('anType').value;
  const weightRaw = document.getElementById('anWeight').value;
  const weight = weightRaw === '' ? null : parseFloat(weightRaw);
  if (weight != null && (isNaN(weight) || weight < 0)) { toast('Peso inválido'); return; }
  const notes = document.getElementById('anNotes').value.trim();

  // Guardamos sobre una copia: si no entra en el almacenamiento, dejamos
  // los datos como estaban en vez de perderlos.
  const respaldo = livestock.slice();
  if (editingAnimalId) {
    const a = livestock.find(x => x.id === editingAnimalId);
    if (a) Object.assign(a, { name, type, weight, notes, photo: pendingPhoto || null, updatedAt: Date.now() });
  } else {
    livestock.push({
      id: 'a' + Date.now() + Math.random().toString(36).slice(2, 7),
      name, type, weight, notes,
      photo: pendingPhoto || null,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  }

  if (!persistLivestock()) { livestock = respaldo; renderAll(); return; }
  toast(editingAnimalId ? 'Animal actualizado ✓' : 'Animal agregado ✓');
  clearAnimalForm();
  renderAll();
}

function renderLivestock() {
  const list = document.getElementById('animalList');
  const totalEl = document.getElementById('animalTotal');
  if (!list) return;

  if (livestock.length === 0) {
    list.innerHTML = '<div class="empty">Todavía no cargaste ningún animal. Agregá el primero acá abajo.</div>';
    totalEl.style.display = 'none';
    return;
  }

  const ordenados = livestock.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  list.innerHTML = '';
  ordenados.forEach(a => {
    const row = document.createElement('div');
    row.className = 'animal-card';
    const foto = a.photo
      ? `<img class="animal-photo" src="${a.photo}" alt="${escapeHtml(a.name)}">`
      : `<div class="animal-photo">🐄</div>`;
    const peso = (a.weight != null && a.weight !== '')
      ? `<div class="kg">${a.weight} kg</div>` : '';
    const nota = a.notes ? ` · ${escapeHtml(a.notes)}` : '';
    row.innerHTML = `
      ${foto}
      <div class="animal-info">
        <div class="nm">${escapeHtml(a.name)}</div>
        <div class="tp">${escapeHtml(a.type || '')}${nota}</div>
        ${peso}
      </div>
      <div class="animal-actions">
        <button class="mini-btn" data-edit="${a.id}">Editar</button>
        <button class="mini-btn del" data-del="${a.id}">Borrar</button>
      </div>`;
    list.appendChild(row);
  });

  const conPeso = livestock.filter(a => a.weight != null && a.weight !== '' && !isNaN(a.weight));
  const kilos = conPeso.reduce((s, a) => s + Number(a.weight), 0);
  totalEl.style.display = '';
  totalEl.innerHTML = `<span>${livestock.length} ${livestock.length === 1 ? 'animal' : 'animales'}</span>` +
    (conPeso.length ? `<span>${Math.round(kilos).toLocaleString('es-CL')} kg en total</span>` : '<span></span>');

  list.querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', () => startEditAnimal(b.dataset.edit)));
  list.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => {
      const a = livestock.find(x => x.id === b.dataset.del);
      if (!a) return;
      livestock = livestock.filter(x => x.id !== b.dataset.del);
      persistLivestock();
      if (editingAnimalId === b.dataset.del) clearAnimalForm();
      toast('Animal eliminado');
      renderAll();
    }));
}

function setupLivestock() {
  const picker = document.getElementById('anPhotoPicker');
  const input = document.getElementById('anPhotoInput');
  if (!picker || !input) return;

  picker.addEventListener('click', () => input.click());
  input.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('Eso no parece una imagen'); return; }
    picker.textContent = '⏳ Procesando foto…';
    try {
      const dataUrl = await compressImage(file);
      setAnimalPhoto(dataUrl);
    } catch (err) {
      setAnimalPhoto(pendingPhoto);
      toast('No se pudo procesar la foto');
    }
  });

  document.getElementById('anPhotoRemove').addEventListener('click', () => setAnimalPhoto(null));
  document.getElementById('btnSaveAnimal').addEventListener('click', saveAnimal);
  document.getElementById('btnCancelAnimal').addEventListener('click', () => {
    clearAnimalForm();
    toast('Edición cancelada');
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

/* ---------- CSV ----------
   Exporta el período que se está viendo (día, semana, mes o rango), con
   gastos e ingresos juntos y ordenados por fecha. */
function exportCsv() {
  const { start, end } = currentRange();
  const filas = [];
  expensesInRange(start, end).forEach(x => filas.push({
    date: x.date, tipo: 'Gasto', cat: categoryById(x.categoryId).name,
    detalle: x.description, monto: -x.amount,
  }));
  incomesInRange(start, end).forEach(x => filas.push({
    date: x.date, tipo: 'Ingreso', cat: '', detalle: x.source, monto: x.amount,
  }));
  filas.sort((a, b) => a.date.localeCompare(b.date));

  const rows = [['Fecha', 'Tipo', 'Categoría', 'Detalle', 'Monto']];
  filas.forEach(f => rows.push([f.date, f.tipo, f.cat, f.detalle, f.monto]));
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  downloadBlob(csv, `gastos_${toLocalISO(start)}_a_${toLocalISO(end)}.csv`, 'text/csv;charset=utf-8;', 'CSV descargado');
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
  const data = {
    expenses, categories, budgets, incomes, livestock,
    exportedAt: new Date().toISOString(), app: 'MisGastos', version: 2,
  };
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
      // Backups viejos (version 1) no traen estos campos: quedan vacíos, no rompen.
      incomes = Array.isArray(data.incomes) ? data.incomes : [];
      livestock = Array.isArray(data.livestock) ? data.livestock : [];
      persistExpenses(); persistCategories(); persistBudgets();
      persistIncomes(); persistLivestock();
      clearAnimalForm();
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
  renderIncomeSuggestions();
  renderHistoryFilters();
  renderHistory();
  renderDonut();
  renderWeeklyBars();
  renderLivestock();
  renderBudgetSection('budgetMonthly', 'monthly');
  renderBudgetSection('budgetWeekly', 'weekly');
  renderStorageInfo();
}

function renderStorageInfo() {
  const el = document.getElementById('storageInfo');
  if (!el) return;
  const conFoto = livestock.filter(a => a.photo).length;
  el.textContent = 'Datos guardados: ' + fmtBytes(storageUsedBytes()) +
    (conFoto ? ' · ' + conFoto + (conFoto === 1 ? ' foto de ganado' : ' fotos de ganado') : '');
}

/* ---------- Inicialización ---------- */
function init() {
  document.getElementById('addDate').value = todayStr();
  document.getElementById('incDate').value = todayStr();
  renderAddCatGrid();

  document.getElementById('btnAddExpense').addEventListener('click', addExpense);
  document.getElementById('btnAddIncome').addEventListener('click', addIncome);
  document.getElementById('segGasto').addEventListener('click', () => setRegisterMode('expense'));
  document.getElementById('segIngreso').addEventListener('click', () => setRegisterMode('income'));

  document.getElementById('btnAddCat').addEventListener('click', addCategory);
  document.getElementById('btnCsv').addEventListener('click', exportCsv);
  document.getElementById('btnBackupExport').addEventListener('click', exportBackup);
  document.getElementById('btnBackupImport').addEventListener('click', () => document.getElementById('backupFile').click());
  document.getElementById('backupFile').addEventListener('change', (e) => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = '';
  });

  document.getElementById('histAll').addEventListener('click', () => setHistoryKind('all'));
  document.getElementById('histExp').addEventListener('click', () => setHistoryKind('expense'));
  document.getElementById('histInc').addEventListener('click', () => setHistoryKind('income'));

  document.getElementById('modeDayBtn').addEventListener('click', () => { mode = 'day'; renderAll(); });
  document.getElementById('modeWeekBtn').addEventListener('click', () => { mode = 'week'; renderAll(); });
  document.getElementById('modeMonthBtn').addEventListener('click', () => { mode = 'month'; renderAll(); });
  document.getElementById('modeRangeBtn').addEventListener('click', () => { mode = 'range'; renderAll(); });

  document.getElementById('rangeStart').addEventListener('change', (e) => {
    if (e.target.value) { rangeStartISO = e.target.value; renderAll(); }
  });
  document.getElementById('rangeEnd').addEventListener('change', (e) => {
    if (e.target.value) { rangeEndISO = e.target.value; renderAll(); }
  });

  document.getElementById('prevPeriod').addEventListener('click', () => {
    if (mode === 'day') { const d = new Date(dayAnchor); d.setDate(d.getDate() - 1); dayAnchor = d; }
    else if (mode === 'month') monthAnchor = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() - 1, 1);
    else { const d = new Date(weekAnchor); d.setDate(d.getDate() - 7); weekAnchor = startOfWeek(d); }
    renderAll();
  });
  document.getElementById('nextPeriod').addEventListener('click', () => {
    if (mode === 'day') { const d = new Date(dayAnchor); d.setDate(d.getDate() + 1); dayAnchor = d; }
    else if (mode === 'month') monthAnchor = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 1);
    else { const d = new Date(weekAnchor); d.setDate(d.getDate() + 7); weekAnchor = startOfWeek(d); }
    renderAll();
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.page));
  });

  setupVoice();
  setupLivestock();
  clearAnimalForm();
  renderAll();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
