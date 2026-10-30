import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCsv,
  buildMonthlySpend,
  calculateFuelConsumption,
  calculateTotals,
  escapeHtml,
  formatDate,
  getReminderState,
  localISODate,
  parseISODate,
  safeFilename
} from '../core.mjs';

test('escapeHtml escapes all HTML-sensitive characters', () => {
  assert.equal(escapeHtml(`<img src="x" onerror='x'>`), '&lt;img src=&quot;x&quot; onerror=&#39;x&#39;&gt;');
});

test('parseISODate rejects invalid calendar dates', () => {
  assert.equal(parseISODate('2024-02-29') instanceof Date, true);
  assert.equal(parseISODate('2025-02-29'), null);
  assert.equal(parseISODate('not-a-date'), null);
  assert.equal(formatDate('not-a-date'), '—');
});

test('localISODate uses the local calendar date without UTC conversion', () => {
  const date = new Date(2026, 9, 30, 23, 55, 0);
  assert.equal(localISODate(date), '2026-10-30');
});

test('calculateTotals sums fuel, expense and service values safely', () => {
  const totals = calculateTotals({
    fuel: [{ total_cost: '1200.50', liters: '30' }, { total_cost: 800, liters: 20 }],
    expenses: [{ amount: 500 }, { amount: null }],
    service: [{ cost: 2500 }, { cost: null }]
  });
  assert.deepEqual(totals, {
    fuelCost: 2000.5,
    expenseCost: 500,
    serviceCost: 2500,
    total: 5000.5,
    liters: 50,
    entries: 6
  });
});

test('fuel consumption uses weighted full-tank intervals only', () => {
  const result = calculateFuelConsumption([
    { date: '2026-01-01', odometer: 10000, liters: 50, full_tank: true },
    { date: '2026-01-10', odometer: 10500, liters: 30, full_tank: false },
    { date: '2026-01-20', odometer: 11000, liters: 20, full_tank: true },
    { date: '2026-01-30', odometer: 11500, liters: 40, full_tank: true }
  ]);
  assert.equal(result.intervals.length, 2);
  assert.equal(result.measuredDistance, 1500);
  assert.equal(result.measuredLiters, 90);
  assert.equal(result.average, 6);
});

test('fuel consumption is null until there are two full-tank readings', () => {
  const result = calculateFuelConsumption([
    { odometer: 12000, liters: 40, full_tank: true },
    { odometer: 12400, liters: 20, full_tank: false }
  ]);
  assert.equal(result.average, null);
  assert.equal(result.intervals.length, 0);
});

test('monthly spend includes empty months and sums all expense classes', () => {
  const result = buildMonthlySpend({
    fuel: [{ date: '2026-10-02', total_cost: 1000 }],
    expenses: [{ date: '2026-09-12', amount: 300 }],
    service: [{ date: '2026-10-20', cost: 700 }]
  }, 3, new Date(2026, 9, 30));
  assert.deepEqual(result.map((item) => item.key), ['2026-08', '2026-09', '2026-10']);
  assert.deepEqual(result.map((item) => item.amount), [0, 300, 1700]);
});

test('reminder status handles completed, overdue date and odometer', () => {
  assert.equal(getReminderState({ is_done: true, due_date: '2020-01-01' }, { current_odometer: 999999 }, '2026-10-30'), 'done');
  assert.equal(getReminderState({ due_date: '2026-10-29' }, null, '2026-10-30'), 'overdue');
  assert.equal(getReminderState({ due_odometer: 50000 }, { current_odometer: 51000 }, '2026-10-30'), 'overdue');
  assert.equal(getReminderState({ due_date: '2026-11-01' }, null, '2026-10-30'), 'pending');
  assert.equal(getReminderState({ due_odometer: 0 }, { current_odometer: 0 }, '2026-10-30'), 'overdue');
  assert.equal(getReminderState({ due_odometer: null }, { current_odometer: 0 }, '2026-10-30'), 'pending');
});

test('CSV output quotes values and escapes embedded quotes', () => {
  const csv = buildCsv([{ name: 'BMW "X5"', note: 'рядок; з комою' }], [
    { key: 'name', label: 'Назва' }, { key: 'note', label: 'Примітка' }
  ]);
  assert.match(csv, /^\uFEFF/);
  assert.match(csv, /"BMW ""X5"""/);
  assert.match(csv, /"рядок; з комою"/);
  assert.match(buildCsv([{ note: '=HYPERLINK(\"https://bad.example\")' }], [{ key: 'note', label: 'Note' }]), /"'=HYPERLINK/);
});

test('safeFilename removes path and punctuation characters', () => {
  assert.equal(safeFilename('../../My Car / backup'), 'My-Car-backup');
});
