/**
 * リマインダーシステム
 * 
 * 機能：
 * - 人ごとの柔軟なリマインド設定
 * - Slackスレッド対応
 * - Pitch会などのイベント管理
 */

// ================================
// 設定
// ================================
const token = '----';  // Slack Bot Token
const channelId = '----';  // デフォルトチャンネル

const spreadSheet = SpreadsheetApp.getActiveSpreadsheet();
const personalSettingSheet = spreadSheet.getSheetByName('リマインダー設定');
const memberMasterSheet = spreadSheet.getSheetById(0);  // すべてのslackメンバータブ
const reminderMasterSheet = spreadSheet.getSheetByName('リマインド文マスター');

// ================================
// データ読み込み
// ================================

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

// ================================
// スレッド管理
// ================================

function getThreadTs(threadGroup) {
  return PropertiesService.getScriptProperties().getProperty(`thread_${threadGroup}`);
}

function setThreadTs(threadGroup, threadTs) {
  PropertiesService.getScriptProperties().setProperty(`thread_${threadGroup}`, threadTs);
}

// ================================
// メッセージ送信
// ================================

function postMessage(message, threadTs = null, channel = null) {
  const url = "https://slack.com/api/chat.postMessage";
  
  const payload = {
    "token": token,
    "channel": channel || channelId,
    "text": message
  };
  
  if (threadTs) {
    payload.thread_ts = threadTs;
  }
  
  const params = {
    "method": "post",
    "payload": payload
  };
  
  const response = UrlFetchApp.fetch(url, params);
  const result = JSON.parse(response.getContentText());
  
  return result.ok ? result.ts : null;
}

// スレッドリンクをスプレッドシートに記録
function updateThreadLinks(peopleData, threadLink) {
  peopleData.forEach(person => {
    personalSettingSheet.getRange(person.rowIndex, 4).setValue(threadLink);
  });
}

// ================================
// メイン処理
// ================================

function dailyCheck() {
  const values = personalSettingSheet.getRange(2, 1, personalSettingSheet.getLastRow() - 1, 4).getValues();

  const data = values.map((row, index) => ({
    dueDate: row[0],        // A列: 期日
    name: row[1],           // B列: 人の名前
    reminderType: row[2],   // C列: リマインダー種類
    threadLink: row[3],     // D列: スレッドリンク
    rowIndex: index + 2     // スプレッドシートの行番号（1-indexed + ヘッダー）
  })).filter(row => row.dueDate && row.name && row.reminderType);

  const today = new Date();

  // 期日とリマインダー種類でグループ化（同じ期日の人をまとめる）
  const reminderGroups = {};

  // 今日送るべきリマインダーを確認してグループ化
  for (const person of data) {
    const results = calculateReminderDate(person.dueDate, person.reminderType);
    
    for (const result of results) {
      if (isSameDate(result.date, today)) {
        const groupKey = `${person.dueDate.getTime()}_${person.reminderType}_${result.reminder.name}`;
        
        if (!reminderGroups[groupKey]) {
          reminderGroups[groupKey] = {
            reminder: result.reminder,
            people: [],
            dueDate: person.dueDate
          };
        }
        
        reminderGroups[groupKey].people.push(person);
        
        // 期日詳細情報を追加
        reminderGroups[groupKey].reminder.deadlineDetails = formatDeadlineDetails(person.dueDate, result.reminder.daysBefore);
      }
    }
  }

  // グループごとにメンションを設定
  for (const group of Object.values(reminderGroups)) {
    group.reminder.mention = group.people.map(person => `<@${getIdByName(person.name)}>`).join(' ') + ' ';
    group.reminder.peopleData = group.people; // スレッドリンク更新用
  }

  // スレッド別にリマインダーを分類（グループ化したリマインダーを使用）
  const threadReminders = {};
  const normalReminders = [];
  
  for (const group of Object.values(reminderGroups)) {
    const reminder = group.reminder;
    
    // Pitch会セットの場合はスレッド使用
    if (reminder.setName === 'Pitch会') {
      // 期日ごとにスレッドを分ける
      const threadKey = `pitch_${group.dueDate.getTime()}`;
      if (!threadReminders[threadKey]) {
        threadReminders[threadKey] = [];
      }
      threadReminders[threadKey].push(reminder);
    } else {
      // その他は通常送信
      normalReminders.push(reminder);
    }
  }

  // 通常のリマインダー送信
  for (const reminder of normalReminders) {
    let message = reminder.message;
    
    // テンプレート変数を置換
    if (reminder.deadlineDetails) {
      message = message.replace('{DEADLINE}', reminder.deadlineDetails);
    }
    
    const finalMessage = `${reminder.mention}\n${message}`;
    const channel = reminder.defaultChannel || channelId;
    postMessage(finalMessage, null, channel);
    console.log(`通常リマインダー送信（${channel}）：\n${finalMessage}`);
    Utilities.sleep(1000);
  }

  // スレッドリマインダー送信
  for (const [threadGroup, reminders] of Object.entries(threadReminders)) {
    let threadTs = getThreadTs(threadGroup);
    
    for (const reminder of reminders) {
      let message = reminder.message;
      
      // テンプレート変数を置換
      if (reminder.deadlineDetails) {
        message = message.replace('{DEADLINE}', reminder.deadlineDetails);
      }
      
      const finalMessage = `${reminder.mention}\n${message}`;
      const channel = reminder.defaultChannel || channelId;
      
      const result = postMessage(finalMessage, threadTs, channel);
      
      // 初回投稿の場合、スレッドTSを保存してスレッドリンクを更新
      if (!threadTs && result) {
        threadTs = result;
        setThreadTs(threadGroup, threadTs);
        
        // スレッドリンクを生成してスプレッドシートに記録
        const threadLink = `https://slack.com/archives/${channel.replace('#', '')}/p${threadTs.replace('.', '')}`;
        updateThreadLinks(reminder.peopleData, threadLink);
        
        console.log(`新しいスレッド開始：${threadGroup} - ${threadTs}`);
      }
      
      console.log(`スレッドリマインダー送信（${channel}）：${threadGroup}\n${finalMessage}`);
      Utilities.sleep(1000);
    }
  }
}

// ================================
// セットアップ用関数
// ================================

function setupPitchReminders() {
  const sheet = reminderMasterSheet;
  
  // Pitch会用リマインダーの基本設定（5列構造に対応）
  const pitchReminders = [
    ['Pitch会', 'Pitch会 (22日前)', '22日前', '明日までに初期資料を提出してください。{DEADLINE}', '#pitch-general'],
    ['Pitch会', 'Pitch会 (14日前)', '14日前', '上司に最終レビューを依頼しましょう！{DEADLINE}', '#pitch-general'],
    ['Pitch会', 'Pitch会 (7日前)', '7日前', 'HRの方のレビュー、FBを受けてスライドの修正、発表練習をやりましょう！{DEADLINE}', '#pitch-general'],
    ['Pitch会', 'Pitch会 (2日前)', '2日前', 'スライドの最終確認と、発表練習をやりましょう！{DEADLINE}', '#pitch-general']
  ];
  
  pitchReminders.forEach(reminder => sheet.appendRow(reminder));
  console.log('Pitch会用リマインダーを設定しました（デフォルトチャンネル含む）');
}

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => ScriptApp.deleteTrigger(trigger));
  
  ScriptApp.newTrigger('dailyCheck')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
    
  console.log('トリガー設定完了：毎日9時に実行');
}

function testReminder() {
  console.log('テスト実行開始');
  dailyCheck();
  console.log('テスト実行完了');
}