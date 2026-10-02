/**
 * 環境ごとに調整する設定値。
 * デプロイ先のスプレッドシート/Driveフォルダ構成に合わせて書き換えること。
 */
var CONFIG = {
  // 収納明細書(PDF)を格納しているGoogle DriveフォルダのID
  PDF_FOLDER_ID: 'PUT_YOUR_DRIVE_FOLDER_ID_HERE',

  // 突合対象のシート(タブ)名を固定したい場合のみ設定する(通常は空のままでよい)。
  // 実際の運用では月ごとに別タブ(例: "2608" = 対象月2026年08月分)に分かれており、
  // CSV版はCSVの集計期間から対象タブ名(例: "2608")を自動で推測する
  // (expectedSheetNameForPeriod / findCsvTargetSheet)。
  // PDF版(レガシー)や、タブ名の命名規則が異なる場合はここで明示的に指定する。
  TARGET_SHEET_NAME: '',

  // 突合対象シート上で「決済完了」とみなすステータス文字列
  COMPLETED_STATUS: '決済完了',

  // 収納明細書(CSV)を格納しているGoogle DriveフォルダのID
  // (PDF_FOLDER_IDと同じフォルダでも構わない)
  CSV_FOLDER_ID: 'PUT_YOUR_DRIVE_FOLDER_ID_HERE',

  // CSV突合の消し込み状況を表す列名と、各状態を表す文字列。
  // 標準のタブ形式(例: 2609)にはこの列が無いため、列が存在しないタブでは
  // 無視され、ステータスだけで対象行を判定する。一部のタブ(例: 2608)に
  // この列がある場合は、「済」の行を突合対象から除外するために使われる。
  CSV_EXPORTED_COLUMN: 'CSV出力済み',
  CSV_EXPORTED_PENDING_VALUE: '未',
  CSV_EXPORTED_DONE_VALUE: '済',

  // 自社のテスト用アカウントなど、売上管理シートに意図的に載せていない顧客IDの一覧。
  // ここに含まれる顧客IDのCSV取引は、突合結果の「要確認」扱いにはせず、
  // 参考情報(excludedTransactions)として別枠で表示する。
  // 例: 'C6A55B54B023A1' は自社テストアカウントであることを確認済み(2026年08月分で確認)。
  EXCLUDED_CUSTOMER_IDS: ['C6A55B54B023A1'],
};
