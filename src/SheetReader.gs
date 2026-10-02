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
  if (!sheetName) return null;
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
 * CSVの集計期間(集計期間FROM。例: "2026/08/01")から、対応するタブ名を推測する。
 * 実際のスプレッドシートでは、月ごとに別タブ(例: "2608" = 2026年08月分)に
 * 分かれており、タブ名は「西暦下2桁+月2桁」になっている。
 * 副作用のない純粋関数。periodFromが読み取れない場合はnullを返す。
 */
function expectedSheetNameForPeriod(periodFrom) {
  if (!periodFrom) return null;
  var match = String(periodFrom).match(/^(\d{4})\/(\d{1,2})\//);
  if (!match) return null;
  var yy = match[1].slice(-2);
  var mm = match[2].length === 1 ? '0' + match[2] : match[2];
  return yy + mm;
}

/**
 * 「顧客ID」「ステータス」「合計」列を持つシートを探す(CSV突合用)。
 * 「CSV出力済み」列は一部のタブ(例: 2608)にしかない任意項目のため、
 * 必須列には含めない(reconcileWithCsv側で、列があれば使う・無ければ
 * ステータスだけで判定する、という形で吸収する)。
 *
 * 実際のスプレッドシートは月ごとに別タブ(例: "2608"、標準形式は"2609")に
 * 分かれているため、「列構成だけで1つに絞り込む」自動探索には頼らず、
 * CSVの集計期間から期待されるタブ名(例: 2026/08→"2608")を直接指定して探す。
 *
 * 優先順位:
 *  1. CONFIG.TARGET_SHEET_NAME が明示されていればそれを使う(手動上書き)
 *  2. CSVの集計期間から推測したタブ名(例: "2608")のシートが見つかればそれを使う
 *  3. どちらもなければ、列構成だけで1つに絞り込めるシートを探す(フォールバック)
 *
 * GAS専用のI/O関数。
 */
function findCsvTargetSheet(spreadsheet, config, expectedSheetName) {
  var requiredHeaders = ['顧客ID', 'ステータス', '合計'];

  var byConfigName = resolveNamedSheet(spreadsheet, config.TARGET_SHEET_NAME, requiredHeaders);
  if (byConfigName) return byConfigName;

  if (expectedSheetName) {
    var sheet = spreadsheet.getSheetByName(expectedSheetName);
    if (sheet) {
      if (!sheetHasHeaders(sheet, requiredHeaders)) {
        throw new Error(
          'タブ「' + expectedSheetName + '」は見つかりましたが、CSV自動照合に必要な列 [' +
          requiredHeaders.join(', ') + '] がありません。想定外のタブ構成の可能性があるため、' +
          '列構成を確認してください。'
        );
      }
      return sheet;
    }
  }

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
