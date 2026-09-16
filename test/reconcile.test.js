'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadGasModule } = require('./helpers/loadGas');

const ctx = loadGasModule(['Utils.gs', 'PdfParser.gs', 'SheetReader.gs', 'Reconcile.gs']);

test('reconcile は件数・金額が完全一致する場合 isMatch=true を返す', () => {
  const pdfSummary = { settledCount: 3, settledAmount: 23034 };
  const sheetSummary = { count: 3, totalAmount: 23034 };

  const result = ctx.reconcile(pdfSummary, sheetSummary);

  assert.equal(result.isMatch, true);
  assert.equal(result.countDiff, 0);
  assert.equal(result.amountDiff, 0);
});

test('reconcile は差異がある場合 isMatch=false と差分を返す', () => {
  const pdfSummary = { settledCount: 5, settledAmount: 50000 };
  const sheetSummary = { count: 3, totalAmount: 23034 };

  const result = ctx.reconcile(pdfSummary, sheetSummary);

  assert.equal(result.isMatch, false);
  assert.equal(result.countDiff, -2);
  assert.equal(result.amountDiff, 23034 - 50000);
});

test('実データ(2026年08月分)では対象月と決済処理月のズレにより差異が検出される(既知の制限)', () => {
  const statementText = fs.readFileSync(path.join(__dirname, 'fixtures', 'statement-202608.txt'), 'utf8');
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sheet-rows-202608.json'), 'utf8'));

  const pdfSummary = ctx.parseStatementSummary(statementText);
  const targetMonthLabel = ctx.monthLabelFromDate(pdfSummary.periodStart);
  const sheetSummary = ctx.summarizeByMonth(rows, targetMonthLabel, '決済完了');
  const result = ctx.reconcile(pdfSummary, sheetSummary);

  // シート上の「対象月=2026年08月」は3件・¥23,034だが、
  // 収納明細書側の決済処理金額(合計)は返金分の相殺やタイミングのズレを含むため¥69,102となり、一致しない。
  // これは既知の制限であり、README「既知の制限」を参照。
  assert.equal(sheetSummary.totalAmount, 23034);
  assert.equal(pdfSummary.settledAmount, 69102);
  assert.equal(result.isMatch, false);

  const report = ctx.formatReconcileReport(result, targetMonthLabel, pdfSummary);
  assert.match(report, /差異があります/);
});
