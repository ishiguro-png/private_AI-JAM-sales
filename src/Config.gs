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

  // CSV突合の消し込み状況を表す列名と、各状態を表す文字列
  CSV_EXPORTED_COLUMN: 'CSV出力済み',
  CSV_EXPORTED_PENDING_VALUE: '未',
  CSV_EXPORTED_DONE_VALUE: '済',
};
