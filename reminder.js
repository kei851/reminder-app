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
const personalSettingSheet = spreadSheet.getSheetByName('personal_settings');
const memberMasterSheet = spreadSheet.getSheetByName('member_master'); 
const reminderMasterSheet = spreadSheet.getSheetByName('reminder_master');

// ================================
// データ読み込み
// ================================

// メンバー情報
const allMembers = memberMasterSheet.getRange(2, 1, memberMasterSheet.getLastRow() - 1, 3)
  .getValues()
  .map(row => ({ id: row[0], name: row[2] }))
  .filter(e => e.id);

function getIdByName(name) {
  const member = allMembers.find(e => e.name === name);
  return member ? member.id : null;
}

// リマインダー情報
const allReminders = reminderMasterSheet.getRange(2, 1, reminderMasterSheet.getLastRow() - 1, 5)
  .getValues()
  .map(row => ({
    name: row[0], 
    daysBefore: row[1], 
    message: row[2],
    useThread: row[3] || false,      // スレッド使用フラグ
    threadGroup: row[4] || 'default', // スレッドグループ
    mention: ''
  }));

function calculateReminderDate(submissionDate, name) {
  const targetReminder = allReminders.find(e => e.name === name);
  if (!targetReminder) return null;
  
  const date = new Date(submissionDate);
  date.setDate(date.getDate() - targetReminder.daysBefore);
  return { date, reminder: targetReminder };
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

function postMessage(message, threadTs = null) {
  const url = "https://slack.com/api/chat.postMessage";
  
  const payload = {
    "token": token,
    "channel": channelId,
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

// ================================
// メイン処理
// ================================

function dailyCheck() {
  const values = personalSettingSheet.getRange(2, 1, personalSettingSheet.getLastRow() - 1, personalSettingSheet.getLastColumn()).getValues();

  const data = values.map(row => ({
    submissionDate: row[0],
    name: row[1],
    reminders: row.slice(2).filter(e => e),
  }));

  const today = new Date();

  // 今日送るべきリマインダーを確認
  for (const person of data) {
    for (const reminderName of person.reminders) {
      const result = calculateReminderDate(person.submissionDate, reminderName);
      if (result && isSameDate(result.date, today)) {
        result.reminder.mention += `<@${getIdByName(person.name)}> `;
      }
    }
  }

  // スレッド別にリマインダーを分類
  const threadReminders = {};
  const normalReminders = [];
  
  for (const reminder of allReminders) {
    if (reminder.mention) {
      if (reminder.useThread) {
        const group = reminder.threadGroup;
        if (!threadReminders[group]) {
          threadReminders[group] = [];
        }
        threadReminders[group].push(reminder);
      } else {
        normalReminders.push(reminder);
      }
    }
  }

  // 通常のリマインダー送信
  for (const reminder of normalReminders) {
    const message = `${reminder.mention}\n${reminder.message}`;
    postMessage(message);
    console.log(`通常リマインダー送信：\n${message}`);
    Utilities.sleep(1000);
  }

  // スレッドリマインダー送信
  for (const [threadGroup, reminders] of Object.entries(threadReminders)) {
    let threadTs = getThreadTs(threadGroup);
    
    for (const reminder of reminders) {
      const message = `${reminder.mention}\n${reminder.message}`;
      
      const resultTs = postMessage(message, threadTs);
      
      // 初回投稿の場合、スレッドTSを保存
      if (!threadTs && resultTs) {
        threadTs = resultTs;
        setThreadTs(threadGroup, threadTs);
        console.log(`新しいスレッド開始：${threadGroup} - ${threadTs}`);
      }
      
      console.log(`スレッドリマインダー送信：${threadGroup}\n${message}`);
      Utilities.sleep(1000);
    }
  }
}

// ================================
// セットアップ用関数
// ================================

function setupPitchReminders() {
  const sheet = reminderMasterSheet;
  
  const pitchReminders = [
    ['スライド初稿', 21, '📝 スライド初稿の提出をお願いします。\n締切：今日\nフォーマット：パワーポイント', true, 'pitch'],
    ['発表者FB', 14, '📋 発表者同士でのフィードバックをお願いします。\n期間：今日から1週間', true, 'pitch'],
    ['人事FB', 7, '💼 人事の方からのフィードバックをお願いします。\n@hr-team よろしくお願いします！', true, 'pitch'],
    ['最終確認', 1, '⚡ 明日がPitch会です！最終確認をお願いします。\n時間：13:00-14:00\n会場：会議室A', true, 'pitch']
  ];
  
  pitchReminders.forEach(reminder => sheet.appendRow(reminder));
  console.log('Pitch会用リマインダーを設定しました');
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