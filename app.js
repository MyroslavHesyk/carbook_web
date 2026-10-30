import {
  buildCsv,
  buildMonthlySpend,
  calculateFuelConsumption,
  calculateTotals,
  escapeHtml,
  formatDate,
  formatMoney,
  formatNumber,
  getReminderState,
  localISODate,
  safeFilename
} from './core.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const PAGE_TITLES = {
  dashboard: 'Огляд', cars: 'Мої автомобілі', fuel: 'Заправки', expenses: 'Витрати',
  service: 'Обслуговування', reminders: 'Нагадування', notes: 'Нотатки', stats: 'Статистика', profile: 'Профіль та дані'
};

const RECORDS = {
  fuel: {
    title: 'Заправки', table: 'fuel_entries', sort: 'date', icon: 'fuel',
    fields: [
      { name: 'date', label: 'Дата заправки', type: 'date', required: true },
      { name: 'odometer', label: 'Пробіг, км', type: 'number', required: true, integer: true, min: 0 },
      { name: 'liters', label: 'Кількість пального, л', type: 'number', required: true, min: 0.01, max: 5000, step: '0.01' },
      { name: 'total_cost', label: 'Загальна сума, грн', type: 'number', required: true, min: 0, step: '0.01' },
      { name: 'station', label: 'АЗС / місце заправки', type: 'text', maxLength: 120 },
      { name: 'fuel_type', label: 'Тип пального', type: 'select', options: ['', 'Бензин', 'Дизель', 'Газ', 'Електроенергія', 'Інше'] },
      { name: 'full_tank', label: 'Заправлено повний бак', type: 'checkbox' },
      { name: 'note', label: 'Коментар', type: 'textarea', full: true }
    ]
  },
  expenses: {
    title: 'Витрати', table: 'expenses', sort: 'date', icon: 'wallet',
    fields: [
      { name: 'date', label: 'Дата', type: 'date', required: true },
      { name: 'category', label: 'Категорія', type: 'select', required: true, options: ['Ремонт', 'Запчастини', 'Мийка та догляд', 'Страхування', 'Податки', 'Паркування', 'Штрафи', 'Інше'] },
      { name: 'amount', label: 'Сума, грн', type: 'number', required: true, min: 0, step: '0.01' },
      { name: 'odometer', label: 'Пробіг, км', type: 'number', integer: true, min: 0 },
      { name: 'description', label: 'Опис витрати', type: 'textarea', full: true }
    ]
  },
  service: {
    title: 'Обслуговування', table: 'service_records', sort: 'date', icon: 'wrench',
    fields: [
      { name: 'date', label: 'Дата робіт', type: 'date', required: true },
      { name: 'odometer', label: 'Пробіг, км', type: 'number', required: true, integer: true, min: 0 },
      { name: 'work_done', label: 'Виконані роботи', type: 'text', required: true, maxLength: 500 },
      { name: 'cost', label: 'Вартість, грн', type: 'number', min: 0, step: '0.01' },
      { name: 'next_odometer', label: 'Наступне ТО, км', type: 'number', integer: true, min: 0 },
      { name: 'next_date', label: 'Наступне ТО, дата', type: 'date' },
      { name: 'details', label: 'Деталі та примітки', type: 'textarea', full: true }
    ]
  },
  reminders: {
    title: 'Нагадування', table: 'reminders', sort: 'due_date', icon: 'bell',
    fields: [
      { name: 'title', label: 'Що потрібно зробити', type: 'text', required: true, maxLength: 200 },
      { name: 'description', label: 'Деталі', type: 'textarea', full: true },
      { name: 'due_date', label: 'Нагадати до дати', type: 'date' },
      { name: 'due_odometer', label: 'Нагадати на пробігу, км', type: 'number', integer: true, min: 0 },
      { name: 'is_done', label: 'Позначити як виконане', type: 'checkbox' }
    ]
  },
  notes: {
    title: 'Нотатки', table: 'notes', sort: 'date', icon: 'note',
    fields: [
      { name: 'date', label: 'Дата', type: 'date', required: true },
      { name: 'content', label: 'Текст нотатки', type: 'textarea', required: true, full: true }
    ]
  }
};

const state = {
  db: null,
  user: null,
  cars: [],
  page: 'dashboard',
  activeCarId: '',
  cache: {},
  authMode: 'signin',
  loadingUserId: null,
  modalSubmit: null
};

function icon(name, extraClass = '') {
  return `<svg class="icon ${extraClass}" aria-hidden="true"><use href="#icon-${escapeHtml(name)}"></use></svg>`;
}

function carName(car) {
  return car ? `${car.make} ${car.model}` : 'Автомобіль';
}

function currentCar() {
  return state.cars.find((car) => String(car.id) === String(state.activeCarId)) || null;
}

function reminderDueText(reminder) {
  const parts = [];
  if (reminder?.due_date) parts.push(formatDate(reminder.due_date));
  if (reminder?.due_odometer !== null && reminder?.due_odometer !== undefined) {
    parts.push(`${formatNumber(reminder.due_odometer)} км`);
  }
  return parts.length ? parts.join(' · ') : 'Строк не визначено';
}

function storageGet(key) {
  try { return window.localStorage.getItem(key) || ''; } catch { return ''; }
}

function storageSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* Storage may be disabled; the app still works for this session. */ }
}

function notify(message, type = 'success') {
  const root = $('#toast-root');
  if (!root) return;
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' is-error' : ''}`;
  toast.innerHTML = `${icon(type === 'error' ? 'info' : 'check')}<span>${escapeHtml(message)}</span>`;
  root.append(toast);
  window.setTimeout(() => toast.remove(), 4400);
}

function showAuthMessage(message, type = '') {
  const node = $('#auth-message');
  node.textContent = message;
  node.classList.toggle('is-error', type === 'error');
  node.classList.toggle('is-success', type === 'success');
}

function friendlyError(error) {
  const message = String(error?.message || error || 'Невідома помилка');
  if (/invalid login credentials/i.test(message)) return 'Неправильна електронна пошта або пароль.';
  if (/email not confirmed/i.test(message)) return 'Підтвердіть електронну пошту, перш ніж увійти.';
  if (/user already registered/i.test(message)) return 'Ця електронна пошта вже зареєстрована. Спробуйте увійти.';
  if (/password should be at least/i.test(message)) return 'Пароль закороткий. Використайте щонайменше 8 символів.';
  if (/row-level security|rls/i.test(message)) return 'База даних відхилила операцію через правила доступу. Перевірте SQL-схему та вхід до акаунта.';
  if (/relation .* does not exist|could not find the table/i.test(message)) return 'Не знайдено таблицю CarBook. Переконайтеся, що SQL-схему виконано в Supabase SQL Editor.';
  if (/failed to fetch|fetch failed|networkerror/i.test(message)) return 'Немає зв’язку із Supabase. Перевірте інтернет, адресу проєкту та API-ключ.';
  if (/duplicate key/i.test(message)) return 'Такий запис уже існує.';
  return message;
}

function setBusy(button, busy, busyText = 'Зачекайте…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `${icon('clock')}<span>${busyText}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.innerHTML = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

function showAuth() {
  const signedIn = Boolean(state.user);
  $('#auth-view').classList.toggle('is-hidden', signedIn);
  $('#app').classList.toggle('is-hidden', !signedIn);
}

function showSetupError(message) {
  showAuthMessage(message, 'error');
  $('#auth-submit').disabled = true;
  $('#auth-mode-toggle').disabled = true;
  $('#forgot-password').disabled = true;
}

function getRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

