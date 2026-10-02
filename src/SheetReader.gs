/**
 * シートの全データをヘッダー名をキーとしたオブジェクトの配列に変換する。
 * GAS専用のI/O関数。
 */
function readSheetRows(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length === 0) return [];

  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var isBlank = row.every(function (cell) {
      return cell === '' || cell === null;
    });
    if (isBlank) continue;

    var record = {};
    headers.forEach(function (header, idx) {
      record[header] = row[idx];
    });
    rows.push(record);
  }
  return rows;
}

/**
 * 指定した列名をすべて持つシートを探索する。
 * 複数見つかった場合はエラーにする(どのタブを使うべきか一意に決められないため)。
 * GAS専用のI/O関数。
 */
function findSheetByHeaders(spreadsheet, requiredHeaders) {
  var matches = [];
  var sheets = spreadsheet.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var lastColumn = sheets[i].getLastColumn();
    if (lastColumn === 0) continue;
    var headerRow = sheets[i].getRange(1, 1, 1, lastColumn).getValues()[0];
    var hasAll = requiredHeaders.every(function (h) {
      return headerRow.indexOf(h) !== -1;
    });
    if (hasAll) matches.push(sheets[i]);
  }

  if (matches.length === 0) {
    throw new Error('列 [' + requiredHeaders.join(', ') + '] を持つシートが見つかりませんでした。');
  }
  if (matches.length > 1) {
    var names = matches.map(function (s) {
      return s.getName();
    });
    throw new Error(
      '列 [' + requiredHeaders.join(', ') + '] を持つシートが複数見つかりました(' + names.join(', ') + ')。' +
      'どちらを使うか一意に決められません。'
    );
  }
  return matches[0];
}

/**
 * CONFIG.TARGET_SHEET_NAME で見つからない場合に、
 * 「対象月」「ステータス」「合計」列を持つシートを自動探索する(月次サマリー照合用)。
 * GAS専用のI/O関数。
 */
function findTargetSheet(spreadsheet, config) {
  var byName = spreadsheet.getSheetByName(config.TARGET_SHEET_NAME);
  if (byName) return byName;
  return findSheetByHeaders(spreadsheet, ['対象月', 'ステータス', '合計']);
}

/**
 * 「顧客ID」「CSV出力済み」「ステータス」「合計」列を持つシートを自動探索する
 * (CSV突合用)。契約単位の台帳シート(例: 契約一覧タブ)が想定対象。
 * GAS専用のI/O関数。
 */
function findCsvTargetSheet(spreadsheet, config) {
  var byName = spreadsheet.getSheetByName(config.TARGET_SHEET_NAME);
  if (byName) return byName;
  return findSheetByHeaders(spreadsheet, ['顧客ID', config.CSV_EXPORTED_COLUMN, 'ステータス', '合計']);
}

/**
 * 指定した対象月・ステータスに合致する行を集計する。
 * 副作用のない純粋関数。
 */
function summarizeByMonth(rows, targetMonthLabel, completedStatus) {
  var count = 0;
  var totalAmount = 0;
  var matchedRows = [];

  rows.forEach(function (row) {
    if (row['対象月'] !== targetMonthLabel) return;
    if (row['ステータス'] !== completedStatus) return;
    count += 1;
    totalAmount += parseCurrencyToNumber(row['合計']);
    matchedRows.push(row);
  });

  return { count: count, totalAmount: totalAmount, rows: matchedRows };
}
