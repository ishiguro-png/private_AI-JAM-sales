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

test('reconcileWithCsv は alreadyMatchedRows に渡した行を突合対象から除外する(同一実行内の複数CSVでの二重消込み防止)', () => {
  const sheetRows = [
    { '契約ID': 'only-row', '顧客ID': 'C1', '合計': '¥1,000', 'ステータス': '決済完了', 'CSV出力済み': '未' },
  ];
  const transactions = [{ customerId: 'C1', amount: 1000, kind: 'sale', saleDate: '2026/08/01' }];

  // 1ファイル目: 消し込み成功
  const firstRunResult = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG);
  assert.equal(firstRunResult.matched.length, 1);

  const alreadyMatchedRows = new Set(firstRunResult.matched.map((m) => m.row));

  // 2ファイル目(同じ実行内): 既に一致済みの行なので、別のCSVに同額取引があっても二重計上しない
  const secondRunResult = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG, alreadyMatchedRows);
  assert.equal(secondRunResult.pendingRowCount, 0);
  assert.equal(secondRunResult.matched.length, 0);
  // プールされたCSV取引はシート側の対象が無いので unmatchedTransactions に残る
  assert.equal(secondRunResult.unmatchedTransactions.length, 1);
});

test('reconcileWithCsv は顧客IDが空の消し込み待ち行を rowsMissingCustomerId に分離し、黙って消さない', () => {
  const sheetRows = [
    { '契約ID': 'no-customer-id', '顧客ID': '', '合計': '¥1,000', 'ステータス': '決済完了', 'CSV出力済み': '未' },
  ];
  const result = ctx.reconcileWithCsv(sheetRows, [], CONFIG);

  assert.equal(result.pendingRowCount, 0);
  assert.equal(result.rowsMissingCustomerId.length, 1);
  assert.equal(result.rowsMissingCustomerId[0]['契約ID'], 'no-customer-id');
});

test('reconcileWithCsv は金額が0円でない顧客ID空のCSV取引を unidentifiedTransactions として警告する', () => {
  const transactions = [
    { customerId: '', amount: 3000, kind: 'sale', saleDate: '2026/08/01' }, // 要警告: 実際にお金が動いている
    { customerId: '', amount: 0, kind: 'sale', saleDate: '2026/08/01' }, // EMV 3-Dセキュア認証費用などは警告対象外
  ];
  const result = ctx.reconcileWithCsv([], transactions, CONFIG);

  assert.equal(result.unidentifiedTransactions.length, 1);
  assert.equal(result.unidentifiedTransactions[0].amount, 3000);
});