async function boot() {
  $('#auth-form').addEventListener('submit', handleAuthSubmit);
  $('#auth-mode-toggle').addEventListener('click', toggleAuthMode);
  $('#forgot-password').addEventListener('click', sendPasswordReset);
  $('#logout').addEventListener('click', signOut);
  $('#quick-add').addEventListener('click', openQuickAdd);
  $('#active-car').addEventListener('change', handleCarFilter);
  $('#mobile-menu').addEventListener('click', toggleMobileMenu);
  $('#sidebar-backdrop').addEventListener('click', closeMobileMenu);
  $('#modal-root').addEventListener('click', handleModalClick);
  $('#view-content').addEventListener('click', handleViewClick);
  $('#sidebar').addEventListener('click', handleNavigationClick);
  $('.mobile-bottom-nav').addEventListener('click', handleNavigationClick);
  document.addEventListener('keydown', handleKeydown);

  const config = window.CARBOOK_CONFIG || {};
  const supabaseUrl = String(config.supabaseUrl || '').trim();
  const publishableKey = String(config.publishableKey || config.anonKey || '').trim();
  if (!window.supabase?.createClient) {
    showSetupError('Не завантажилася бібліотека Supabase. Перевірте підключення до інтернету або доступність CDN.');
    return;
  }
  if (!supabaseUrl || !publishableKey || /YOUR_PROJECT|REPLACE_WITH/i.test(`${supabaseUrl} ${publishableKey}`)) {
    showSetupError('Підключення ще не налаштовано. Відкрийте config.js та вставте Project URL і Publishable key із вашого Supabase Project.');
    return;
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
    showSetupError('Адреса Supabase має бути повним Project URL формату https://ваш-проєкт.supabase.co.');
    return;
  }

  state.db = window.supabase.createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  state.db.auth.onAuthStateChange((event, session) => {
    const nextUser = session?.user || null;
    if (event === 'SIGNED_OUT') {
      state.user = null;
      state.cars = [];
      state.cache = {};
      state.activeCarId = '';
      state.page = 'dashboard';
      showAuth();
      return;
    }
    if (nextUser) {
      const changed = state.user?.id !== nextUser.id;
      if (changed) {
        state.cars = [];
        state.cache = {};
        state.activeCarId = '';
      }
      state.user = nextUser;
      showAuth();
      if (event === 'PASSWORD_RECOVERY') {
        window.setTimeout(openPasswordUpdateModal, 0);
      } else if (changed && event !== 'INITIAL_SESSION') {
        // Defer network work until Supabase Auth has finished its state-change callback.
        window.setTimeout(() => { void loadApp(); }, 0);
      }
    }
  });

  try {
    const { data, error } = await state.db.auth.getSession();
    if (error) throw error;
    state.user = data.session?.user || null;
    showAuth();
    if (state.user) await loadApp();
  } catch (error) {
    showAuthMessage(friendlyError(error), 'error');
  }
}

