// メンバー情報（すべてのslackメンバーシートから）
const allMembers = memberMasterSheet.getRange(2, 1, memberMasterSheet.getLastRow() - 1, 5)
  .getValues()
  .map(row => ({ 
    id: row[0],           // A列: id
    name: row[1],         // B列: name 
    name_only: row[2],    // C列: name_only
    name_26only: row[4]   // E列: name_26only
  }))
  .filter(e => e.id);

function getIdByName(name) {
  // name_only列で検索してIDを取得
  const member = allMembers.find(e => e.name_only === name);
  return member ? member.id : null;
}

// リマインダー情報（リマインド文マスターシートから）
const allReminders = reminderMasterSheet.getRange(2, 1, reminderMasterSheet.getLastRow() - 1, 5)
  .getValues()
  .map(row => ({
    setName: row[0],         // A列: セット名
    name: row[1],            // B列: リマインダー名
    timing: row[2],          // C列: タイミング
    message: row[3],         // D列: 文章
    defaultChannel: row[4],  // E列: デフォルトチャンネル
    mention: ''              // 送信時に使用
  }));

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

// タイミング文字列から日数を抽出する関数
function parseTimingToDays(timing) {
  const match = timing.match(/(\d+)日前/);
  return match ? parseInt(match[1]) : 0;
}

// リマインダー種類から対象リマインダーを取得
function getRemindersByType(reminderType) {
  // セット名の場合：そのセットに属する全てのリマインダーを返す
  const setReminders = allReminders.filter(r => r.setName === reminderType);
  if (setReminders.length > 0) {
    return setReminders;
  }
  
  // 個別リマインダー名の場合：そのリマインダーのみ返す
  const individualReminder = allReminders.find(r => r.name === reminderType);
  return individualReminder ? [individualReminder] : [];
}

function calculateReminderDate(submissionDate, reminderType) {
  const targetReminders = getRemindersByType(reminderType);
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