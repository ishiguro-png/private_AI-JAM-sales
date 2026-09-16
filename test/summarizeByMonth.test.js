'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadGasModule } = require('./helpers/loadGas');

const ctx = loadGasModule(['Utils.gs', 'SheetReader.gs']);
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sheet-rows-202608.json'), 'utf8'));

test('summarizeByMonth は対象月かつステータス=決済完了の行のみ集計する', () => {
  const result = ctx.summarizeByMonth(rows, '2026年08月', '決済完了');

  // 8月の行は4件あるが、うち1件は「解約」ステータスなので集計対象は3件
  assert.equal(result.count, 3);
  assert.equal(result.totalAmount, 7678 * 3);
  assert.equal(result.rows.length, 3);
});

test('summarizeByMonth は対象月が異なる行を除外する', () => {
  const result = ctx.summarizeByMonth(rows, '2026年09月', '決済完了');
  assert.equal(result.count, 1);
  assert.equal(result.totalAmount, 7678);
});

test('summarizeByMonth は該当行がない場合0件0円を返す', () => {
  const result = ctx.summarizeByMonth(rows, '2099年01月', '決済完了');
  assert.equal(result.count, 0);
  assert.equal(result.totalAmount, 0);
});
