/**
 * onOpen() はこのファイルには置かない。
 *
 * 同一プロジェクト内(このファイル + 「明細書作成」のファイル)に onOpen() を
 * 2つ定義すると、GASはファイル一覧の下にあるものを優先して上書きしてしまい、
 * 上にある方のメニューが静かに消える(エラーにはならない)。
 * 「明細書作成」側のファイル(コード.gs)にすでに両メニューを統合した onOpen() が
 * あるため、重複を避けるためここでは定義しない。
 *
 * 売上確認メニューの中身(このツールが呼び出すメニュー項目名)は以下の通り:
 *   - 収納明細書(CSV)と自動照合  → runCsvReconciliation
 *   - 月次の自動実行を設定する    → createMonthlyCsvTrigger
 *   - 月次の自動実行を解除する    → removeMonthlyCsvTrigger
 * 「明細書作成」側の onOpen() にこの3項目を追加する形で統合すること。
 */

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
 * CONFIG.CSV_FOLDER_ID 配下のすべてのCSV(収納明細書)を対象に、
 * 売上管理シートの「消し込み待ち」契約行と顧客ID+金額で1件ずつ突合する実処理。
 * UI(SpreadsheetApp.getUi())には一切触れない。時間主導型トリガーからも、
 * メニューからも、この関数を呼び出す(呼び出し側がUI表示orメール送信を行う)。
 *
 * 実際のスプレッドシートは月ごとに別タブ(例: "2608")に分かれているため、
 * CSVごとにその集計期間から対象タブを都度特定する(findCsvTargetSheet)。
 * 同じタブを複数のCSVで処理する場合に、同じ「消し込み待ち」行が二重に
 * 「入金確認OK」と判定されないよう、タブ名ごとにalreadyMatchedRowsを分けて管理する。
 *
 * 返り値の files 配列の各要素は { fileName, sheetName, report, matchedCount,
 * issueCount, isError } で、issueCount > 0 または isError === true の
 * ファイルが1つでもあれば「要確認」として扱う想定。
 */
function runCsvReconciliationCore() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  var rowsBySheetName = {};
  var matchedRowsBySheetName = {};
  var files = [];

  // processFolderFilesの共通catchはログ記録用の最終防衛ラインとして残しつつ、
  // files配列への構造化された記録はここで直接行う(エラー時も含めて1箇所で完結させる)。
  var run = processFolderFiles(CONFIG.CSV_FOLDER_ID, MimeType.CSV, function (file) {
    try {
      var text = readCsvFileText(file.getId());
      var parsed = parseSbpsStatementCsv(text);

      var expectedSheetName = expectedSheetNameForPeriod(parsed.summary.periodFrom);
      var targetSheet = findCsvTargetSheet(spreadsheet, CONFIG, expectedSheetName);
      var sheetKey = targetSheet.getName();

      if (!rowsBySheetName[sheetKey]) {
        rowsBySheetName[sheetKey] = readSheetRows(targetSheet);
        matchedRowsBySheetName[sheetKey] = new Set();
      }

      var result = reconcileWithCsv(
        rowsBySheetName[sheetKey],
        parsed.transactions,
        CONFIG,
        matchedRowsBySheetName[sheetKey]
      );
      var report = formatCsvReconcileReport(result, parsed.summary);

      Logger.log('--- ' + file.getName() + '(対象タブ: ' + sheetKey + ') ---\n' + report);

      result.matched.forEach(function (m) {
        matchedRowsBySheetName[sheetKey].add(m.row);
      });

      var issueCount =
        result.unmatchedRows.length +
        result.unmatchedTransactions.length +
        result.rowsMissingCustomerId.length +
        result.unidentifiedTransactions.length;

      files.push({
        fileName: file.getName(),
        sheetName: sheetKey,
        report: report,
        matchedCount: result.matched.length,
        issueCount: issueCount,
        isError: false,
      });

      return (
        file.getName() + '(タブ:' + sheetKey + '): 入金確認OK ' + result.matched.length +
        '件 / 要確認 ' + issueCount + '件'
      );
    } catch (e) {
      files.push({
        fileName: file.getName(),
        sheetName: null,
        report: 'エラー: ' + e.message,
        matchedCount: 0,
        issueCount: 0,
        isError: true,
      });
      throw e; // processFolderFiles側のログ・summaryLinesへの記録にも委ねる
    }
  });

  return { fileCount: run.fileCount, summaryLines: run.summaryLines, files: files };
}