function toggleAuthMode() {
  state.authMode = state.authMode === 'signin' ? 'signup' : 'signin';
  const signup = state.authMode === 'signup';
  $('#auth-heading').textContent = signup ? 'Створення акаунта' : 'Вхід до гаража';
  $('#auth-description').textContent = signup
    ? 'Створіть особистий акаунт, щоб почати вести історію автомобіля.'
    : 'Увійдіть, щоб переглядати історію та керувати автомобілями.';
  $('#auth-submit').innerHTML = signup
    ? `Створити акаунт ${icon('arrow')}`
    : `Увійти до CarBook ${icon('arrow')}`;
  $('#auth-mode-toggle').textContent = signup ? 'У мене вже є акаунт' : 'Створити обліковий запис';
  $('#forgot-password').classList.toggle('is-hidden', signup);
  $('#auth-password').autocomplete = signup ? 'new-password' : 'current-password';
  showAuthMessage(signup ? 'Після реєстрації може знадобитися підтвердження електронної пошти.' : 'Ваш гараж доступний лише після входу.', '');
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!state.db) return;
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const button = $('#auth-submit');
  setBusy(button, true, state.authMode === 'signup' ? 'Створюємо акаунт…' : 'Входимо…');
  try {
    const result = state.authMode === 'signup'
      ? await state.db.auth.signUp({ email, password, options: { emailRedirectTo: getRedirectUrl() } })
      : await state.db.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (state.authMode === 'signup' && !result.data.session) {
      showAuthMessage('Акаунт створено. Перевірте пошту, підтвердіть адресу, а потім увійдіть у CarBook.', 'success');
    } else {
      showAuthMessage('Вхід виконано. Завантажуємо ваш гараж…', 'success');
    }
  } catch (error) {
    showAuthMessage(friendlyError(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function sendPasswordReset() {
  if (!state.db) return;
  const email = $('#auth-email').value.trim();
  if (!email) {
    showAuthMessage('Спочатку введіть електронну пошту у верхнє поле.', 'error');
    $('#auth-email').focus();
    return;
  }
  const button = $('#forgot-password');
  button.disabled = true;
  try {
    const { error } = await state.db.auth.resetPasswordForEmail(email, { redirectTo: getRedirectUrl() });
    if (error) throw error;
    showAuthMessage('Якщо адреса зареєстрована, на неї надійде лист із посиланням для зміни пароля.', 'success');
  } catch (error) {
    showAuthMessage(friendlyError(error), 'error');
  } finally {
    button.disabled = false;
  }
}

async function signOut() {
  if (!state.db) return;
  const { error } = await state.db.auth.signOut();
  if (error) notify(friendlyError(error), 'error');
}

async function loadApp() {
  const userId = state.user?.id;
  if (!userId || state.loadingUserId === userId) return;
  state.loadingUserId = userId;
  $('#user-email').textContent = state.user.email || 'Користувач';
  $('#user-avatar').textContent = (state.user.email || 'U').slice(0, 1).toUpperCase();
  $('#topbar-avatar').textContent = (state.user.email || 'U').slice(0, 1).toUpperCase();
  showAuth();
  $('#view-content').innerHTML = `<div class="empty-state"><div class="empty-illustration">${icon('clock')}</div><h3>Завантажуємо ваш гараж</h3><p>Отримуємо автомобілі та записи з бази даних.</p></div>`;
  try {
    const storedCar = storageGet(`carbook-active-car:${userId}`);
    state.activeCarId = storedCar;
    await loadCars();
    await loadPage();
  } catch (error) {
    notify(friendlyError(error), 'error');
  } finally {
    if (state.loadingUserId === userId) state.loadingUserId = null;
  }
}

async function loadCars() {
  const { data, error } = await state.db.from('cars').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  state.cars = data || [];
  if (state.activeCarId && !state.cars.some((car) => String(car.id) === String(state.activeCarId))) {
    state.activeCarId = '';
    if (state.user?.id) storageSet(`carbook-active-car:${state.user.id}`, '');
  }
  if (!state.cars.length) {
    state.cache = {};
    $('#nav-reminder-count').textContent = '0';
  }
  const select = $('#active-car');
  select.innerHTML = `<option value="">Усі автомобілі</option>${state.cars.map((car) =>
    `<option value="${escapeHtml(car.id)}">${escapeHtml(car.make)} ${escapeHtml(car.model)}</option>`
  ).join('')}`;
  select.value = state.activeCarId;
  $('#nav-car-count').textContent = String(state.cars.length);
}

async function fetchRows(key, allCars = false) {
  const config = RECORDS[key];
  if (!config) throw new Error(`Невідомий тип запису: ${key}`);
  const carIds = !allCars && state.activeCarId ? [state.activeCarId] : state.cars.map((car) => car.id);
  if (!carIds.length) return [];

  const pageSize = 500;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    let query = state.db.from(config.table).select('*')
      .order(config.sort, { ascending: key === 'reminders', nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    query = !allCars && state.activeCarId ? query.eq('car_id', state.activeCarId) : query.in('car_id', carIds);
    const { data, error } = await query;
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function loadRecordSets(keys, allCars = false) {
  const pairs = await Promise.all(keys.map(async (key) => [key, await fetchRows(key, allCars)]));
  for (const [key, rows] of pairs) state.cache[key] = rows;
  const reminderCount = (state.cache.reminders || []).filter((reminder) => !reminder.is_done).length;
  $('#nav-reminder-count').textContent = String(reminderCount);
  return state.cache;
}

function setPageChrome() {
  const title = PAGE_TITLES[state.page] || 'CarBook';
  $('#page-title').textContent = title;
  $('#breadcrumb-current').textContent = title.toLocaleUpperCase('uk-UA');
  $$('.nav-link[data-page], .mobile-bottom-nav [data-page]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.page === state.page);
  });
}

async function loadPage() {
  if (!state.user) return;
  setPageChrome();
  try {
    if (state.page === 'dashboard') await renderDashboard();
    else if (state.page === 'cars') renderCarsPage();
    else if (state.page === 'stats') await renderStatsPage();
    else if (state.page === 'profile') renderProfilePage();
    else if (RECORDS[state.page]) await renderRecordsPage(state.page);
    else {
      state.page = 'dashboard';
      setPageChrome();
      await renderDashboard();
    }
  } catch (error) {
    $('#view-content').innerHTML = `<div class="empty-state"><div class="empty-illustration">${icon('info')}</div><h3>Не вдалося завантажити розділ</h3><p>${escapeHtml(friendlyError(error))}</p><button class="btn btn-dark" data-action="reload-page">Спробувати ще раз</button></div>`;
    notify(friendlyError(error), 'error');
  }
}

function pageIntro(title, description, buttonLabel, action = 'add-record') {
  const actionIcon = action.startsWith('export-') ? 'download' : 'plus';
  return `<div class="page-intro"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><div class="page-intro-actions"><button class="btn btn-primary" data-action="${action}" ${action === 'add-record' ? `data-key="${escapeHtml(state.page)}"` : ''}>${icon(actionIcon)}${escapeHtml(buttonLabel)}</button></div></div>`;
}

function emptyState(title, description, action = 'add-car', buttonLabel = 'Додати автомобіль', iconName = 'car') {
  return `<div class="empty-state"><div class="empty-illustration">${icon(iconName)}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p><button class="btn btn-primary" data-action="${action}">${icon('plus')}${escapeHtml(buttonLabel)}</button></div>`;
}

function heroCarArt() {
  return `<div class="hero-car-art" aria-hidden="true"><svg viewBox="0 0 620 230"><path d="M92 148 118 111q12-18 40-24l74-17q23-5 48-5h94q25 0 46 15l55 41 53 12q22 5 26 26l2 18H67l5-19q4-11 20-10Z" fill="#c7d4dc" stroke="#edf4f7" stroke-width="3"/><path d="m248 78-14 57h103V69h-65q-13 0-24 9Zm101-9v66h119l-48-37q-15-12-31-21-12-7-24-8Z" fill="#263d50" stroke="#8199a9" stroke-width="2"/><path d="M74 153h468" stroke="#71899a" stroke-width="3"/><circle cx="167" cy="177" r="34" fill="#101b2a" stroke="#71899a" stroke-width="6"/><circle cx="167" cy="177" r="15" fill="#b7c5ce"/><circle cx="463" cy="177" r="34" fill="#101b2a" stroke="#71899a" stroke-width="6"/><circle cx="463" cy="177" r="15" fill="#b7c5ce"/><path d="M101 146h33M493 145h39" stroke="#d9f36b" stroke-width="5" stroke-linecap="round"/></svg></div>`;
}

async function renderDashboard() {
  const root = $('#view-content');
  if (!state.cars.length) {
    root.innerHTML = `<section class="hero-panel"><div class="hero-copy"><div class="hero-kicker"><span class="live-dot"></span> YOUR DIGITAL GARAGE</div><h2>Ваш автомобільний журнал починається тут.</h2><p>Додайте перший автомобіль — і зможете зберігати заправки, витрати, сервісну історію та нагадування в одному місці.</p><div class="hero-actions"><button class="btn btn-primary" data-action="add-car">${icon('plus')}Додати автомобіль</button></div></div>${heroCarArt()}</section><div class="section-spacer"></div>${emptyState('Гараж поки порожній','Створіть картку автомобіля, щоб почати вести його історію.','add-car','Створити автомобіль','car')}`;
    $('#nav-reminder-count').textContent = '0';
    return;
  }

  await loadRecordSets(['fuel', 'expenses', 'service', 'reminders']);
  const { fuel, expenses, service, reminders } = state.cache;
  const totals = calculateTotals({ fuel, expenses, service });
  const consumptionCar = currentCar() || (state.cars.length === 1 ? state.cars[0] : null);
  const consumption = consumptionCar
    ? calculateFuelConsumption(fuel.filter((entry) => String(entry.car_id) === String(consumptionCar.id)))
    : { average: null, intervals: [], measuredDistance: 0, measuredLiters: 0 };
  const activeReminders = reminders.filter((reminder) => !reminder.is_done);
  const car = consumptionCar;
  const greeting = car ? carName(car) : 'Ваш гараж під контролем';
  const currentMileage = car && car.current_odometer !== null ? Number(car.current_odometer) : null;
  const recent = [
    ...fuel.map((row) => ({ ...row, kind: 'Заправка', amount: row.total_cost, icon: 'fuel', tone: '' })),
    ...expenses.map((row) => ({ ...row, kind: row.category || 'Витрата', amount: row.amount, icon: 'wallet', tone: 'blue' })),
    ...service.map((row) => ({ ...row, kind: 'Обслуговування', amount: row.cost, icon: 'wrench', tone: 'orange' }))
  ].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);
  const reminderCarMap = new Map(state.cars.map((item) => [String(item.id), item]));

  root.innerHTML = `
    <section class="hero-panel">
      <div class="hero-copy">
        <div class="hero-kicker"><span class="live-dot"></span> ОСОБИСТИЙ ЦИФРОВИЙ ГАРАЖ</div>
        <h2>${escapeHtml(greeting)}</h2>
        <p>${car ? `${escapeHtml(String(car.year))} рік · ${escapeHtml(car.fuel_type || 'Тип пального не вказано')} · ${currentMileage === null ? 'Пробіг не вказано' : `${formatNumber(currentMileage)} км пробігу`}` : 'Усі автомобілі, записи та витрати — в одному огляді.'}</p>
        <div class="hero-actions"><button class="btn btn-primary" data-action="quick-add">${icon('plus')}Додати запис</button><button class="btn btn-outline" data-action="go-page" data-page="stats">Переглянути статистику ${icon('arrow')}</button></div>
      </div>${heroCarArt()}
    </section>
    <section class="metrics-grid" aria-label="Основні показники">
      <article class="metric-card"><div class="metric-head"><span>Загальні витрати</span><span class="metric-icon"><svg class="icon"><use href="#icon-wallet"></use></svg></span></div><div class="metric-value">${formatMoney(totals.total)}</div><div class="metric-foot">Заправки, сервіс та інші витрати</div></article>
      <article class="metric-card"><div class="metric-head"><span>Пальне використано</span><span class="metric-icon blue"><svg class="icon"><use href="#icon-fuel"></use></svg></span></div><div class="metric-value">${formatNumber(totals.liters, 1)} л</div><div class="metric-foot">За ${fuel.length} записами про заправки</div></article>
      <article class="metric-card"><div class="metric-head"><span>Поточний пробіг</span><span class="metric-icon orange"><svg class="icon"><use href="#icon-gauge"></use></svg></span></div><div class="metric-value">${currentMileage === null ? '—' : `${formatNumber(currentMileage)} км`}</div><div class="metric-foot">${car ? 'Обраний автомобіль' : 'Оберіть авто для перегляду пробігу'}</div></article>
      <article class="metric-card"><div class="metric-head"><span>Активні нагадування</span><span class="metric-icon green"><svg class="icon"><use href="#icon-bell"></use></svg></span></div><div class="metric-value">${activeReminders.length}</div><div class="metric-foot">Потребують вашої уваги</div></article>
    </section>
    <div class="dashboard-columns">
      <section class="panel">
        <div class="panel-header"><div><h3>Останні операції</h3><p>Найновіші записи у вашому журналі</p></div><button class="text-action" data-action="go-page" data-page="stats">Уся статистика ${icon('arrow')}</button></div>
        ${renderActivityList(recent)}
      </section>
      <div>
        <section class="panel">
          <div class="panel-header"><div><h3>Мій гараж</h3><p>${state.cars.length} автомобілі(в) у системі</p></div><button class="text-action" data-action="go-page" data-page="cars">Усі авто ${icon('arrow')}</button></div>
          <div class="garage-list">${state.cars.slice(0, 4).map((item) => `<button class="garage-mini-card" type="button" data-action="select-car" data-id="${escapeHtml(item.id)}"><span class="garage-mini-art">${icon('car')}</span><span class="garage-mini-info"><b>${escapeHtml(carName(item))}</b><small>${escapeHtml(String(item.year))} · ${item.current_odometer === null ? '—' : `${formatNumber(item.current_odometer)} км`}</small></span>${icon('chevron')}</button>`).join('')}</div>
        </section>
        <section class="panel">
          <div class="panel-header"><div><h3>Нагадування</h3><p>Заплановані роботи та події</p></div><button class="text-action" data-action="go-page" data-page="reminders">Усі ${icon('arrow')}</button></div>
          ${renderReminderPreview(activeReminders.slice(0, 4), reminderCarMap)}
        </section>
      </div>
    </div>
    <div class="section-title-row"><div><h2>Коротко про пальне</h2><p>Розрахунок за методом «повний бак — повний бак»</p></div><button class="text-action" data-action="go-page" data-page="fuel">Історія заправок ${icon('arrow')}</button></div>
    <section class="metrics-grid">
      <article class="metric-card"><div class="metric-head"><span>Середня витрата</span><span class="metric-icon"><svg class="icon"><use href="#icon-gauge"></use></svg></span></div><div class="metric-value">${consumption.average === null ? '—' : `${formatNumber(consumption.average, 2)} л`}</div><div class="metric-foot">${!consumptionCar ? 'Оберіть автомобіль для окремого розрахунку' : consumption.average === null ? 'Потрібні щонайменше дві повні заправки' : 'На 100 км за повними інтервалами'}</div></article>
      <article class="metric-card"><div class="metric-head"><span>Середня ціна літра</span><span class="metric-icon blue"><svg class="icon"><use href="#icon-fuel"></use></svg></span></div><div class="metric-value">${totals.liters > 0 ? formatMoney(totals.fuelCost / totals.liters, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : '—'}</div><div class="metric-foot">Сума заправок / кількість літрів</div></article>
      <article class="metric-card"><div class="metric-head"><span>Витрати на сервіс</span><span class="metric-icon orange"><svg class="icon"><use href="#icon-wrench"></use></svg></span></div><div class="metric-value">${formatMoney(totals.serviceCost)}</div><div class="metric-foot">${service.length} сервісних записів</div></article>
      <article class="metric-card"><div class="metric-head"><span>Інші витрати</span><span class="metric-icon green"><svg class="icon"><use href="#icon-wallet"></use></svg></span></div><div class="metric-value">${formatMoney(totals.expenseCost)}</div><div class="metric-foot">${expenses.length} записів</div></article>
    </section>`;
}

function renderActivityList(rows) {
  if (!rows.length) return `<div class="empty-state" style="min-height:170px;border:0;background:transparent"><div class="empty-illustration">${icon('clock')}</div><h3>Історія ще порожня</h3><p>Після першої заправки або витрати тут з’явиться хронологія операцій.</p></div>`;
  return `<div class="activity-list">${rows.map((row) => `<div class="activity-row"><span class="activity-icon ${row.tone}">${icon(row.icon)}</span><span class="activity-main"><b>${escapeHtml(row.kind)}</b><small>${formatDate(row.date)} · ${escapeHtml(carName(state.cars.find((car) => car.id === row.car_id)))}</small></span><span class="activity-amount">${row.amount === null || row.amount === undefined ? '—' : formatMoney(row.amount)}</span></div>`).join('')}</div>`;
}

function renderReminderPreview(rows, carMap) {
  if (!rows.length) return `<div class="empty-state" style="min-height:140px;border:0;background:transparent;padding:15px"><div class="empty-illustration">${icon('check')}</div><h3>Немає активних нагадувань</h3><p>Усе заплановане під контролем.</p></div>`;
  return `<div class="reminder-list">${rows.map((reminder) => {
    const car = carMap.get(String(reminder.car_id));
    const status = getReminderState(reminder, car);
    return `<div class="reminder-row"><span class="reminder-marker ${status === 'overdue' ? 'overdue' : ''}"></span><span class="reminder-copy"><b>${escapeHtml(reminder.title)}</b><small>${escapeHtml(carName(car))} · ${reminderDueText(reminder)}</small></span></div>`;
  }).join('')}</div>`;
}

function renderCarsPage() {
  const root = $('#view-content');
  const intro = pageIntro('Мої автомобілі', 'Керуйте картками автомобілів та переглядайте їхній поточний стан.', 'Додати авто', 'add-car');
  if (!state.cars.length) {
    root.innerHTML = intro + emptyState('Гараж поки порожній', 'Додайте автомобіль, щоб вести його витрати, заправки та сервісну історію.', 'add-car', 'Додати автомобіль', 'car');
    return;
  }
  root.innerHTML = intro + `<div class="car-grid">${state.cars.map((car) => {
    const selected = String(car.id) === String(state.activeCarId);
    return `<article class="car-card ${selected ? 'is-selected' : ''}">
      <div class="car-card-top"><span class="status-pill ${selected ? '' : 'is-pending'}">${selected ? 'Обраний автомобіль' : 'У гаражі'}</span><button class="table-icon-button" type="button" title="Редагувати" aria-label="Редагувати ${escapeHtml(carName(car))}" data-action="edit-car" data-id="${escapeHtml(car.id)}">${icon('edit')}</button></div>
      <div class="car-art">${icon('car')}</div>
      <h3>${escapeHtml(carName(car))}</h3><div class="car-card-subtitle">${escapeHtml(String(car.year))} рік випуску · ${escapeHtml(car.fuel_type || 'Пальне не вказано')}</div>
      <div class="car-card-stats"><div class="car-card-stat"><b>${car.current_odometer === null ? '—' : `${formatNumber(car.current_odometer)} км`}</b><small>ПОТОЧНИЙ ПРОБІГ</small></div><div class="car-card-stat"><b>${car.estimated_value_usd ? `$${formatNumber(car.estimated_value_usd, 0)}` : '—'}</b><small>ОРІЄНТОВНА ВАРТІСТЬ</small></div></div>
      <div class="car-card-actions"><button class="btn btn-dark" type="button" data-action="select-car" data-id="${escapeHtml(car.id)}">${icon('car')}Відкрити журнал</button><button class="btn btn-soft" type="button" data-action="delete-car" data-id="${escapeHtml(car.id)}" title="Видалити автомобіль">${icon('trash')}</button></div>
    </article>`;
  }).join('')}</div>`;
}

async function renderRecordsPage(key) {
  if (!state.cars.length) {
    $('#view-content').innerHTML = pageIntro(RECORDS[key].title, 'Спочатку створіть автомобіль, до якого будуть прив’язані записи.', 'Додати авто', 'add-car') + emptyState('Немає автомобілів', 'Записи зберігаються в картці конкретного автомобіля.', 'add-car', 'Створити автомобіль', 'car');
    return;
  }
  const rows = await fetchRows(key);
  state.cache[key] = rows;
  if (key === 'reminders') $('#nav-reminder-count').textContent = String(rows.filter((reminder) => !reminder.is_done).length);
  const carMap = new Map(state.cars.map((car) => [String(car.id), car]));
  const description = {
    fuel: 'Фіксуйте кількість пального, суму, пробіг та повні заправки для розрахунку витрати.',
    expenses: 'Обліковуйте витрати на утримання автомобіля за категоріями.',
    service: 'Зберігайте історію ремонтів, технічного обслуговування та наступні інтервали ТО.',
    reminders: 'Плануйте роботи за датою або пробігом і відмічайте виконані завдання.',
    notes: 'Зберігайте важливі деталі, домовленості та інформацію про автомобіль.'
  }[key];
  const intro = pageIntro(RECORDS[key].title, description, 'Додати запис');
  if (!rows.length) {
    $('#view-content').innerHTML = intro + emptyState('Поки немає записів', 'Додайте перший запис — він з’явиться у вашій історії.', 'add-record', 'Додати запис', RECORDS[key].icon);
    return;
  }
  if (key === 'notes') {
    $('#view-content').innerHTML = intro + `<div class="note-grid">${rows.map((row) => `<article class="note-card"><div class="panel-header"><span class="status-pill">${formatDate(row.date)}</span><div class="note-card-actions">${recordActionButtons(key, row.id)}</div></div><p>${escapeHtml(row.content)}</p><div class="note-card-foot"><span>${escapeHtml(carName(carMap.get(String(row.car_id))))}</span><span>Нотатка</span></div></article>`).join('')}</div>`;
    return;
  }
  if (key === 'reminders') {
    $('#view-content').innerHTML = intro + `<div class="panel table-panel"><div class="table-toolbar"><strong>${rows.length} нагадувань</strong><span>Активні та виконані завдання</span></div><div class="table-wrap"><table><thead><tr><th>НАЗВА</th>${state.activeCarId ? '' : '<th>АВТОМОБІЛЬ</th>'}<th>ДАТА</th><th>ПРОБІГ</th><th>СТАТУС</th><th></th></tr></thead><tbody>${rows.map((row) => {
      const car = carMap.get(String(row.car_id));
      const status = getReminderState(row, car);
      const statusText = row.is_done ? 'Виконано' : status === 'overdue' ? 'Прострочено' : 'Активне';
      return `<tr><td><strong>${escapeHtml(row.title)}</strong></td>${state.activeCarId ? '' : `<td>${escapeHtml(carName(car))}</td>`}<td>${row.due_date ? formatDate(row.due_date) : '—'}</td><td>${row.due_odometer !== null && row.due_odometer !== undefined ? `${formatNumber(row.due_odometer)} км` : '—'}</td><td><span class="status-pill ${row.is_done ? '' : status === 'overdue' ? 'is-overdue' : 'is-pending'}">${statusText}</span></td><td><div class="table-actions">${!row.is_done ? `<button class="table-icon-button" type="button" title="Позначити виконаним" data-action="toggle-reminder" data-id="${escapeHtml(row.id)}">${icon('check')}</button>` : ''}${recordActionButtons(key, row.id)}</div></td></tr>`;
    }).join('')}</tbody></table></div></div>`;
    return;
  }

  const columnMap = {
    fuel: [
      ['date', 'ДАТА', (row) => formatDate(row.date)],
      ['car', 'АВТОМОБІЛЬ', (row) => escapeHtml(carName(carMap.get(String(row.car_id))))],
      ['odometer', 'ПРОБІГ', (row) => `${formatNumber(row.odometer)} км`],
      ['liters', 'ЛІТРИ', (row) => `${formatNumber(row.liters, 2)} л`],
      ['total_cost', 'СУМА', (row) => `<strong>${formatMoney(row.total_cost)}</strong>`],
      ['station', 'АЗС', (row) => escapeHtml(row.station || '—')]
    ],
    expenses: [
      ['date', 'ДАТА', (row) => formatDate(row.date)],
      ['car', 'АВТОМОБІЛЬ', (row) => escapeHtml(carName(carMap.get(String(row.car_id))))],
      ['category', 'КАТЕГОРІЯ', (row) => escapeHtml(row.category)],
      ['description', 'ОПИС', (row) => escapeHtml(row.description || '—')],
      ['amount', 'СУМА', (row) => `<strong>${formatMoney(row.amount)}</strong>`]
    ],
    service: [
      ['date', 'ДАТА', (row) => formatDate(row.date)],
      ['car', 'АВТОМОБІЛЬ', (row) => escapeHtml(carName(carMap.get(String(row.car_id))))],
      ['odometer', 'ПРОБІГ', (row) => `${formatNumber(row.odometer)} км`],
      ['work_done', 'ВИКОНАНІ РОБОТИ', (row) => escapeHtml(row.work_done)],
      ['cost', 'ВАРТІСТЬ', (row) => `<strong>${row.cost === null ? '—' : formatMoney(row.cost)}</strong>`]
    ]
  };
  const columns = columnMap[key].filter(([field]) => !(state.activeCarId && field === 'car'));
  $('#view-content').innerHTML = intro + `<div class="panel table-panel"><div class="table-toolbar"><strong>${rows.length} записів</strong><span>Усі записи завантажено з бази даних</span></div><div class="table-wrap"><table><thead><tr>${columns.map(([, label]) => `<th>${label}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map((row) => `<tr>${columns.map(([, , render]) => `<td>${render(row)}</td>`).join('')}<td><div class="table-actions">${recordActionButtons(key, row.id)}</div></td></tr>`).join('')}</tbody></table></div></div>`;
}

function recordActionButtons(key, id) {
  return `<button class="table-icon-button" type="button" title="Редагувати" aria-label="Редагувати запис" data-action="edit-record" data-key="${escapeHtml(key)}" data-id="${escapeHtml(id)}">${icon('edit')}</button><button class="table-icon-button danger" type="button" title="Видалити" aria-label="Видалити запис" data-action="delete-record" data-key="${escapeHtml(key)}" data-id="${escapeHtml(id)}">${icon('trash')}</button>`;
}

async function renderStatsPage() {
  if (!state.cars.length) {
    $('#view-content').innerHTML = pageIntro('Статистика', 'Аналітика витрат, пального та сервісу.', 'Додати авто', 'add-car') + emptyState('Поки немає даних', 'Додайте автомобіль і перші записи, щоб побачити статистику.', 'add-car', 'Додати автомобіль', 'chart');
    return;
  }
  await loadRecordSets(['fuel', 'expenses', 'service', 'reminders']);
  const { fuel, expenses, service } = state.cache;
  const totals = calculateTotals({ fuel, expenses, service });
  const consumptionCar = currentCar() || (state.cars.length === 1 ? state.cars[0] : null);
  const consumption = consumptionCar
    ? calculateFuelConsumption(fuel.filter((entry) => String(entry.car_id) === String(consumptionCar.id)))
    : { average: null, intervals: [], measuredDistance: 0, measuredLiters: 0 };
  const monthly = buildMonthlySpend({ fuel, expenses, service }, 6);
  const maxMonth = Math.max(1, ...monthly.map((item) => item.amount));
  const categories = [
    { name: 'Пальне', amount: totals.fuelCost },
    ...Object.entries(expenses.reduce((acc, row) => {
      const key = row.category || 'Інше';
      acc[key] = (acc[key] || 0) + (Number(row.amount) || 0);
      return acc;
    }, {})).map(([name, amount]) => ({ name, amount })),
    { name: 'Обслуговування', amount: totals.serviceCost }
  ].filter((item) => item.amount > 0).sort((a, b) => b.amount - a.amount);
  const maxCategory = Math.max(1, ...categories.map((item) => item.amount));

  $('#view-content').innerHTML = `
    ${pageIntro('Статистика', 'Фінансова картина вашого автомобільного господарства на основі збережених записів.', 'Експорт CSV', 'export-csv')}
    <section class="metrics-grid">
      <article class="metric-card"><div class="metric-head"><span>Загальні витрати</span><span class="metric-icon"><svg class="icon"><use href="#icon-wallet"></use></svg></span></div><div class="metric-value">${formatMoney(totals.total)}</div><div class="metric-foot">${totals.entries} фінансових записів</div></article>
      <article class="metric-card"><div class="metric-head"><span>Витрати на пальне</span><span class="metric-icon blue"><svg class="icon"><use href="#icon-fuel"></use></svg></span></div><div class="metric-value">${formatMoney(totals.fuelCost)}</div><div class="metric-foot">${formatNumber(totals.liters, 1)} л придбано</div></article>
      <article class="metric-card"><div class="metric-head"><span>Середня витрата</span><span class="metric-icon orange"><svg class="icon"><use href="#icon-gauge"></use></svg></span></div><div class="metric-value">${consumption.average === null ? '—' : `${formatNumber(consumption.average, 2)} л`}</div><div class="metric-foot">На 100 км, за повними баками</div></article>
      <article class="metric-card"><div class="metric-head"><span>Середня ціна літра</span><span class="metric-icon green"><svg class="icon"><use href="#icon-fuel"></use></svg></span></div><div class="metric-value">${totals.liters > 0 ? formatMoney(totals.fuelCost / totals.liters, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : '—'}</div><div class="metric-foot">За всіма заправками</div></article>
    </section>
    <div class="dashboard-columns">
      <section class="panel">
        <div class="panel-header"><div><h3>Витрати за місяцями</h3><p>Сума заправок, сервісу та інших витрат · грн</p></div><span class="subtle-count">Останні 6 місяців</span></div>
        <div class="chart-bars">${monthly.map((item) => `<div class="chart-column"><strong>${item.amount ? formatNumber(item.amount, 0) : '—'}</strong><div class="chart-bar-track"><i class="chart-bar" style="height:${item.amount ? Math.max(4, item.amount / maxMonth * 100) : 0}%"></i></div><small>${escapeHtml(item.label)}</small></div>`).join('')}</div>
      </section>
      <section class="panel">
        <div class="panel-header"><div><h3>Структура витрат</h3><p>Розподіл за категоріями</p></div></div>
        ${categories.length ? `<div class="category-list">${categories.map((item) => `<div class="category-row"><span>${escapeHtml(item.name)}</span><div class="category-track"><i style="width:${Math.max(2, item.amount / maxCategory * 100)}%"></i></div><b>${formatMoney(item.amount)}</b></div>`).join('')}</div>` : '<div class="empty-state" style="min-height:145px;border:0;background:transparent"><h3>Ще немає фінансових даних</h3><p>Додайте заправки, витрати або сервісні роботи.</p></div>'}
      </section>
    </div>
    <section class="panel"><div class="panel-header"><div><h3>Дані для розрахунку витрати пального</h3><p>Метод «повний бак — повний бак»</p></div><span class="status-pill">${consumption.intervals.length} інтервалів</span></div><div class="profile-grid"><div class="profile-summary"><span class="metric-icon"><svg class="icon"><use href="#icon-gauge"></use></svg></span><div><h3>${!consumptionCar ? 'Оберіть автомобіль' : consumption.average === null ? 'Недостатньо даних' : `${formatNumber(consumption.average, 2)} л / 100 км`}</h3><p>${!consumptionCar ? 'Оберіть автомобіль у верхньому фільтрі, щоб не змішувати пробіг різних авто.' : consumption.average === null ? 'Позначте щонайменше дві заправки цього авто як «повний бак».' : `${formatNumber(consumption.measuredDistance)} км виміряної дистанції · ${formatNumber(consumption.measuredLiters, 2)} л`}</p></div></div><div class="security-callout">${icon('info')}<p>Розрахунок враховує лише відрізки між двома записами з позначкою «повний бак». Якщо пробіг або заправки внесені непослідовно, показник може бути неточним.</p></div></div></section>
    <section class="panel"><div class="panel-header"><div><h3>Експорт даних</h3><p>Завантажте копію записів для власного архіву.</p></div></div><div class="page-intro-actions"><button class="btn btn-dark" data-action="export-csv">${icon('download')}Експорт CSV</button><button class="btn btn-soft" data-action="export-json">${icon('download')}Повна копія JSON</button></div></section>`;
}

function renderProfilePage() {
  $('#view-content').innerHTML = `
    ${pageIntro('Профіль та дані', 'Налаштування доступу до акаунта та керування копіями ваших записів.', 'Експорт JSON', 'export-json')}
    <div class="profile-grid">
      <section class="panel">
        <div class="panel-header"><div><h3>Обліковий запис</h3><p>Дані авторизації Supabase</p></div></div>
        <div class="profile-summary"><div class="user-avatar">${escapeHtml((state.user?.email || 'U').slice(0, 1).toUpperCase())}</div><div><h3>${escapeHtml(state.user?.email || 'Користувач')}</h3><p>Особистий CarBook · ${state.cars.length} автомобілі(в)</p></div></div>
        <div style="height:14px"></div>
        <div class="setting-row"><div class="setting-copy"><b>Змінити пароль</b><small>Встановіть новий пароль для входу в CarBook.</small></div><button class="btn btn-soft" data-action="change-password">Змінити</button></div>
        <div class="setting-row"><div class="setting-copy"><b>Завершити сеанс</b><small>Вийти з акаунта на цьому пристрої.</small></div><button class="btn btn-danger" data-action="sign-out">Вийти</button></div>
      </section>
      <section class="panel">
        <div class="panel-header"><div><h3>Резервна копія</h3><p>Завантажте свої дані на пристрій.</p></div></div>
        <div class="setting-row"><div class="setting-copy"><b>Таблиця CSV</b><small>Зручна для перегляду в Excel або Google Sheets.</small></div><button class="btn btn-soft" data-action="export-csv">${icon('download')}CSV</button></div>
        <div class="setting-row"><div class="setting-copy"><b>Повний архів JSON</b><small>Автомобілі, заправки, витрати, ТО, нагадування та нотатки.</small></div><button class="btn btn-dark" data-action="export-json">${icon('download')}JSON</button></div>
        <div class="security-callout">${icon('shield')}<p>Усі записи прив’язані до вашого акаунта. Доступ до рядків у базі контролюється політиками Row Level Security у Supabase.</p></div>
      </section>
    </div>
    <section class="panel"><div class="panel-header"><div><h3>Про зберігання даних</h3><p>Важливо знати перед використанням</p></div></div><div class="setting-row"><div class="setting-copy"><b>Де зберігаються записи?</b><small>У PostgreSQL-базі вашого Supabase Project, а не в браузері чи GitHub Pages.</small></div></div><div class="setting-row"><div class="setting-copy"><b>Чи зберігаються записи без інтернету?</b><small>Для перегляду й редагування потрібне підключення до інтернету. Офлайн-синхронізація не реалізована.</small></div></div><div class="setting-row"><div class="setting-copy"><b>Чи надсилаються автоматичні сповіщення?</b><small>Наразі нагадування відображаються в застосунку. Автоматичні push, email або Telegram-сповіщення потребують окремого серверного процесу.</small></div></div></section>`;
}

function showFormModal({ title, subtitle, fields, values = {}, onSubmit, submitLabel = 'Зберегти' }) {
  const html = fields.map((field) => renderField(field, values[field.name])).join('');
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><h2 id="modal-title">${escapeHtml(title)}</h2><p>${escapeHtml(subtitle || '')}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="Закрити">${icon('close')}</button></header><form id="modal-form"><div class="modal-body"><div class="form-grid">${html}</div></div><footer class="modal-footer"><button class="btn btn-soft" type="button" data-action="close-modal">Скасувати</button><button class="btn btn-primary" type="submit">${escapeHtml(submitLabel)}</button></footer></form></section></div>`;
  state.modalSubmit = onSubmit;
  $('#modal-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (typeof state.modalSubmit === 'function') await state.modalSubmit(event.currentTarget);
  });
  const first = $('input, select, textarea', $('#modal-form'));
  first?.focus({ preventScroll: true });
}

function openCarModal(car = null) {
  const fields = [
    { name: 'make', label: 'Марка', type: 'text', required: true, maxLength: 60 },
    { name: 'model', label: 'Модель', type: 'text', required: true, maxLength: 60 },
    { name: 'year', label: 'Рік випуску', type: 'number', required: true, integer: true, min: 1886, max: 2100 },
    { name: 'fuel_type', label: 'Тип пального', type: 'select', required: true, options: ['Бензин', 'Дизель', 'Газ', 'Гібрид', 'Електро', 'Інше'] },
    { name: 'current_odometer', label: 'Поточний пробіг, км', type: 'number', integer: true, min: 0 },
    { name: 'purchase_date', label: 'Дата придбання', type: 'date' },
    { name: 'purchase_odometer', label: 'Пробіг при придбанні, км', type: 'number', integer: true, min: 0 },
    { name: 'estimated_value_usd', label: 'Орієнтовна вартість, USD', type: 'number', min: 0, step: '0.01' }
  ];
  showFormModal({
    title: car ? 'Редагувати автомобіль' : 'Додати автомобіль',
    subtitle: 'Основна інформація для вашої цифрової сервісної книжки.',
    fields,
    values: car || {},
    submitLabel: car ? 'Зберегти зміни' : 'Створити автомобіль',
    onSubmit: async (form) => {
      const button = $('button[type="submit"]', form);
      setBusy(button, true, 'Зберігаємо…');
      try {
        const payload = readForm(form, fields);
        const query = car
          ? state.db.from('cars').update(payload).eq('id', car.id)
          : state.db.from('cars').insert(payload);
        const { error } = await query;
        if (error) throw error;
        closeModal();
        await loadCars();
        await loadPage();
        notify(car ? 'Дані автомобіля оновлено.' : 'Автомобіль додано до гаража.');
      } catch (error) {
        notify(friendlyError(error), 'error');
      } finally {
        if (button.isConnected) setBusy(button, false);
      }
    }
  });
}

function openRecordModal(key, record = null) {
  const config = RECORDS[key];
  if (!config) return;
  if (!state.cars.length) {
    notify('Спочатку додайте автомобіль.', 'error');
    return;
  }
  const selectedCarId = record?.car_id || state.activeCarId || state.cars[0].id;
  const carField = {
    name: 'car_id', label: 'Автомобіль', type: 'select', required: true,
    options: state.cars.map((car) => car.id),
    optionLabels: state.cars.map((car) => `${car.make} ${car.model} · ${car.year}`)
  };
  const fields = [carField, ...config.fields];
  const values = { ...(record || {}), car_id: selectedCarId };
  showFormModal({
    title: record ? `Редагувати: ${config.title.toLocaleLowerCase('uk-UA')}` : `Новий запис: ${config.title.toLocaleLowerCase('uk-UA')}`,
    subtitle: 'Запис буде збережено в історії обраного автомобіля.',
    fields,
    values,
    submitLabel: record ? 'Зберегти зміни' : 'Зберегти запис',
    onSubmit: async (form) => {
      const button = $('button[type="submit"]', form);
      setBusy(button, true, 'Зберігаємо…');
      try {
        const payload = readForm(form, fields);
        const query = record
          ? state.db.from(config.table).update(payload).eq('id', record.id)
          : state.db.from(config.table).insert(payload);
        const { error } = await query;
        if (error) throw error;
        let mileageWarning = false;
        const odometer = Number(payload.odometer);
        if (Number.isFinite(odometer) && odometer >= 0) {
          try { await updateCarOdometer(payload.car_id, odometer); }
          catch { mileageWarning = true; }
        }
        closeModal();
        await loadCars();
        await loadPage();
        notify(mileageWarning
          ? 'Запис збережено, але не вдалося оновити поточний пробіг у картці авто.'
          : (record ? 'Запис оновлено.' : 'Запис додано.'), mileageWarning ? 'error' : 'success');
      } catch (error) {
        notify(friendlyError(error), 'error');
      } finally {
        if (button.isConnected) setBusy(button, false);
      }
    }
  });
}

function renderField(field, value) {
  const required = field.required ? 'required' : '';
  const full = field.full ? ' is-full' : '';
  const label = escapeHtml(field.label);
  const name = escapeHtml(field.name);
  if (field.type === 'checkbox') {
    return `<label class="form-field checkbox-field${full}"><input type="checkbox" name="${name}" ${value ? 'checked' : ''}><span>${label}</span></label>`;
  }
  if (field.type === 'textarea') {
    return `<label class="form-field${full}">${label}<textarea name="${name}" ${required} placeholder="Введіть інформацію…">${escapeHtml(value ?? '')}</textarea></label>`;
  }
  if (field.type === 'select') {
    const options = field.options.map((option, index) => {
      const optionLabel = field.optionLabels?.[index] ?? (option || 'Не вказано');
      return `<option value="${escapeHtml(option)}" ${String(option) === String(value ?? '') ? 'selected' : ''}>${escapeHtml(optionLabel)}</option>`;
    }).join('');
    return `<label class="form-field${full}">${label}<select name="${name}" ${required}>${options}</select></label>`;
  }
  const type = field.type || 'text';
  const step = field.step || (field.integer ? '1' : type === 'number' ? '0.01' : undefined);
  const min = field.min !== undefined ? `min="${field.min}"` : '';
  const max = field.max !== undefined ? `max="${field.max}"` : '';
  const maxLength = field.maxLength ? `maxlength="${field.maxLength}"` : '';
  const minLength = field.minLength ? `minlength="${field.minLength}"` : '';
  const stepAttr = step ? `step="${step}"` : '';
  const defaultValue = value ?? (type === 'date' && field.required ? localISODate() : '');
  return `<label class="form-field${full}">${label}<input type="${type}" name="${name}" value="${escapeHtml(defaultValue)}" ${required} ${min} ${max} ${stepAttr} ${maxLength} ${minLength}></label>`;
}

function readForm(form, fields) {
  const payload = {};
  for (const field of fields) {
    const input = form.elements.namedItem(field.name);
    if (!input) continue;
    if (field.type === 'checkbox') {
      payload[field.name] = input.checked;
      continue;
    }
    const raw = String(input.value ?? '').trim();
    if (field.type === 'number') {
      if (!raw) payload[field.name] = null;
      else {
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new Error(`Поле «${field.label}» має містити число.`);
        if (field.integer && !Number.isInteger(value)) throw new Error(`Поле «${field.label}» має містити ціле число.`);
        if (field.min !== undefined && value < field.min) throw new Error(`Поле «${field.label}» не може бути меншим за ${field.min}.`);
        if (field.max !== undefined && value > field.max) throw new Error(`Поле «${field.label}» не може бути більшим за ${field.max}.`);
        payload[field.name] = value;
      }
    } else {
      payload[field.name] = raw || null;
    }
  }
  if (!payload.car_id && fields.some((field) => field.name === 'car_id')) throw new Error('Оберіть автомобіль для цього запису.');
  return payload;
}

async function updateCarOdometer(carId, odometer) {
  const car = state.cars.find((item) => String(item.id) === String(carId));
  if (!car) return;
  if (car.current_odometer !== null && odometer <= Number(car.current_odometer)) return;
  const { error } = await state.db.from('cars').update({ current_odometer: odometer }).eq('id', carId);
  if (error) throw error;
}

function openQuickAdd() {
  if (!state.cars.length) {
    openCarModal();
    return;
  }
  const choices = Object.entries(RECORDS).map(([key, config]) => `<button class="quick-choice" type="button" data-action="quick-choice" data-key="${escapeHtml(key)}"><span class="metric-icon">${icon(config.icon)}</span><span>${escapeHtml(config.title)}</span></button>`).join('');
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true"><header class="modal-header"><div><h2>Додати новий запис</h2><p>Оберіть, що потрібно зафіксувати.</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="Закрити">${icon('close')}</button></header><div class="modal-quick-grid">${choices}</div></section></div>`;
}

function closeModal() {
  $('#modal-root').innerHTML = '';
  state.modalSubmit = null;
}

function openPasswordUpdateModal() {
  showFormModal({
    title: 'Новий пароль',
    subtitle: 'Вкажіть пароль, який використовуватимете для входу в CarBook.',
    fields: [
      { name: 'password', label: 'Новий пароль', type: 'password', required: true, minLength: 8 },
      { name: 'password_repeat', label: 'Повторіть пароль', type: 'password', required: true, minLength: 8 }
    ],
    submitLabel: 'Оновити пароль',
    onSubmit: async (form) => {
      const button = $('button[type="submit"]', form);
      const password = form.elements.password.value;
      const repeat = form.elements.password_repeat.value;
      if (password.length < 8) {
        notify('Пароль має містити щонайменше 8 символів.', 'error');
        return;
      }
      if (password !== repeat) {
        notify('Паролі не збігаються.', 'error');
        return;
      }
      setBusy(button, true, 'Оновлюємо…');
      try {
        const { error } = await state.db.auth.updateUser({ password });
        if (error) throw error;
        closeModal();
        notify('Пароль успішно змінено.');
      } catch (error) {
        notify(friendlyError(error), 'error');
      } finally {
        if (button.isConnected) setBusy(button, false);
      }
    }
  });
}

function handleModalClick(event) {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'close-modal') {
    if (event.target.classList.contains('modal-backdrop') || event.target.closest('.icon-button, .modal-footer button')) closeModal();
  } else if (action === 'quick-choice') {
    const key = event.target.closest('[data-key]')?.dataset.key;
    closeModal();
    if (key) openRecordModal(key);
  }
}

function handleNavigationClick(event) {
  const button = event.target.closest('[data-page]');
  if (!button) return;
  event.preventDefault();
  void navigate(button.dataset.page);
}

function handleViewClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, key, id, page } = button.dataset;
  switch (action) {
    case 'add-car': openCarModal(); break;
    case 'add-record': openRecordModal(key || state.page); break;
    case 'edit-car': openCarModal(state.cars.find((car) => String(car.id) === String(id))); break;
    case 'delete-car': void deleteCar(id); break;
    case 'select-car': void selectCar(id); break;
    case 'edit-record': void editRecord(key, id); break;
    case 'delete-record': void deleteRecord(key, id); break;
    case 'toggle-reminder': void toggleReminder(id); break;
    case 'quick-add': openQuickAdd(); break;
    case 'go-page': void navigate(page); break;
    case 'export-csv': void exportAll('csv'); break;
    case 'export-json': void exportAll('json'); break;
    case 'change-password': openPasswordUpdateModal(); break;
    case 'sign-out': void signOut(); break;
    case 'reload-page': void loadPage(); break;
  }
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    closeModal();
    closeMobileMenu();
  }
}

