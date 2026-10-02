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
 * CONFIG.PDF_FOLDER_ID 配下のすべてのPDF(収納明細書)を対象に、
 * 売上管理シートの対象月別サマリーと突合し、結果を実行ログ(コンソール)に出力する。
 */
function runReconciliation() {
  var ui = SpreadsheetApp.getUi();
  var folder = DriveApp.getFolderById(CONFIG.PDF_FOLDER_ID);
  var files = folder.getFilesByType(MimeType.PDF);

  if (!files.hasNext()) {
    ui.alert('指定フォルダ(CONFIG.PDF_FOLDER_ID)にPDF(収納明細書)が見つかりませんでした。');
    return;
  }

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var targetSheet = findTargetSheet(spreadsheet, CONFIG);
  var rows = readSheetRows(targetSheet);

  var summaryLines = [];

  while (files.hasNext()) {
    var file = files.next();
    try {
      var text = extractTextFromPdf(file.getId());
      var pdfSummary = parseStatementSummary(text);
      var targetMonthLabel = monthLabelFromDate(pdfSummary.periodStart);
      var sheetSummary = summarizeByMonth(rows, targetMonthLabel, CONFIG.COMPLETED_STATUS);
      var result = reconcile(pdfSummary, sheetSummary);
      var report = formatReconcileReport(result, targetMonthLabel, pdfSummary);

      Logger.log('--- ' + file.getName() + ' ---\n' + report);
      summaryLines.push(file.getName() + ': ' + (result.isMatch ? '一致' : '差異あり(金額差 ' + formatYen(result.amountDiff) + ')'));
    } catch (e) {
      Logger.log('--- ' + file.getName() + ' --- でエラー: ' + e.message);
      summaryLines.push(file.getName() + ': エラー(' + e.message + ')');
    }
  }

  ui.alert('照合が完了しました。詳細は「実行数」の実行ログをご確認ください。\n\n' + summaryLines.join('\n'));
}

/**
 * CONFIG.CSV_FOLDER_ID 配下のすべてのCSV(収納明細書)を対象に、
 * 売上管理シートの「消し込み待ち」契約行(ステータス=決済完了・CSV出力済み=未)と
 * 顧客ID+金額で1件ずつ突合し、結果を実行ログ(コンソール)に出力する。
 * シートへの書き込みは行わない(レポート出力のみ)。
 */
function runCsvReconciliation() {
  var ui = SpreadsheetApp.getUi();
  var folder = DriveApp.getFolderById(CONFIG.CSV_FOLDER_ID);
  var files = folder.getFilesByType(MimeType.CSV);

  if (!files.hasNext()) {
    ui.alert('指定フォルダ(CONFIG.CSV_FOLDER_ID)にCSV(収納明細書)が見つかりませんでした。');
    return;
  }

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var targetSheet = findCsvTargetSheet(spreadsheet, CONFIG);
  var rows = readSheetRows(targetSheet);

  var summaryLines = [];

  while (files.hasNext()) {
    var file = files.next();
    try {
      var text = readCsvFileText(file.getId());
      var parsed = parseSbpsStatementCsv(text);
      var result = reconcileWithCsv(rows, parsed.transactions, CONFIG);
      var report = formatCsvReconcileReport(result, parsed.summary);

      Logger.log('--- ' + file.getName() + ' ---\n' + report);

      var issueCount = result.unmatchedRows.length + result.unmatchedTransactions.length;
      summaryLines.push(
        file.getName() + ': 入金確認OK ' + result.matched.length + '件 / 要確認 ' + issueCount + '件'
      );
    } catch (e) {
      Logger.log('--- ' + file.getName() + ' --- でエラー: ' + e.message);
      summaryLines.push(file.getName() + ': エラー(' + e.message + ')');
    }
  }

  ui.alert('CSV照合が完了しました。詳細は「実行数」の実行ログをご確認ください。\n\n' + summaryLines.join('\n'));
}
