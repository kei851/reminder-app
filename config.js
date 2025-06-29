const token = '----';  // Slack Bot Token
const channelId = '----';  // デフォルトチャンネル

/**
 * 以下、変更しない（使いまわす定数の定義）
 */
const spreadSheet = SpreadsheetApp.getActiveSpreadsheet();
const personalSettingSheet = spreadSheet.getSheetById(142041053);  // リマインダー設定
const memberMasterSheet = spreadSheet.getSheetById(0);  // すべてのslackメンバータブ
const reminderMasterSheet = spreadSheet.getSheetById(1622874664);  // リマインド文マスター