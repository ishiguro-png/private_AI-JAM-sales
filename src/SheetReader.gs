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
 * シートの1行目(ヘッダー行)が、指定した列名をすべて含むかを調べる。
 * GAS専用のI/O関数。
 */
function sheetHasHeaders(sheet, requiredHeaders) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return false;
  var headerRow = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  return requiredHeaders.every(function (h) {
    return headerRow.indexOf(h) !== -1;
  });
}

/**
 * 指定した列名をすべて持つシートを探索する。
 * 複数見つかった場合はエラーにする(どのタブを使うべきか一意に決められないため)。
 * GAS専用のI/O関数。
 */
function findSheetByHeaders(spreadsheet, requiredHeaders) {
  var matches = spreadsheet.getSheets().filter(function (sheet) {
    return sheetHasHeaders(sheet, requiredHeaders);
  });

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
 * CONFIG.TARGET_SHEET_NAME で指定されたシートが、指定した列名をすべて持つか検証して返す。
 * 名前で見つかっても必要な列がなければ、設定ミスとしてエラーにする
 * (そのまま読み進めると「対象0件=問題なし」という誤った"OK"になってしまうため)。
 * GAS専用のI/O関数。
 */
function resolveNamedSheet(spreadsheet, sheetName, requiredHeaders) {
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) return null;
  if (!sheetHasHeaders(sheet, requiredHeaders)) {
    throw new Error(
      'CONFIG.TARGET_SHEET_NAME「' + sheetName + '」は見つかりましたが、必要な列 [' +
      requiredHeaders.join(', ') + '] がありません。設定を確認してください。'
    );
  }
  return sheet;
}

/**
 * CONFIG.TARGET_SHEET_NAME で見つからない場合に、
 * 「対象月」「ステータス」「合計」列を持つシートを自動探索する(月次サマリー照合用)。
 * GAS専用のI/O関数。
 */
function findTargetSheet(spreadsheet, config) {
  var requiredHeaders = ['対象月', 'ステータス', '合計'];
  var byName = resolveNamedSheet(spreadsheet, config.TARGET_SHEET_NAME, requiredHeaders);
  if (byName) return byName;
  return findSheetByHeaders(spreadsheet, requiredHeaders);
}

/**
 * 「顧客ID」「CSV出力済み」「ステータス」「合計」列を持つシートを自動探索する
 * (CSV突合用)。契約単位の台帳シート(例: 契約一覧タブ)が想定対象。
 * GAS専用のI/O関数。
 */
function findCsvTargetSheet(spreadsheet, config) {
  var requiredHeaders = ['顧客ID', config.CSV_EXPORTED_COLUMN, 'ステータス', '合計'];
  var byName = resolveNamedSheet(spreadsheet, config.TARGET_SHEET_NAME, requiredHeaders);
  if (byName) return byName;
  return findSheetByHeaders(spreadsheet, requiredHeaders);
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
