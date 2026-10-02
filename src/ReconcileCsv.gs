/**
 * 最終的に合っているべきなのは「お振込金額」そのもの。CSVの明細サマリー(type2)には、
 * その内訳(取扱金額・手数料・消費税額)も一緒に入っているので、
 *
 *   取扱金額 − 手数料(税抜) − 消費税額 = お振込金額
 *
 * という関係が実際に成立しているかを検証する。ここが崩れていたら、
 * 個々の顧客ID単位の消し込みがいくら一致していても、最終的な入金額の
 * 根拠を説明できていないことになる。
 * 副作用のない純粋関数。
 */
function verifyTransferAmount(summary) {
  var expectedTransferAmount = summary.grossAmount - summary.feeAmount - summary.taxAmount;
  var diff = summary.transferAmount - expectedTransferAmount;

  return {
    grossAmount: summary.grossAmount,
    feeAmount: summary.feeAmount,
    taxAmount: summary.taxAmount,
    expectedTransferAmount: expectedTransferAmount,
    actualTransferAmount: summary.transferAmount,
    diff: diff,
    isMatch: diff === 0,
  };
}

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
 * 返金(kind === 'refund')レコード自体は突合(入金確認OKの判定)には使わないが、
 * 同じ顧客・同じ金額の売上を相殺する目的では使う: 決済エラー等で一度売上計上され、
 * 同額がすぐ返金された(純額ゼロの)取引は、実際には入金されていないので
 * 「入金確認OK」と誤判定しないよう、売上プールから先に差し引く。
 * 差し引いた分は offsetByRefund として結果に残す(黙って消さない)。
 *
 * データに不備がある行(顧客IDが空)は、金額を見失わないよう
 * 突合対象から静かに弾くのではなく、別バケツ(rowsMissingCustomerId /
 * unidentifiedTransactions)として必ず結果に残す。
 *
 * alreadyMatchedRows (省略可、Setまたは配列) に渡した行は、シート側の
 * 突合対象から除外する。1回の実行で複数のCSVファイルを処理する際に、
 * 同じ「消し込み待ち」行が複数のファイルに対して二重に「入金確認OK」と
 * 判定されるのを防ぐために使う(呼び出し側で、1ファイル処理するごとに
 * matched行をこのSetへ積み増していく)。
 *
 * 副作用のない純粋関数(渡されたSetを書き換えることはない)。
 */