async function navigate(page) {
  if (!PAGE_TITLES[page]) return;
  state.page = page;
  closeMobileMenu();
  await loadPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleMobileMenu() {
  $('#sidebar').classList.toggle('is-open');
  $('#sidebar-backdrop').classList.toggle('is-visible');
}

function closeMobileMenu() {
  $('#sidebar').classList.remove('is-open');
  $('#sidebar-backdrop').classList.remove('is-visible');
}

async function handleCarFilter(event) {
  state.activeCarId = event.target.value;
  if (state.user?.id) storageSet(`carbook-active-car:${state.user.id}`, state.activeCarId);
  await loadPage();
}

async function selectCar(id) {
  state.activeCarId = String(id);
  if (state.user?.id) storageSet(`carbook-active-car:${state.user.id}`, state.activeCarId);
  $('#active-car').value = state.activeCarId;
  await navigate('dashboard');
}

async function editRecord(key, id) {
  const config = RECORDS[key];
  if (!config) return;
  const rows = await fetchRows(key);
  const record = rows.find((row) => String(row.id) === String(id));
  if (!record) {
    notify('Запис не знайдено. Оновіть сторінку.', 'error');
    return;
  }
  openRecordModal(key, record);
}

async function deleteCar(id) {
  const car = state.cars.find((item) => String(item.id) === String(id));
  if (!car) return;
  const accepted = window.confirm(`Видалити автомобіль «${carName(car)}» разом з усіма його заправками, витратами, сервісними записами, нагадуваннями та нотатками? Цю дію неможливо скасувати.`);
  if (!accepted) return;
  try {
    const { error } = await state.db.from('cars').delete().eq('id', id);
    if (error) throw error;
    if (String(state.activeCarId) === String(id)) state.activeCarId = '';
    if (state.user?.id) storageSet(`carbook-active-car:${state.user.id}`, state.activeCarId);
    await loadCars();
    await loadPage();
    notify('Автомобіль та пов’язані з ним записи видалено.');
  } catch (error) {
    notify(friendlyError(error), 'error');
  }
}

async function deleteRecord(key, id) {
  const config = RECORDS[key];
  if (!config) return;
  if (!window.confirm('Видалити цей запис? Цю дію неможливо скасувати.')) return;
  try {
    const { error } = await state.db.from(config.table).delete().eq('id', id);
    if (error) throw error;
    await loadPage();
    notify('Запис видалено.');
  } catch (error) {
    notify(friendlyError(error), 'error');
  }
}

async function toggleReminder(id) {
  try {
    const { data, error: readError } = await state.db.from('reminders').select('is_done').eq('id', id).single();
    if (readError) throw readError;
    const { error } = await state.db.from('reminders').update({ is_done: !data.is_done }).eq('id', id);
    if (error) throw error;
    await loadPage();
    notify(data.is_done ? 'Нагадування знову активне.' : 'Нагадування позначено виконаним.');
  } catch (error) {
    notify(friendlyError(error), 'error');
  }
}

async function exportAll(format) {
  try {
    await loadRecordSets(Object.keys(RECORDS), true);
    const carMap = new Map(state.cars.map((car) => [String(car.id), carName(car)]));
    const datasets = Object.fromEntries(Object.keys(RECORDS).map((key) => [key, state.cache[key] || []]));
    const baseName = safeFilename(`carbook-${state.user?.email?.split('@')[0] || 'backup'}-${localISODate()}`);
    if (format === 'json') {
      const payload = {
        app: 'CarBook Web',
        export_version: 2,
        exported_at: new Date().toISOString(),
        account: state.user?.email || null,
        cars: state.cars,
        records: datasets
      };
      downloadFile(`${baseName}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
      notify('Повну копію даних сформовано.');
      return;
    }

    const rows = [];
    for (const [key, entries] of Object.entries(datasets)) {
      for (const entry of entries) {
        rows.push({
          type: RECORDS[key].title,
          car: carMap.get(String(entry.car_id)) || '',
          date: entry.date || entry.due_date || '',
          ...entry
        });
      }
    }
    const columns = [
      { key: 'type', label: 'Тип запису' }, { key: 'car', label: 'Автомобіль' },
      ...[...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) => !['type', 'car'].includes(key)).map((key) => ({ key, label: key }))
    ];
    downloadFile(`${baseName}.csv`, buildCsv(rows, columns), 'text/csv;charset=utf-8');
    notify('CSV-файл сформовано.');
  } catch (error) {
    notify(friendlyError(error), 'error');
  }
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}


window.addEventListener('online', () => notify('З’єднання з інтернетом відновлено.'));
window.addEventListener('offline', () => notify('Немає інтернет-з’єднання. Збереження записів тимчасово недоступне.', 'error'));

if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

document.addEventListener('DOMContentLoaded', boot);
