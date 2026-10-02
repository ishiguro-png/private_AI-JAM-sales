'use strict';

/**
 * このファイルは「ロジックが仕様通りに動くか」ではなく、
 * 「実データに対してパーサーが本当に正しい数字を読み取れているか」を検証する。
 *
 * 2つの独立した裏付けを取っている:
 *
 * 1. CSV自身の内部整合性:
 *    取引明細(type5)を1件ずつ積み上げた金額が、CSVのサマリー行(type2)の
 *    金額と一致するか。パーサーが列を読み間違えていれば、ここでズレる。
 *
 * 2. CSVとPDFのクロスチェック:
 *    同じ期間(2026年08月分)について、SBペイメントサービスが発行した
 *    CSVとPDFをそれぞれ別のパーサー(CsvParser.gs / PdfParser.gs、実装も
 *    正規表現ベースとCSVレコード解析ベースで別物)で独立に読み取り、
 *    主要な数字(売上金額・返金金額・決済処理金額・件数)が一致するかを見る。
 *    2つの独立した実装・2つの独立した書類が同じ答えを出すことは、
 *    どちらのパーサーも偶然ではなく正しく数字を拾えていることの裏付けになる。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadGasModule } = require('./helpers/loadGas');

const ctx = loadGasModule(['Utils.gs', 'CsvParser.gs', 'PdfParser.gs']);

function loadCsv() {
  const csvText = fs.readFileSync(path.join(__dirname, 'fixtures', 'sbps-statement-202608.csv'), 'utf8');
  return ctx.parseSbpsStatementCsv(csvText);
}

function loadPdfText() {
  return fs.readFileSync(path.join(__dirname, 'fixtures', 'statement-202608.txt'), 'utf8');
}

test('CSV内部整合性: 取引明細(売上-返金)の積み上げがサマリー行の取扱金額と一致する', () => {
  const { summary, transactions } = loadCsv();

  const salesSum = transactions.filter((t) => t.kind === 'sale').reduce((sum, t) => sum + t.amount, 0);
  const refundsSum = transactions.filter((t) => t.kind === 'refund').reduce((sum, t) => sum + t.amount, 0);

  assert.equal(salesSum + refundsSum, summary.grossAmount);
});

test('CSV内部整合性: 取引明細の件数(売上+返金+与信)の合計が206件(実データの既知値)と一致する', () => {
  const { transactions } = loadCsv();

  const sales = transactions.filter((t) => t.kind === 'sale');
  const refunds = transactions.filter((t) => t.kind === 'refund');
  const authorizations = transactions.filter((t) => t.kind === 'authorization');

  assert.equal(sales.length, 86);
  assert.equal(refunds.length, 19);
  assert.equal(authorizations.length, 101);
  assert.equal(sales.length + refunds.length + authorizations.length, transactions.length);
});

test('クロスチェック: 同じ期間のCSVとPDFを独立に解析しても、売上/返金/決済処理金額が一致する', () => {
  const { summary: csvSummary, transactions } = loadCsv();
  const pdfSummary = ctx.parseStatementSummary(loadPdfText());

  const salesSum = transactions.filter((t) => t.kind === 'sale').reduce((sum, t) => sum + t.amount, 0);
  const refundsSum = Math.abs(transactions.filter((t) => t.kind === 'refund').reduce((sum, t) => sum + t.amount, 0));

  // PDF側の「売上金額」「返金金額」「決済処理金額(合計)」「合計件数」と一致するか
  assert.equal(salesSum, pdfSummary.salesAmount);
  assert.equal(refundsSum, pdfSummary.refundAmount);
  assert.equal(csvSummary.grossAmount, pdfSummary.settledAmount);

  const totalTransactionCount = transactions.length;
  assert.equal(totalTransactionCount, pdfSummary.settledCount);

  // 振込金額・集計期間もCSVとPDFで一致するはず
  assert.equal(csvSummary.transferAmount, pdfSummary.transferAmount);
  assert.equal(csvSummary.periodFrom, formatDateYmdForCompare(pdfSummary.periodStart));
  assert.equal(csvSummary.periodTo, formatDateYmdForCompare(pdfSummary.periodEnd));
});

function formatDateYmdForCompare(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '/' + m + '/' + d;
}
