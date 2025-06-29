function dailyCheck() {
  const values = personalSettingSheet.getRange(2, 1, personalSettingSheet.getLastRow() - 1, 5).getValues();

  const data = values.map((row, index) => ({
    dueDate: row[0],            // A列: 本番の日付
    name: row[1],               // B列: 名前
    reminderMessage: row[2],    // C列: リマインドするメッセージ
    channel: row[3],            // D列: チャンネル
    threadLink: row[4],         // E列: スレッドリンク
    rowIndex: index + 2         // スプレッドシートの行番号（1-indexed + ヘッダー）
  })).filter(row => row.dueDate && row.name && row.reminderMessage);

  const today = new Date();

  // 期日とリマインダーでグループ化（同じ期日の人をまとめる）
  const reminderGroups = {};

  // 今日送るべきリマインダーを確認してグループ化
  for (const person of data) {
    const results = calculateReminderDate(person.dueDate, person.reminderMessage);
    
    for (const result of results) {
      if (isSameDate(result.date, today)) {
        const groupKey = `${person.dueDate.getTime()}_${person.reminderMessage}_${result.reminder.name}`;
        
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

  // 送信処理
  for (const group of Object.values(reminderGroups)) {
    const reminder = group.reminder;
    
    let message = reminder.message;
    
    // テンプレート変数を置換
    if (reminder.deadlineDetails) {
      message = message.replace('{DEADLINE}', reminder.deadlineDetails);
    }
    
    const finalMessage = `${reminder.mention}\n${message}`;
    
    // チャンネル決定：個人設定 > マスターのデフォルト > config.jsのdefault
    let targetChannelId = channelId; // デフォルト
    
    // 個人設定で指定されたチャンネルをチェック
    const personWithChannel = group.people.find(p => p.channel);
    if (personWithChannel && personWithChannel.channel) {
      const channelFromPersonSetting = getChannelIdByName(personWithChannel.channel);
      if (channelFromPersonSetting) {
        targetChannelId = channelFromPersonSetting;
      }
    }
    
    // マスターのデフォルトチャンネルをチェック
    if (!personWithChannel || !personWithChannel.channel) {
      if (reminder.defaultChannel) {
        const channelFromMaster = getChannelIdByName(reminder.defaultChannel);
        if (channelFromMaster) {
          targetChannelId = channelFromMaster;
        }
      }
    }
    
    // スレッド機能：遺伝志発信のみスレッド使用
    if (reminder.setName === '遺伝志発信') {
      // 期日ごとにスレッドを分ける
      const threadKey = `genetic_${group.dueDate.getTime()}`;
      let threadTs = getThreadTs(threadKey);
      
      const result = postMessage(finalMessage, threadTs, targetChannelId);
      
      // 初回投稿の場合、スレッドTSを保存してスレッドリンクを更新
      if (!threadTs && result) {
        threadTs = result;
        setThreadTs(threadKey, threadTs);
        
        // スレッドリンクを生成してスプレッドシートに記録
        const threadLink = `https://slack.com/archives/${targetChannelId}/p${threadTs.replace('.', '')}`;
        updateThreadLinks(reminder.peopleData, threadLink);
        
        console.log(`新しいスレッド開始：${threadKey} - ${threadTs}`);
      }
      
      console.log(`スレッドリマインダー送信（${targetChannelId}）：${threadKey}\n${finalMessage}`);
    } else {
      // その他は通常送信
      postMessage(finalMessage, null, targetChannelId);
      console.log(`通常リマインダー送信（${targetChannelId}）：\n${finalMessage}`);
    }
    
    Utilities.sleep(1000);
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