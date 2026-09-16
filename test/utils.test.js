'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGasModule } = require('./helpers/loadGas');

const ctx = loadGasModule(['Utils.gs']);

test('parseCurrencyToNumber は円表記の文字列を数値に変換する', () => {
  assert.equal(ctx.parseCurrencyToNumber('¥1,234'), 1234);
  assert.equal(ctx.parseCurrencyToNumber('-¥1,688'), -1688);
  assert.equal(ctx.parseCurrencyToNumber(1234), 1234);
});

test('parseCurrencyToNumber は空文字や非数値記号に対して0を返す', () => {
  assert.equal(ctx.parseCurrencyToNumber(''), 0);
  assert.equal(ctx.parseCurrencyToNumber('－'), 0);
  assert.equal(ctx.parseCurrencyToNumber(null), 0);
  assert.equal(ctx.parseCurrencyToNumber(undefined), 0);
});

test('formatYen は3桁区切りの円表記を返す', () => {
  assert.equal(ctx.formatYen(1234567), '¥1,234,567');
  assert.equal(ctx.formatYen(-1688), '-¥1,688');
  assert.equal(ctx.formatYen(0), '¥0');
});

test('monthLabelFromDate は "YYYY年MM月" 形式を返す', () => {
  assert.equal(ctx.monthLabelFromDate(new Date(2026, 7, 1)), '2026年08月');
});
