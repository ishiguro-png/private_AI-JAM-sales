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

test('reconcileWithCsv は「CSV出力済み」列が無い標準形式のタブ(例: 2609)でも、ステータスだけで対象行を判定して正しく消し込む', () => {
  const { transactions } = loadFixtures();

  // 標準形式(2609など)を再現: CSV出力済み列そのものが存在しない
  const standardFormatRows = [
    { '契約ID': 'a', '顧客ID': 'C6A50A28C2A633', '顧客名': '株式会社ファイルフォックス八王子', '合計': '¥7,678', 'ステータス': '決済完了' },
    { '契約ID': 'b', '顧客ID': 'C6A52E8C24E3B5', '顧客名': '株式会社N-support', '合計': '¥7,678', 'ステータス': '決済完了' },
    { '契約ID': 'c', '顧客ID': 'C6A5597B7D3A3D', '顧客名': '株式会社デルフィーノケア', '合計': '¥7,678', 'ステータス': '決済完了' },
    { '契約ID': 'd', '顧客ID': 'C6A99999999999', '顧客名': 'シートにしかいない架空顧客', '合計': '¥9,999', 'ステータス': '決済完了' },
    { '契約ID': 'e', '顧客ID': 'C6A00000000000', '顧客名': '架空の解約顧客', '合計': '¥7,678', 'ステータス': '解約' },
  ];

  const result = ctx.reconcileWithCsv(standardFormatRows, transactions, CONFIG);

  // CSV出力済み列が無くても、ステータス=決済完了の4行が対象になる(解約行は除く)
  assert.equal(result.pendingRowCount, 4);
  assert.equal(result.matched.length, 3);
  assert.equal(result.unmatchedRows.length, 1);
  assert.equal(result.unmatchedRows[0]['顧客ID'], 'C6A99999999999');
});

test('verifyTransferAmount は実際の収納明細CSVで「取扱金額-手数料-消費税額=お振込金額」が成立することを確認する', () => {
  const { summary } = loadFixtures();
  const check = ctx.verifyTransferAmount(summary);

  assert.equal(check.grossAmount, 69102);
  assert.equal(check.feeAmount, 34657);
  assert.equal(check.taxAmount, 1208);
  assert.equal(check.expectedTransferAmount, 33237);
  assert.equal(check.actualTransferAmount, 33237);
  assert.equal(check.diff, 0);
  assert.equal(check.isMatch, true);
});

test('verifyTransferAmount は内訳とお振込金額が合わない場合に差額付きで不一致を返す', () => {
  const check = ctx.verifyTransferAmount({
    grossAmount: 69102,
    feeAmount: 34657,
    taxAmount: 1208,
    transferAmount: 30000, // 本来は33237のはずが食い違っているケース
  });

  assert.equal(check.expectedTransferAmount, 33237);
  assert.equal(check.diff, -3237);
  assert.equal(check.isMatch, false);
});

test('formatCsvReconcileReport はお振込金額の整合性チェックを冒頭に表示し、不一致なら全体を要確認にする', () => {
  const { transactions, sheetRows } = loadFixtures();
  const cleanResult = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG);

  const mismatchedSummary = {
    companyName: '株式会社ＣＲＡＦＴＲＡＮＳ',
    serviceName: 'AI JAM',
    periodFrom: '2026/08/01',
    periodTo: '2026/08/31',
    grossAmount: 69102,
    feeAmount: 34657,
    taxAmount: 1208,
    transferAmount: 30000,
  };

  const report = ctx.formatCsvReconcileReport(cleanResult, mismatchedSummary);
  assert.match(report, /お振込金額の整合性チェック/);
  assert.match(report, /不一致/);
  assert.match(report, /要確認の項目があります/);
});

test('reconcileWithCsv は実データの2608タブ(対象月=2026年08月)3行を¥23,034ぶん正しく全件消し込む', () => {
  const { transactions, sheetRows } = loadFixtures();
  const result = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG);

  // 決済完了×CSV出力済み=未 の行は7件(済の行・解約の行は対象外)
  assert.equal(result.pendingRowCount, 7);
  // 2608タブの3行(ファイルフォックス・N-support・デルフィーノケア)は、
  // このCSV(8月分の集計期間)とそのまま対応するのですべて一致する
  assert.equal(result.matched.length, 3);

  const matchedCustomerIds = result.matched.map((m) => m.row['顧客ID']).sort();
  assert.deepEqual(matchedCustomerIds, ['C6A50A28C2A633', 'C6A52E8C24E3B5', 'C6A5597B7D3A3D']);

  const matchedTotal = result.matched.reduce((sum, m) => sum + m.transaction.amount, 0);
  assert.equal(matchedTotal, 23034);
});