/**
 * メニューから実行するCSV突合。実処理はrunCsvReconciliationCoreに任せ、
 * ここでは結果をダイアログ表示するだけ。
 */
function runCsvReconciliation() {
  var ui = SpreadsheetApp.getUi();
  var run = runCsvReconciliationCore();

  if (run.fileCount === 0) {
    ui.alert('指定フォルダ(CONFIG.CSV_FOLDER_ID)にCSV(収納明細書)が見つかりませんでした。');
    return;
  }

  ui.alert('CSV照合が完了しました。詳細は「実行数」の実行ログをご確認ください。\n\n' + run.summaryLines.join('\n'));
}

/**
 * 時間主導型トリガーから呼び出すCSV突合。トリガー実行時はUIが無いため
 * SpreadsheetApp.getUi()は使えない。「要確認」の項目があるファイル、または
 * エラーになったファイルが1つでもあれば、CONFIG.NOTIFY_EMAILへメールで知らせる。
 * 新規CSVが無い月や、すべて「差異なし」だった場合はメールを送らない(静かに終わる)。
 */
function runCsvReconciliationScheduled() {
  var run = runCsvReconciliationCore();

  if (run.fileCount === 0) {
    Logger.log('runCsvReconciliationScheduled: 新規のCSVはありませんでした。');
    return;
  }

  var filesNeedingAttention = run.files.filter(function (f) {
    return f.isError || f.issueCount > 0;
  });

  if (filesNeedingAttention.length === 0) {
    Logger.log('runCsvReconciliationScheduled: ' + run.fileCount + '件処理し、すべて差異なしでした。');
    return;
  }

  if (!CONFIG.NOTIFY_EMAIL) {
    Logger.log(
      '要確認の項目がありますが、CONFIG.NOTIFY_EMAILが未設定のためメール通知をスキップしました。'
    );
    return;
  }

  var subject = '【売上確認】要確認のCSV突合結果が' + filesNeedingAttention.length + '件あります';
  var body = filesNeedingAttention
    .map(function (f) {
      return '■ ' + f.fileName + (f.sheetName ? '(タブ: ' + f.sheetName + ')' : '') + '\n' + f.report;
    })
    .join('\n\n----------------------------------------\n\n');

  MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, body);
  Logger.log('要確認の項目があったため、' + CONFIG.NOTIFY_EMAIL + ' へメール通知しました。');
}

/**
 * runCsvReconciliationScheduled を毎月実行する時間主導型トリガーを作成する。
 * 収納明細書は毎月5〜10日頃に届く想定のため、その中間あたり(8日)に設定している。
 * 既に同名のトリガーがある場合は、重複作成を避けるため一度削除してから作り直す。
 * メニュー「月次の自動実行を設定する」、またはApps Scriptエディタから直接実行する。
 */
function createMonthlyCsvTrigger() {
  removeMonthlyCsvTrigger();

  ScriptApp.newTrigger('runCsvReconciliationScheduled')
    .timeBased()
    .onMonthDay(8)
    .atHour(9)
    .create();

  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    ui = null;
  }
  var message = '毎月8日の9時台にCSV自動照合を実行するよう設定しました。';
  if (ui) {
    ui.alert(message);
  } else {
    Logger.log(message);
  }
}

/**
 * createMonthlyCsvTrigger で作成した月次トリガーを削除する。
 */
function removeMonthlyCsvTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'runCsvReconciliationScheduled') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
