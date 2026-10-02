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
