'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadGasModule } = require('./helpers/loadGas');

const ctx = loadGasModule(['Utils.gs', 'CsvParser.gs', 'SheetReader.gs', 'ReconcileCsv.gs']);

const CONFIG = {
  COMPLETED_STATUS: '決済完了',
  CSV_EXPORTED_COLUMN: 'CSV出力済み',
  CSV_EXPORTED_PENDING_VALUE: '未',
  CSV_EXPORTED_DONE_VALUE: '済',
};

function loadFixtures() {
  const csvText = fs.readFileSync(path.join(__dirname, 'fixtures', 'sbps-statement-202608.csv'), 'utf8');
  const sheetRows = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sheet-rows-csv-pending.json'), 'utf8'));
  const { summary, transactions } = ctx.parseSbpsStatementCsv(csvText);
  return { summary, transactions, sheetRows };
}

test('reconcileWithCsv は 顧客ID+金額 が一致する「CSV出力済み=未」の行を消し込む', () => {
  const { transactions, sheetRows } = loadFixtures();
  const result = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG);

  // 決済完了×CSV出力済み=未 の行は5件(済の行・解約の行は対象外)
  assert.equal(result.pendingRowCount, 5);
  // うち4件(ファイルフォックス・N-support・kibidango x2)がCSVの売上と一致する
  assert.equal(result.matched.length, 4);

  const matchedCustomerIds = result.matched.map((m) => m.row['顧客ID']).sort();
  assert.deepEqual(matchedCustomerIds, ['C6A50A28C2A633', 'C6A52E8C24E3B5', 'C6A55F015547D5', 'C6A55F015547D5']);
});

test('reconcileWithCsv はCSVに対応する入金が見つからない行を unmatchedRows に入れる', () => {
  const { transactions, sheetRows } = loadFixtures();
  const result = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG);

  assert.equal(result.unmatchedRows.length, 1);
  assert.equal(result.unmatchedRows[0]['顧客ID'], 'C6A99999999999');
});

test('reconcileWithCsv は「CSV出力済み=済」や「決済完了以外」の行を突合対象から除外する', () => {
  const { transactions, sheetRows } = loadFixtures();
  const result = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG);

  const consideredContractIds = result.matched
    .map((m) => m.row['契約ID'])
    .concat(result.unmatchedRows.map((r) => r['契約ID']));

  assert.ok(!consideredContractIds.includes('7140f5dd-9ced-42d5-a25c-77f6e19c5eb6'), 'CSV出力済み=済の行は対象外');
  assert.ok(!consideredContractIds.includes('cancelled-row'), '解約ステータスの行は対象外');
});

test('reconcileWithCsv は対応するシート行が見つからないCSV取引を unmatchedTransactions に残す', () => {
  const { transactions, sheetRows } = loadFixtures();
  const result = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG);

  // 解約行(C6A57145E7886A)の分は消費されず残る
  const leftoverForCancelled = result.unmatchedTransactions.filter((t) => t.customerId === 'C6A57145E7886A');
  assert.equal(leftoverForCancelled.length, 1);

  // シートに一切登場しない顧客(C6A55B54B023A1)の取引は16件すべて残る
  const leftoverForUnknown = result.unmatchedTransactions.filter((t) => t.customerId === 'C6A55B54B023A1');
  assert.equal(leftoverForUnknown.length, 16);
});

test('reconcileWithCsv は返金レコードを突合に使わず、参考情報としてのみ返す', () => {
  const { transactions, sheetRows } = loadFixtures();
  const result = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG);

  assert.equal(result.refundTransactions.length, 19);
  result.refundTransactions.forEach((t) => assert.equal(t.kind, 'refund'));
});

test('formatCsvReconcileReport は要確認件数がある場合にその旨を明記する', () => {
  const { summary, transactions, sheetRows } = loadFixtures();
  const result = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG);
  const report = ctx.formatCsvReconcileReport(result, summary);

  assert.match(report, /要確認の項目があります/);
  assert.match(report, /C6A99999999999/);
});