test('reconcileWithCsv はCSVに対応する入金が見つからない行を unmatchedRows に入れる(返金で相殺された2609タブの契約を含む)', () => {
  const { transactions, sheetRows } = loadFixtures();
  const result = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG);

  // シートにしかいない架空顧客(1件) + 返金で相殺されたkibidangoの2行 + 西新宿ドットネット(1件)
  assert.equal(result.unmatchedRows.length, 4);
  const unmatchedCustomerIds = result.unmatchedRows.map((r) => r['顧客ID']).sort();
  assert.deepEqual(unmatchedCustomerIds, ['C6A55F015547D5', 'C6A55F015547D5', 'C6A57145E7886A', 'C6A99999999999']);
});

test('reconcileWithCsv は決済エラー等で同額返金された売上を offsetByRefund に分離し、黙って「一致」にしない', () => {
  const { transactions, sheetRows } = loadFixtures();
  const result = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG);

  // kibidango(8件、¥7,678)・西新宿ドットネット(1件、¥7,678)は全額返金で純額ゼロ、
  // シートに登場しない顧客(10件、¥2,178)も同額返金されている分だけ相殺される
  assert.equal(result.offsetByRefund.length, 19);
  const offsetCustomerIds = result.offsetByRefund.map((t) => t.customerId);
  assert.equal(offsetCustomerIds.filter((id) => id === 'C6A55F015547D5').length, 8);
  assert.equal(offsetCustomerIds.filter((id) => id === 'C6A57145E7886A').length, 1);
  assert.equal(offsetCustomerIds.filter((id) => id === 'C6A55B54B023A1').length, 10);
});

test('reconcileWithCsv は「CSV出力済み=済」や「決済完了以外」の行を突合対象から除外する', () => {
  const { transactions, sheetRows } = loadFixtures();
  const result = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG);

  const consideredContractIds = result.matched
    .map((m) => m.row['契約ID'])
    .concat(result.unmatchedRows.map((r) => r['契約ID']));

  assert.ok(!consideredContractIds.includes('already-done-row'), 'CSV出力済み=済の行は対象外');
  assert.ok(!consideredContractIds.includes('cancelled-row'), '解約ステータスの行は対象外');
});

test('reconcileWithCsv は対応するシート行が見つからないCSV取引を unmatchedTransactions に残す', () => {
  const { transactions, sheetRows } = loadFixtures();
  const result = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG);

  // 解約行(C6A57145E7886A)の売上1件は、実データでは同額返金され純額ゼロなので
  // offsetByRefundに回り、unmatchedTransactionsには残らない
  const leftoverForCancelled = result.unmatchedTransactions.filter((t) => t.customerId === 'C6A57145E7886A');
  assert.equal(leftoverForCancelled.length, 0);

  // シートに一切登場しない顧客(C6A55B54B023A1)は、売上16件のうち10件(¥2,178分)が
  // 返金で相殺され、残り6件(¥7,678分)がunmatchedTransactionsに残る
  const leftoverForUnknown = result.unmatchedTransactions.filter((t) => t.customerId === 'C6A55B54B023A1');
  assert.equal(leftoverForUnknown.length, 6);
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

test('reconcileWithCsv はCONFIG.EXCLUDED_CUSTOMER_IDSの顧客(自社テストアカウント等)を「要確認」扱いから外し、excludedTransactionsに分離する', () => {
  const { transactions, sheetRows } = loadFixtures();
  const configWithExclusion = Object.assign({}, CONFIG, { EXCLUDED_CUSTOMER_IDS: ['C6A55B54B023A1'] });

  const resultWithout = ctx.reconcileWithCsv(sheetRows, transactions, CONFIG);
  const resultWith = ctx.reconcileWithCsv(sheetRows, transactions, configWithExclusion);

  // 除外設定なし: C6A55B54B023A1の分が unmatchedTransactions / offsetByRefund に混ざっている
  assert.ok(resultWithout.unmatchedTransactions.some((t) => t.customerId === 'C6A55B54B023A1'));
  assert.ok(resultWithout.offsetByRefund.some((t) => t.customerId === 'C6A55B54B023A1'));

  // 除外設定あり: C6A55B54B023A1の分はどの「要確認」バケツにも残らない
  assert.ok(!resultWith.unmatchedTransactions.some((t) => t.customerId === 'C6A55B54B023A1'));
  assert.ok(!resultWith.offsetByRefund.some((t) => t.customerId === 'C6A55B54B023A1'));
  assert.ok(!resultWith.refundTransactions.some((t) => t.customerId === 'C6A55B54B023A1'));

  // 代わりにexcludedTransactionsに売上16件(返金相殺された10件+未消込みの6件)すべてが入る
  const excludedSales = resultWith.excludedTransactions.filter((t) => t.kind === 'sale');
  assert.equal(excludedSales.length, 16);

  // 2608タブの3件の一致結果など、他の判定には影響しない
  assert.equal(resultWith.matched.length, resultWithout.matched.length);
});
