/**
 * スプレッドシートを開いたときにカスタムメニューを追加する。
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('売上確認').addItem('収納明細書と自動照合', 'runReconciliation').addToUi();
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
