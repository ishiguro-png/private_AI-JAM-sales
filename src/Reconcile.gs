/**
 * 収納明細書側の集計値(pdfSummary)とシート側の集計値(sheetSummary)を比較する。
 * 比較対象は「決済処理金額(合計)」= 売上金額 - 返金金額 の純額で、
 * カード決済で実際に処理された金額(税込)を表す。
 * 副作用のない純粋関数。
 */
function reconcile(pdfSummary, sheetSummary) {
  var countDiff = sheetSummary.count - pdfSummary.settledCount;
  var amountDiff = sheetSummary.totalAmount - pdfSummary.settledAmount;
  var isMatch = countDiff === 0 && amountDiff === 0;

  return {
    isMatch: isMatch,
    pdf: { count: pdfSummary.settledCount, amount: pdfSummary.settledAmount },
    sheet: { count: sheetSummary.count, amount: sheetSummary.totalAmount },
    countDiff: countDiff,
    amountDiff: amountDiff,
  };
}

/**
 * 人が読むための照合結果レポートを組み立てる。副作用のない純粋関数。
 */
function formatReconcileReport(result, targetMonthLabel, pdfSummary) {
  var lines = [];
  lines.push('=== 収納明細書 自動照合結果 ===');
  lines.push('対象月: ' + targetMonthLabel);
  lines.push('集計期間: ' + formatDateYmd(pdfSummary.periodStart) + ' ～ ' + formatDateYmd(pdfSummary.periodEnd));
  lines.push('');
  lines.push('[収納明細書] 決済処理件数: ' + result.pdf.count + '件 / 金額: ' + formatYen(result.pdf.amount));
  lines.push('[売上管理シート] 完了件数: ' + result.sheet.count + '件 / 金額: ' + formatYen(result.sheet.amount));
  lines.push('');
  lines.push('件数差異: ' + result.countDiff + '件');
  lines.push('金額差異: ' + formatYen(result.amountDiff));
  lines.push('');
  lines.push(result.isMatch ? '一致しました' : '差異があります。内容をご確認ください。');
  return lines.join('\n');
}
