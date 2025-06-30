// メンバー情報（すべてのslackメンバーシートから）
const allMembers = memberMasterSheet.getRange(2, 1, memberMasterSheet.getLastRow() - 1, 5)
  .getValues()
  .map(row => ({ 
    id: row[0],           // A列: id
    name: row[1],         // B列: name 
    name_only: row[2],    // C列: name_only
    flag: row[3],         // D列: flag
    name_26only: row[4]   // E列: name_26only
  }))
  .filter(e => e.id);

function getIdByName(name) {
  // name_only列で検索してIDを取得
  const member = allMembers.find(e => e.name_only === name);
  return member ? member.id : null;
}

// チャンネル情報（全てのチャンネルシートから）
const allChannels = channelMasterSheet.getRange(2, 1, channelMasterSheet.getLastRow() - 1, 2)
  .getValues()
  .map(row => ({
    id: row[0],           // A列: id  
    name: row[1]          // B列: name
  }))
  .filter(e => e.id);

function getChannelIdByName(channelName) {
  // name列で検索してIDを取得
  const channel = allChannels.find(e => e.name === channelName);
  return channel ? channel.id : null;
}

// リマインダー情報（リマインド文マスターシートから）
const allReminders = reminderMasterSheet.getRange(2, 1, reminderMasterSheet.getLastRow() - 1, 6)
  .getValues()
  .map(row => ({
    name: row[0] ? String(row[0]).trim() : '',           // A列: リマインダー名
    setName: row[1] ? String(row[1]).trim() : '',        // B列: セット名
    timing: row[2],                                      // C列: タイミング（数値または文字列）
    message: row[3] ? String(row[3]).trim() : '',        // D列: 文章
    defaultChannel: row[4] ? String(row[4]).trim() : '', // E列: デフォルトチャンネル
    sendTime: row[5] || 9,                               // F列: 送信時間（デフォルト9時）
    mention: ''                                          // 送信時に使用
  }))
  .filter(reminder => reminder.name && (reminder.timing || reminder.timing === 0)); // 必須フィールドがあるもののみ

// 期日詳細を計算する関数
function formatDeadlineDetails(submissionDate, daysBefore) {
  const deadline = new Date(submissionDate);
  deadline.setDate(deadline.getDate() - daysBefore);
  
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // 明日が期日の場合
  if (isSameDate(deadline, tomorrow)) {
    const deadlineStr = Utilities.formatDate(deadline, Session.getScriptTimeZone(), 'M月d日');
    return `明日（${deadlineStr}）の24時まで`;
  }
  
  // その他の場合
  const deadlineStr = Utilities.formatDate(deadline, Session.getScriptTimeZone(), 'M月d日');
  const diffDays = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return `今日（${deadlineStr}）の24時まで`;
  } else if (diffDays > 0) {
    return `${diffDays}日後（${deadlineStr}）の24時まで`;
  } else {
    return `${deadlineStr}`;
  }
}

// タイミングから日数を抽出する関数
function parseTimingToDays(timing) {
  // 数値の場合はそのまま返す
  if (typeof timing === 'number') {
    return timing;
  }
  
  // 文字列の場合は「◯日前」形式から数値を抽出
  if (typeof timing === 'string') {
    const match = timing.match(/(\d+)日前/);
    return match ? parseInt(match[1]) : 0;
  }
  
  // その他の場合
  console.warn(`無効なタイミング値: ${timing} (型: ${typeof timing})`);
  return 0;
}

// リマインダー名から対象リマインダーを取得
function getRemindersByName(reminderName) {
  console.log(`getRemindersByName呼び出し: "${reminderName}"`);
  
  // 完全一致で検索
  let reminder = allReminders.find(r => r.name === reminderName);
  if (reminder) {
    console.log(`完全一致で見つかりました: "${reminder.name}"`);
    return [reminder];
  }
  
  // 「テスト（0日前）」→「テスト」のように括弧内を除いて検索
  const baseReminderName = reminderName.replace(/\s*\([^)]*\)\s*$/, '');
  if (baseReminderName !== reminderName) {
    console.log(`括弧を除いて再検索: "${baseReminderName}"`);
    reminder = allReminders.find(r => r.name === baseReminderName);
    if (reminder) {
      console.log(`括弧なしで見つかりました: "${reminder.name}"`);
      return [reminder];
    }
  }
  
  console.log(`リマインダーが見つかりませんでした。利用可能なリマインダー:`);
  allReminders.forEach(r => console.log(`  - "${r.name}"`));
  
  return [];
}

function calculateReminderDate(submissionDate, reminderName) {
  const targetReminders = getRemindersByName(reminderName);
  const results = [];
  
  targetReminders.forEach(reminder => {
    const daysBefore = parseTimingToDays(reminder.timing);
    const date = new Date(submissionDate);
    date.setDate(date.getDate() - daysBefore);
    
    results.push({ 
      date, 
      reminder: {
        ...reminder,
        daysBefore: daysBefore
      }
    });
  });
  
  return results;
}

function isSameDate(date1, date2) {
  return date1.getFullYear() === date2.getFullYear() && 
         date1.getMonth() === date2.getMonth() && 
         date1.getDate() === date2.getDate();
}

// デバッグ用：リマインダーデータの確認
function debugReminders() {
  console.log('=== リマインダーデータ確認 ===');
  allReminders.forEach((reminder, index) => {
    console.log(`${index + 1}. ${reminder.name} | タイミング: "${reminder.timing}" (型: ${typeof reminder.timing})`);
  });
  console.log('=========================');
}