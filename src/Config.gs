/**
 * 環境ごとに調整する設定値。
 * デプロイ先のスプレッドシート/Driveフォルダ構成に合わせて書き換えること。
 */
var CONFIG = {
  // 収納明細書(PDF)を格納しているGoogle DriveフォルダのID
  PDF_FOLDER_ID: 'PUT_YOUR_DRIVE_FOLDER_ID_HERE',

  // 突合対象のシート(タブ)名。
  // 「対象月」「ステータス」「合計」の列を持つ契約単位の台帳シートを指定する。
  // 名前で見つからない場合は、上記3列を持つシートを自動探索する。
  TARGET_SHEET_NAME: '契約一覧',

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
