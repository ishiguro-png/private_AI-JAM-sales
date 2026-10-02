/**
 * スプレッドシートを開いたときにカスタムメニューを追加する。
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('売上確認')
    .addItem('収納明細書(PDF)と自動照合(月次サマリー)', 'runReconciliation')
    .addItem('収納明細書(CSV)と自動照合(本番用)', 'runCsvReconciliation')
    .addToUi();
}

/**
 * folderId配下の指定mimeTypeのファイルを順に処理する共通ループ。
 * processFile(file) は1行サマリーの文字列を返すこと(エラー時は自前でcatchせず投げてよい。
 * ここでまとめてcatchし、ログとサマリーに「エラー」として記録する)。
 * GAS専用のI/O関数。
 */
function processFolderFiles(folderId, mimeType, processFile) {
  var folder = DriveApp.getFolderById(folderId);
  var files = folder.getFilesByType(mimeType);

  var summaryLines = [];
  var fileCount = 0;

  while (files.hasNext()) {
    var file = files.next();
    fileCount++;
    try {
      summaryLines.push(processFile(file));
    } catch (e) {
      Logger.log('--- ' + file.getName() + ' --- でエラー: ' + e.message);
      summaryLines.push(file.getName() + ': エラー(' + e.message + ')');
    }
  }

  return { fileCount: fileCount, summaryLines: summaryLines };
}

/**
 * CONFIG.PDF_FOLDER_ID 配下のすべてのPDF(収納明細書)を対象に、
 * 売上管理シートの対象月別サマリーと突合し、結果を実行ログ(コンソール)に出力する。
 */
function runReconciliation() {
  var ui = SpreadsheetApp.getUi();
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var targetSheet = findTargetSheet(spreadsheet, CONFIG);
  var rows = readSheetRows(targetSheet);

  var run = processFolderFiles(CONFIG.PDF_FOLDER_ID, MimeType.PDF, function (file) {
    var text = extractTextFromPdf(file.getId());
    var pdfSummary = parseStatementSummary(text);
    var targetMonthLabel = monthLabelFromDate(pdfSummary.periodStart);
    var sheetSummary = summarizeByMonth(rows, targetMonthLabel, CONFIG.COMPLETED_STATUS);
    var result = reconcile(pdfSummary, sheetSummary);
    var report = formatReconcileReport(result, targetMonthLabel, pdfSummary);

    Logger.log('--- ' + file.getName() + ' ---\n' + report);
    return file.getName() + ': ' + (result.isMatch ? '一致' : '差異あり(金額差 ' + formatYen(result.amountDiff) + ')');
  });

  if (run.fileCount === 0) {
    ui.alert('指定フォルダ(CONFIG.PDF_FOLDER_ID)にPDF(収納明細書)が見つかりませんでした。');
    return;
  }

  ui.alert('照合が完了しました。詳細は「実行数」の実行ログをご確認ください。\n\n' + run.summaryLines.join('\n'));
}

/**
 * CONFIG.CSV_FOLDER_ID 配下のすべてのCSV(収納明細書)を対象に、
 * 売上管理シートの「消し込み待ち」契約行(ステータス=決済完了・CSV出力済み=未)と
 * 顧客ID+金額で1件ずつ突合し、結果を実行ログ(コンソール)に出力する。
 * シートへの書き込みは行わない(レポート出力のみ)。
 *
 * フォルダ内に複数のCSVがある場合、同じ「消し込み待ち」行が複数ファイルに対して
 * 二重に「入金確認OK」と判定されないよう、この実行内で既に一致した行は
 * alreadyMatchedRows に積み増して後続ファイルの突合対象から除外する。
 */
function runCsvReconciliation() {
  var ui = SpreadsheetApp.getUi();
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var targetSheet = findCsvTargetSheet(spreadsheet, CONFIG);
  var rows = readSheetRows(targetSheet);
  var alreadyMatchedRows = new Set();

  var run = processFolderFiles(CONFIG.CSV_FOLDER_ID, MimeType.CSV, function (file) {
    var text = readCsvFileText(file.getId());
    var parsed = parseSbpsStatementCsv(text);
    var result = reconcileWithCsv(rows, parsed.transactions, CONFIG, alreadyMatchedRows);
    var report = formatCsvReconcileReport(result, parsed.summary);

    Logger.log('--- ' + file.getName() + ' ---\n' + report);

    result.matched.forEach(function (m) {
      alreadyMatchedRows.add(m.row);
    });

    var issueCount =
      result.unmatchedRows.length +
      result.unmatchedTransactions.length +
      result.rowsMissingCustomerId.length +
      result.unidentifiedTransactions.length;
    return file.getName() + ': 入金確認OK ' + result.matched.length + '件 / 要確認 ' + issueCount + '件';
  });

  if (run.fileCount === 0) {
    ui.alert('指定フォルダ(CONFIG.CSV_FOLDER_ID)にCSV(収納明細書)が見つかりませんでした。');
    return;
  }

  ui.alert('CSV照合が完了しました。詳細は「実行数」の実行ログをご確認ください。\n\n' + run.summaryLines.join('\n'));
}
