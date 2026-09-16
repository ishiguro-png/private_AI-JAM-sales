/**
 * SBペイメントサービス発行の「収納明細書」PDFをGoogleドキュメントに変換してテキスト化する。
 * PDFはテキストレイヤーを持つ(スキャン画像ではない)ため、OCRなしの変換でも
 * 十分な精度でテキストが取得できる。
 *
 * GAS専用のI/O関数のため、Node上のテストからは呼び出さない。
 */
function extractTextFromPdf(fileId) {
  var pdfFile = DriveApp.getFileById(fileId);
  var blob = pdfFile.getBlob();

  var resource = {
    title: 'tmp_statement_text_' + new Date().getTime(),
    mimeType: MimeType.GOOGLE_DOCS,
  };

  var tempFile = Drive.Files.insert(resource, blob);
  try {
    var doc = DocumentApp.openById(tempFile.id);
    return doc.getBody().getText();
  } finally {
    Drive.Files.remove(tempFile.id);
  }
}

/**
 * 収納明細書のテキストから、突合に必要な集計値を抽出する。
 * 副作用のない純粋関数。GAS/Nodeどちらからも同じロジックで呼び出せる。
 *
 * 抽出対象:
 *  - periodStart / periodEnd : ■集計期間の開始日・終了日
 *  - salesCount / salesAmount        : 明細合計行の「売上/与信件数」「売上金額」
 *  - refundCount / refundAmount      : 明細合計行の「返金/与信取消件数」「返金金額」
 *  - settledCount / settledAmount    : 明細合計行の「合計件数」「合計金額」(決済処理金額の純額)
 *  - feeAmount / feeAmountWithTax    : 明細合計行の手数料「金額」「税込金額」
 *  - transferAmount                  : お振込金額
 */
function parseStatementSummary(text) {
  if (!text) {
    throw new Error('PDFテキストが空です');
  }

  var periodMatch = text.match(
    /集計期間[：:]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[～~〜]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/
  );
  if (!periodMatch) {
    throw new Error('集計期間が見つかりませんでした');
  }
  var periodStart = new Date(Number(periodMatch[1]), Number(periodMatch[2]) - 1, Number(periodMatch[3]));
  var periodEnd = new Date(Number(periodMatch[4]), Number(periodMatch[5]) - 1, Number(periodMatch[6]));

  var transferMatch = text.match(/お振込金額\s*[：:]\s*([¥\d,]+)/);

  // 例: "合計 168 ¥159,984 38 ¥90,882 206 ¥69,102 ¥34,660 ¥35,865 ¥33,237"
  var totalLineMatch = text.match(/^合計\s+([0-9¥,.\s]+)$/m);
  if (!totalLineMatch) {
    throw new Error('明細合計行が見つかりませんでした');
  }
  var tokens = totalLineMatch[1].trim().split(/\s+/);
  if (tokens.length < 9) {
    throw new Error('明細合計行の項目数が想定と異なります: ' + tokens.join(','));
  }

  return {
    periodStart: periodStart,
    periodEnd: periodEnd,
    salesCount: parseCurrencyToNumber(tokens[0]),
    salesAmount: parseCurrencyToNumber(tokens[1]),
    refundCount: parseCurrencyToNumber(tokens[2]),
    refundAmount: parseCurrencyToNumber(tokens[3]),
    settledCount: parseCurrencyToNumber(tokens[4]),
    settledAmount: parseCurrencyToNumber(tokens[5]),
    feeAmount: parseCurrencyToNumber(tokens[6]),
    feeAmountWithTax: parseCurrencyToNumber(tokens[7]),
    transferAmount: transferMatch ? parseCurrencyToNumber(transferMatch[1]) : parseCurrencyToNumber(tokens[8]),
  };
}
