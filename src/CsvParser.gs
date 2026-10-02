/**
 * SBペイメントサービスの収納明細CSVをGoogle Driveから読み込む。
 * GAS専用のI/O関数。
 */
function readCsvFileText(fileId) {
  var file = DriveApp.getFileById(fileId);
  return file.getBlob().getDataAsString('UTF-8');
}

/**
 * RFC4180相当のCSVテキストを2次元配列に変換する。
 * ダブルクォートで囲まれたフィールド・カンマを含むフィールド・
 * エスケープされたクォート("")・CRLF/LF混在・先頭のBOMに対応する。
 * 副作用のない純粋関数。
 */
function parseCsvText(text) {
  var content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  var rows = [];
  var row = [];
  var field = '';
  var inQuotes = false;

  for (var i = 0; i < content.length; i++) {
    var ch = content[i];

    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // 次の \n はループの次周回で無視する
      continue;
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter(function (r) {
    return !(r.length === 1 && r[0] === '');
  });
}

/**
 * type5(取引明細)の「売上返金区分名称」を突合で使う種別に正規化する。
 * 「与信」「与信取消」はカードのオーソリ保留(実際の入金額は常に0円)であり、
 * 実際の入金と突き合わせる対象ではないため 'authorization' として区別し、
 * 突合処理(売上/返金のみを見る)から自然に除外する。
 * 副作用のない純粋関数。
 */
function classifyTransactionKind(label) {
  if (label === '返金') return 'refund';
  if (label === '与信' || label === '与信取消') return 'authorization';
  return 'sale';
}

/**
 * SBPS収納明細CSVの各行は先頭列が「レコード種別」(1,2,3,4,5,8,9)になっている。
 *   1: ファイルヘッダー
 *   2: 明細サマリー(集計期間・振込金額など) ヘッダー行+データ行
 *   3: 決済手段別集計 ヘッダー行+データ行(複数)
 *   4: 手数料内訳 ヘッダー行+データ行(複数)
 *   5: 取引明細(1件ずつの売上/返金) ヘッダー行+データ行(複数)
 *   8/9: フッター
 * ここでは突合に必要な type 2 (サマリー) と type 5 (取引明細) のみを解析する。
 * 副作用のない純粋関数。
 */
function parseSbpsStatementCsv(text) {
  var rows = parseCsvText(text);

  var summary = null;
  var transactions = [];

  var type5Header = null;

  rows.forEach(function (row) {
    var recordType = row[0];

    if (recordType === '2') {
      if (row[1] === '収納明細ID') return; // ヘッダー行はスキップ
      summary = {
        statementId: row[1],
        merchantId: row[2],
        serviceId: row[3],
        companyName: row[4],
        serviceName: row[5],
        grossAmount: parseCurrencyToNumber(row[6]),
        feeAmount: parseCurrencyToNumber(row[7]),
        taxAmount: parseCurrencyToNumber(row[8]),
        transferAmount: parseCurrencyToNumber(row[9]),
        paymentDate: row[10],
        periodFrom: row[11],
        periodTo: row[12],
      };
      return;
    }

    if (recordType === '5') {
      if (row[1] === '収納明細ID') {
        type5Header = row;
        return;
      }
      if (!type5Header) return;

      var idx = {};
      type5Header.forEach(function (name, i) {
        idx[name] = i;
      });

      transactions.push({
        customerId: row[idx['顧客ID']],
        amount: parseCurrencyToNumber(row[idx['決済金額']]),
        saleDate: row[idx['売上日']],
        kind: classifyTransactionKind(row[idx['売上返金区分名称']]),
        settlementCategory: row[idx['決済手段名称']],
      });
    }
  });

  if (!summary) {
    throw new Error('CSVから明細サマリー(レコード種別2)が見つかりませんでした');
  }

  return { summary: summary, transactions: transactions };
}
