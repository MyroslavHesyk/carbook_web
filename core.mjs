export function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

export function localISODate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseISODate(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

export function formatDate(value, options = {}) {
  const parsed = parseISODate(value);
  if (!parsed) return '—';
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit', month: 'short', year: 'numeric', ...options
  }).format(parsed);
}

export function formatMoney(value, options = {}) {
  const number = Number(value);
  return new Intl.NumberFormat('uk-UA', {
    style: 'currency', currency: 'UAH', minimumFractionDigits: 0,
    maximumFractionDigits: 0, ...options
  }).format(Number.isFinite(number) ? number : 0);
}

export function formatNumber(value, maximumFractionDigits = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return new Intl.NumberFormat('uk-UA', { maximumFractionDigits }).format(number);
}

export function sumBy(rows = [], field) {
  return rows.reduce((sum, row) => {
    const value = Number(row?.[field]);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

export function calculateFuelConsumption(entries = []) {
  const sorted = [...entries]
    .filter((entry) => Number.isFinite(Number(entry.odometer)) && Number(entry.odometer) >= 0)
    .sort((a, b) => Number(a.odometer) - Number(b.odometer) || String(a.date).localeCompare(String(b.date)));

  let previousFullOdometer = null;
  let litersSinceFull = 0;
  let totalLiters = 0;
  let totalDistance = 0;
  const intervals = [];

  for (const entry of sorted) {
    const liters = Number(entry.liters);
    if (Number.isFinite(liters) && liters > 0) litersSinceFull += liters;

    if (!entry.full_tank) continue;

    const currentOdometer = Number(entry.odometer);
    if (previousFullOdometer !== null) {
      const distance = currentOdometer - previousFullOdometer;
      if (distance > 0 && litersSinceFull > 0) {
        const intervalLiters = litersSinceFull;
        const consumption = intervalLiters / distance * 100;
        intervals.push({ distance, liters: intervalLiters, consumption });
        totalDistance += distance;
        totalLiters += intervalLiters;
      }
    }

    previousFullOdometer = currentOdometer;
    litersSinceFull = 0;
  }

  return {
    average: totalDistance > 0 ? totalLiters / totalDistance * 100 : null,
    intervals,
    measuredDistance: totalDistance,
    measuredLiters: totalLiters
  };
}

export function getReminderState(reminder, car, today = localISODate()) {
  if (reminder?.is_done) return 'done';
  const dateOverdue = Boolean(reminder?.due_date && reminder.due_date < today);
  const hasDueOdometer = reminder?.due_odometer !== null && reminder?.due_odometer !== undefined && reminder?.due_odometer !== '';
  const hasCurrentOdometer = car?.current_odometer !== null && car?.current_odometer !== undefined && car?.current_odometer !== '';
  const dueOdometer = Number(reminder?.due_odometer);
  const currentOdometer = Number(car?.current_odometer);
  const odometerReached = hasDueOdometer && hasCurrentOdometer
    && Number.isFinite(dueOdometer) && dueOdometer >= 0
    && Number.isFinite(currentOdometer) && currentOdometer >= dueOdometer;
  if (dateOverdue || odometerReached) return 'overdue';
  if (reminder?.due_date || (Number.isFinite(dueOdometer) && dueOdometer > 0)) return 'pending';
  return 'pending';
}

export function buildMonthlySpend({ fuel = [], expenses = [], service = [] } = {}, monthCount = 6, now = new Date()) {
  const totals = new Map();
  const start = new Date(now.getFullYear(), now.getMonth() - monthCount + 1, 1);
  for (let offset = 0; offset < monthCount; offset += 1) {
    const date = new Date(start.getFullYear(), start.getMonth() + offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    totals.set(key, 0);
  }

  const all = [
    ...fuel.map((row) => [row.date, row.total_cost]),
    ...expenses.map((row) => [row.date, row.amount]),
    ...service.map((row) => [row.date, row.cost])
  ];

  for (const [date, amount] of all) {
    const key = String(date ?? '').slice(0, 7);
    if (!totals.has(key)) continue;
    const number = Number(amount);
    if (Number.isFinite(number)) totals.set(key, totals.get(key) + number);
  }

  return [...totals.entries()].map(([key, amount]) => ({
    key,
    amount,
    label: new Intl.DateTimeFormat('uk-UA', { month: 'short' }).format(
      new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1)
    ).replace('.', '')
  }));
}

export function calculateTotals({ fuel = [], expenses = [], service = [] } = {}) {
  const fuelCost = sumBy(fuel, 'total_cost');
  const expenseCost = sumBy(expenses, 'amount');
  const serviceCost = sumBy(service, 'cost');
  return {
    fuelCost,
    expenseCost,
    serviceCost,
    total: fuelCost + expenseCost + serviceCost,
    liters: sumBy(fuel, 'liters'),
    entries: fuel.length + expenses.length + service.length
  };
}

export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  // Prevent spreadsheet formula injection from user-controlled text fields.
  if (typeof value === 'string' && /^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv(rows, columns) {
  const header = columns.map((column) => csvCell(column.label)).join(';');
  const body = rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(';'));
  return `\ufeff${[header, ...body].join('\r\n')}`;
}

export function safeFilename(value) {
  return String(value || 'carbook')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'carbook';
}
