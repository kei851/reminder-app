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

// テスト用関数
function testReminder() {
  console.log('テスト実行開始');
  dailyCheck();
  console.log('テスト実行完了');
}

// トリガー設定
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => ScriptApp.deleteTrigger(trigger));
  
  ScriptApp.newTrigger('dailyCheck')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
    
  console.log('トリガー設定完了：毎日9時に実行');
}