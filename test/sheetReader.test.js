'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGasModule } = require('./helpers/loadGas');

const ctx = loadGasModule(['SheetReader.gs']);

function fakeSheet(name, headerRow) {
  return {
    getName: () => name,
    getLastColumn: () => headerRow.length,
    getRange: () => ({ getValues: () => [headerRow] }),
  };
}

function fakeSpreadsheet(sheets) {
  return {
    getSheetByName: (name) => sheets.find((s) => s.getName() === name) || null,
    getSheets: () => sheets,
  };
}

const CSV_CONFIG = {
  TARGET_SHEET_NAME: '',
  CSV_EXPORTED_COLUMN: 'CSV出力済み',
};

test('findCsvTargetSheet はTARGET_SHEET_NAME未指定なら必要な列を持つシートを自動で見つける', () => {
  const salesSheet = fakeSheet('月次サマリー', ['対象月', '顧客名', 'ステータス', '合計']);
  const contractsSheet = fakeSheet('契約一覧', ['契約ID', '顧客ID', 'ステータス', '合計', 'CSV出力済み']);
  const spreadsheet = fakeSpreadsheet([salesSheet, contractsSheet]);

  const found = ctx.findCsvTargetSheet(spreadsheet, CSV_CONFIG);
  assert.equal(found.getName(), '契約一覧');
});

test('findCsvTargetSheet はTARGET_SHEET_NAMEで指定したシートに必要な列がなければエラーにする(設定ミスを無言のOKにしない)', () => {
  const wrongSheet = fakeSheet('契約一覧', ['対象月', '顧客名', 'ステータス', '合計']); // 顧客ID/CSV出力済みが無い
  const spreadsheet = fakeSpreadsheet([wrongSheet]);
  const config = Object.assign({}, CSV_CONFIG, { TARGET_SHEET_NAME: '契約一覧' });

  assert.throws(() => ctx.findCsvTargetSheet(spreadsheet, config), /必要な列/);
});

test('findCsvTargetSheet は該当するシートが複数あるとエラーにする', () => {
  const headers = ['契約ID', '顧客ID', 'ステータス', '合計', 'CSV出力済み'];
  const sheetA = fakeSheet('契約一覧A', headers);
  const sheetB = fakeSheet('契約一覧B', headers);
  const spreadsheet = fakeSpreadsheet([sheetA, sheetB]);

  assert.throws(() => ctx.findCsvTargetSheet(spreadsheet, CSV_CONFIG), /複数見つかりました/);
});

test('findCsvTargetSheet は該当するシートが無いとエラーにする', () => {
  const salesSheet = fakeSheet('月次サマリー', ['対象月', '顧客名', 'ステータス', '合計']);
  const spreadsheet = fakeSpreadsheet([salesSheet]);

  assert.throws(() => ctx.findCsvTargetSheet(spreadsheet, CSV_CONFIG), /見つかりませんでした/);
});

test('expectedSheetNameForPeriod はCSVの集計期間から「西暦下2桁+月2桁」のタブ名を推測する', () => {
  assert.equal(ctx.expectedSheetNameForPeriod('2026/08/01'), '2608');
  assert.equal(ctx.expectedSheetNameForPeriod('2026/9/01'), '2609');
  assert.equal(ctx.expectedSheetNameForPeriod('2026/12/01'), '2612');
});

test('expectedSheetNameForPeriod は読み取れない入力に対してnullを返す', () => {
  assert.equal(ctx.expectedSheetNameForPeriod(''), null);
  assert.equal(ctx.expectedSheetNameForPeriod(null), null);
  assert.equal(ctx.expectedSheetNameForPeriod('not a date'), null);
});

test('findCsvTargetSheet は実際のスプレッドシート構成(月ごとに別タブ・列構成もバラバラ)でも、CSVの集計期間から正しいタブを特定できる', () => {
  // 実際に確認した構成を再現: PM様用/2609/2610にはCSV出力済み列が無く、2608にだけある
  const pmSheet = fakeSheet('PM様用', ['対象月', '顧客名', '顧客ID', '代理店', 'サービス名', '合計', '支払方法', 'ステータス']);
  const sheet2608 = fakeSheet('2608', ['契約ID', '対象月', '顧客名', '顧客ID', '代理店', '親代理店', 'サービス名', '合計', '支払方法', 'ステータス', '獲得日', '無料期間', 'CSV出力済み', 'AIJAMID']);
  const sheet2609 = fakeSheet('2609', ['対象月', '顧客名', '顧客ID', '代理店', '親代理店', 'サービス名', '合計', '支払方法', 'ステータス']);
  const sheet2610 = fakeSheet('2610', ['対象月', '顧客名', '顧客ID', '代理店', '親代理店', 'サービス名', '合計', '支払方法', 'ステータス', '明細書番号／作成結果']);
  const spreadsheet = fakeSpreadsheet([pmSheet, sheet2608, sheet2609, sheet2610]);

  // 2608タブに対応するCSV(集計期間 2026/08/01〜)の場合
  const found = ctx.findCsvTargetSheet(spreadsheet, CSV_CONFIG, ctx.expectedSheetNameForPeriod('2026/08/01'));
  assert.equal(found.getName(), '2608');
});

test('findCsvTargetSheet は「CSV出力済み」列が無いタブ(標準形式)でも、顧客ID/ステータス/合計があれば正常に見つける', () => {
  // 標準のタブ形式(例: 2609)にはCSV出力済み列が無い。これは異常ではなく正常なタブ構成として扱う
  const sheet2609 = fakeSheet('2609', ['対象月', '顧客名', '顧客ID', '代理店', '親代理店', 'サービス名', '合計', '支払方法', 'ステータス']);
  const spreadsheet = fakeSpreadsheet([sheet2609]);

  const found = ctx.findCsvTargetSheet(spreadsheet, CSV_CONFIG, '2609');
  assert.equal(found.getName(), '2609');
});

test('findCsvTargetSheet は期待されるタブが見つかっても顧客ID/ステータス/合計すら無い場合はエラーにする', () => {
  const malformedSheet = fakeSheet('2611', ['日付', 'メモ']); // 想定外の構成
  const spreadsheet = fakeSpreadsheet([malformedSheet]);

  assert.throws(() => ctx.findCsvTargetSheet(spreadsheet, CSV_CONFIG, '2611'), /必要な列/);
});

test('readSheetRows はヘッダー行をキーにしたオブジェクト配列を返し、完全に空の行は除外する', () => {
  const sheet = {
    getDataRange: () => ({
      getValues: () => [
        ['顧客ID', '合計'],
        ['C1', 1000],
        ['', ''],
        ['C2', 2000],
      ],
    }),
  };

  const rows = ctx.readSheetRows(sheet);
  assert.deepEqual(rows, [
    { '顧客ID': 'C1', '合計': 1000 },
    { '顧客ID': 'C2', '合計': 2000 },
  ]);
});
