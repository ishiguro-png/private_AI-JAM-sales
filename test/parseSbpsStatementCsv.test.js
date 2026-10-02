'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadGasModule } = require('./helpers/loadGas');

const ctx = loadGasModule(['Utils.gs', 'CsvParser.gs']);
const csvText = fs.readFileSync(path.join(__dirname, 'fixtures', 'sbps-statement-202608.csv'), 'utf8');

test('parseCsvText はダブルクォート・カンマを含むRFC4180形式を正しく分解する', () => {
  const rows = ctx.parseCsvText('"1","20261002"\r\n"2","a,b","say ""hi"""\n');
  assert.deepEqual(rows, [
    ['1', '20261002'],
    ['2', 'a,b', 'say "hi"'],
  ]);
});

test('parseSbpsStatementCsv が実際の収納明細CSVからサマリーを抽出する', () => {
  const { summary } = ctx.parseSbpsStatementCsv(csvText);

  assert.equal(summary.companyName, '株式会社ＣＲＡＦＴＲＡＮＳ');
  assert.equal(summary.serviceName, 'AI JAM');
  assert.equal(summary.grossAmount, 69102);
  assert.equal(summary.feeAmount, 34657);
  assert.equal(summary.taxAmount, 1208);
  assert.equal(summary.transferAmount, 33237);
  assert.equal(summary.periodFrom, '2026/08/01');
  assert.equal(summary.periodTo, '2026/08/31');
});

test('parseSbpsStatementCsv が取引明細(type5)を売上/返金/与信に分類して抽出する', () => {
  const { transactions } = ctx.parseSbpsStatementCsv(csvText);

  const sales = transactions.filter((t) => t.kind === 'sale');
  const refunds = transactions.filter((t) => t.kind === 'refund');
  const authorizations = transactions.filter((t) => t.kind === 'authorization');

  // 与信(オーソリ)・与信取消は実際の入金を伴わないカードの一時保留なので、
  // 売上/返金とは別種別として分類され、突合処理からは自然に除外される
  assert.equal(sales.length + refunds.length + authorizations.length, transactions.length);
  assert.equal(refunds.length, 19);
  assert.ok(authorizations.length > 0, '与信レコードが分類されていること');
  authorizations.forEach((t) => assert.equal(t.amount, 0, '与信レコードの決済金額は常に0円'));

  const firstSale = sales.find((t) => t.customerId === 'C6A50A28C2A633');
  assert.ok(firstSale, '顧客ID C6A50A28C2A633 の売上取引が見つかること');
  assert.equal(firstSale.amount, 7678);
  assert.equal(firstSale.saleDate, '2026/08/01');
});