function reconcileWithCsv(sheetRows, transactions, config, alreadyMatchedRows) {
  var excluded = alreadyMatchedRows || [];
  var isExcluded = function (row) {
    if (excluded.has) return excluded.has(row); // Set
    return excluded.indexOf(row) !== -1; // Array
  };

  var pendingCandidates = sheetRows.filter(function (row) {
    return (
      row['ステータス'] === config.COMPLETED_STATUS &&
      row[config.CSV_EXPORTED_COLUMN] === config.CSV_EXPORTED_PENDING_VALUE &&
      !isExcluded(row)
    );
  });

  var pendingRows = pendingCandidates.filter(function (row) {
    return !!row['顧客ID'];
  });
  var rowsMissingCustomerId = pendingCandidates.filter(function (row) {
    return !row['顧客ID'];
  });

  var saleTransactions = transactions.filter(function (t) {
    return t.kind === 'sale' && t.customerId;
  });
  // 顧客IDが空の売上レコードのうち、金額が0円のものは「EMV 3-Dセキュア」認証費用のような
  // 技術的なレコード(SBPS側の仕様で顧客IDが元々付与されない)であり、実害のある
  // 取りこぼしではないため警告対象から除く。金額が0円でないのに顧客IDが空のものは、
  // 実際のお金の行方が追えなくなっている可能性があるため警告する。
  var unidentifiedTransactions = transactions.filter(function (t) {
    return t.kind === 'sale' && !t.customerId && t.amount !== 0;
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

  // 同じ顧客・同じ金額で返金が入っている分は、プールから差し引く。
  // 決済エラー等で一度売上計上され、すぐ同額返金されたケース(純額ゼロ)を
  // 「入金確認OK」と誤判定しないようにするため。差し引いた分は
  // offsetByRefund として結果に残す(黙って消さない)。
  var offsetByRefund = [];
  var refundCounts = {};
  refundTransactions.forEach(function (t) {
    if (!t.customerId) return;
    var key = t.customerId + '|' + Math.abs(t.amount);
    refundCounts[key] = (refundCounts[key] || 0) + 1;
  });
  Object.keys(refundCounts).forEach(function (key) {
    var bucket = pool[key];
    if (!bucket || bucket.length === 0) return;
    var offsetCount = Math.min(bucket.length, refundCounts[key]);
    offsetByRefund = offsetByRefund.concat(bucket.splice(0, offsetCount));
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
    offsetByRefund: offsetByRefund,
    rowsMissingCustomerId: rowsMissingCustomerId,
    unidentifiedTransactions: unidentifiedTransactions,
    refundTransactions: refundTransactions,
  };
}

/**
 * reconcileWithCsv() の結果を人が読むためのレポートに整形する。
 * 副作用のない純粋関数。
 */
function formatCsvReconcileReport(result, csvSummary) {
  var transferCheck = verifyTransferAmount(csvSummary);

  var lines = [];
  lines.push('=== 収納明細CSV 自動照合結果 ===');
  lines.push('会社名: ' + csvSummary.companyName + ' / サービス名: ' + csvSummary.serviceName);
  lines.push('集計期間: ' + csvSummary.periodFrom + ' ～ ' + csvSummary.periodTo);
  lines.push('');
  lines.push('--- お振込金額の整合性チェック(最終目標) ---');
  lines.push(
    '取扱金額 ' + formatYen(transferCheck.grossAmount) +
    ' − 手数料 ' + formatYen(transferCheck.feeAmount) +
    ' − 消費税額 ' + formatYen(transferCheck.taxAmount) +
    ' = ' + formatYen(transferCheck.expectedTransferAmount) + '(計算値)'
  );
  lines.push('実際のお振込金額: ' + formatYen(transferCheck.actualTransferAmount));
  lines.push(
    transferCheck.isMatch
      ? '→ 一致'
      : '→ ⚠ 不一致(差額 ' + formatYen(transferCheck.diff) + ')。CSVの読み取り内容を確認してください。'
  );
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

  if (result.offsetByRefund.length > 0) {
    var offsetTotal = result.offsetByRefund.reduce(function (sum, t) {
      return sum + t.amount;
    }, 0);
    lines.push(
      '--- 同額の返金で相殺され、入金なし(純額ゼロ)として扱った売上 (' + result.offsetByRefund.length +
      '件 / 合計 ' + formatYen(offsetTotal) + ') ---'
    );
    lines.push('決済エラー等で売上計上後すぐ返金された可能性があります。シート側で消し込み待ちのままなら要確認です。');
    result.offsetByRefund.forEach(function (t) {
      lines.push('  顧客ID:' + t.customerId + ' / 金額:' + formatYen(t.amount) + ' / 売上日:' + t.saleDate);
    });
    lines.push('');
  }

  if (result.rowsMissingCustomerId.length > 0) {
    lines.push(
      '--- ⚠ 顧客IDが空のため突合できなかったシート行 (' + result.rowsMissingCustomerId.length + '件) ---'
    );
    result.rowsMissingCustomerId.forEach(function (row) {
      lines.push(
        '  契約ID:' + row['契約ID'] + ' / 顧客名:' + row['顧客名'] + ' / 対象月:' + row['対象月'] +
        ' / 合計:' + formatYen(parseCurrencyToNumber(row['合計']))
      );
    });
    lines.push('');
  }

  if (result.unidentifiedTransactions.length > 0) {
    var unidentifiedTotal = result.unidentifiedTransactions.reduce(function (sum, t) {
      return sum + t.amount;
    }, 0);
    lines.push(
      '--- ⚠ 顧客IDが空のため突合できなかったCSV取引 (' + result.unidentifiedTransactions.length +
      '件 / 合計 ' + formatYen(unidentifiedTotal) + ') ---'
    );
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

  var isClean =
    transferCheck.isMatch &&
    result.unmatchedRows.length === 0 &&
    result.unmatchedTransactions.length === 0 &&
    result.rowsMissingCustomerId.length === 0 &&
    result.unidentifiedTransactions.length === 0;
  lines.push(isClean ? '差異なし' : '要確認の項目があります。上記をご確認ください。');
  return lines.join('\n');
}
