/**
 * シートの「消し込み待ち」契約行(ステータス=決済完了 かつ CSV出力済み=未)を、
 * CSVの取引明細(売上レコード)と「顧客ID + 金額」で突き合わせる。
 *
 * 考え方:
 *  - シート側: まだ入金確認できていない契約の一覧(予定表)
 *  - CSV側  : 実際に入金された取引の一覧(領収書)
 *  - 同じ(顧客ID, 金額)の組が両方にあれば「入金確認OK」とみなし、1件ずつ消費する
 *    (同じ顧客・同じ金額の行が複数ある場合でも、件数ベースで正しく対応づく)
 *
 * 返金(kind === 'refund')レコードは今回は突合に使わず、参考情報としてのみ返す。
 * 副作用のない純粋関数。
 */
function reconcileWithCsv(sheetRows, transactions, config) {
  var pendingRows = sheetRows.filter(function (row) {
    return (
      row['ステータス'] === config.COMPLETED_STATUS &&
      row[config.CSV_EXPORTED_COLUMN] === config.CSV_EXPORTED_PENDING_VALUE &&
      row['顧客ID']
    );
  });

  var saleTransactions = transactions.filter(function (t) {
    return t.kind === 'sale' && t.customerId;
  });
  var refundTransactions = transactions.filter(function (t) {
    return t.kind === 'refund';
  });

  // 顧客ID+金額ごとに、消費可能なCSV売上レコードをプールしておく
  var pool = {};
  saleTransactions.forEach(function (t) {
    var key = t.customerId + '|' + t.amount;
    if (!pool[key]) pool[key] = [];
    pool[key].push(t);
  });

  var matched = [];
  var unmatchedRows = [];

  pendingRows.forEach(function (row) {
    var key = row['顧客ID'] + '|' + parseCurrencyToNumber(row['合計']);
    var bucket = pool[key];
    if (bucket && bucket.length > 0) {
      matched.push({ row: row, transaction: bucket.shift() });
    } else {
      unmatchedRows.push(row);
    }
  });

  // プールに残っている分 = シート側に対応する「消し込み待ち」行が見つからなかったCSV取引
  var unmatchedTransactions = [];
  Object.keys(pool).forEach(function (key) {
    pool[key].forEach(function (t) {
      unmatchedTransactions.push(t);
    });
  });

  return {
    pendingRowCount: pendingRows.length,
    matched: matched,
    unmatchedRows: unmatchedRows,
    unmatchedTransactions: unmatchedTransactions,
    refundTransactions: refundTransactions,
  };
}

/**
 * reconcileWithCsv() の結果を人が読むためのレポートに整形する。
 * 副作用のない純粋関数。
 */
function formatCsvReconcileReport(result, csvSummary) {
  var lines = [];
  lines.push('=== 収納明細CSV 自動照合結果 ===');
  lines.push('会社名: ' + csvSummary.companyName + ' / サービス名: ' + csvSummary.serviceName);
  lines.push('集計期間: ' + csvSummary.periodFrom + ' ～ ' + csvSummary.periodTo);
  lines.push('お振込金額: ' + formatYen(csvSummary.transferAmount));
  lines.push('');
  lines.push('消し込み待ち契約行(CSV出力済み=未・決済完了): ' + result.pendingRowCount + '件');
  lines.push('入金確認OK: ' + result.matched.length + '件');
  lines.push('');

  if (result.unmatchedRows.length > 0) {
    lines.push('--- シートにはあるが、CSVに対応する入金が見つからなかった行 (' + result.unmatchedRows.length + '件) ---');
    result.unmatchedRows.forEach(function (row) {
      lines.push(
        '  顧客ID:' + row['顧客ID'] + ' / 顧客名:' + row['顧客名'] + ' / 対象月:' + row['対象月'] +
        ' / 合計:' + formatYen(parseCurrencyToNumber(row['合計']))
      );
    });
    lines.push('');
  } else {
    lines.push('シート側の未消込み行はすべてCSVと一致しました。');
    lines.push('');
  }

  if (result.unmatchedTransactions.length > 0) {
    lines.push('--- CSVにはあるが、シートに対応する消し込み待ち行が見つからなかった取引 (' + result.unmatchedTransactions.length + '件) ---');
    result.unmatchedTransactions.forEach(function (t) {
      lines.push('  顧客ID:' + t.customerId + ' / 金額:' + formatYen(t.amount) + ' / 売上日:' + t.saleDate);
    });
    lines.push('');
  }

  if (result.refundTransactions.length > 0) {
    var refundTotal = result.refundTransactions.reduce(function (sum, t) {
      return sum + t.amount;
    }, 0);
    lines.push(
      '(参考) 返金取引: ' + result.refundTransactions.length + '件 / 合計 ' + formatYen(refundTotal) +
      ' ※今回は突合対象外'
    );
    lines.push('');
  }

  var isClean = result.unmatchedRows.length === 0 && result.unmatchedTransactions.length === 0;
  lines.push(isClean ? '差異なし' : '要確認の項目があります。上記をご確認ください。');
  return lines.join('\n');
}
