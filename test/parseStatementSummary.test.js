'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadGasModule } = require('./helpers/loadGas');

const ctx = loadGasModule(['Utils.gs', 'PdfParser.gs']);
const statementText = fs.readFileSync(path.join(__dirname, 'fixtures', 'statement-202608.txt'), 'utf8');

test('parseStatementSummary が実際の収納明細書(2026年08月分)から正しく集計値を抽出する', () => {
  const summary = ctx.parseStatementSummary(statementText);

  assert.equal(summary.periodStart.getFullYear(), 2026);
  assert.equal(summary.periodStart.getMonth(), 7); // 0-indexed: 8月
  assert.equal(summary.periodStart.getDate(), 1);
  assert.equal(summary.periodEnd.getDate(), 31);

  assert.equal(summary.salesCount, 168);
  assert.equal(summary.salesAmount, 159984);
  assert.equal(summary.refundCount, 38);
  assert.equal(summary.refundAmount, 90882);
  assert.equal(summary.settledCount, 206);
  assert.equal(summary.settledAmount, 69102);
  assert.equal(summary.feeAmount, 34660);
  assert.equal(summary.feeAmountWithTax, 35865);
  assert.equal(summary.transferAmount, 33237);
});

test('parseStatementSummary はPDFテキストが空の場合エラーを投げる', () => {
  assert.throws(() => ctx.parseStatementSummary(''), /PDFテキストが空/);
});

test('parseStatementSummary は集計期間が見つからない場合エラーを投げる', () => {
  assert.throws(() => ctx.parseStatementSummary('関係のないテキスト'), /集計期間/);
});
