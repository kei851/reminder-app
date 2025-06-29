function hourlyCheck() {
  const values = personalSettingSheet.getRange(2, 1, personalSettingSheet.getLastRow() - 1, 6).getValues();

  const data = values.map((row, index) => ({
    dueDate: row[0],            // A列: 本番の日付
    name: row[1],               // B列: 名前
    reminderMessage: row[2],    // C列: リマインドするメッセージ
    channel: row[3],            // D列: チャンネル
    threadLink: row[4],         // E列: スレッドリンク
    sendTime: row[5],           // F列: 送信時間
    rowIndex: index + 2         // スプレッドシートの行番号（1-indexed + ヘッダー）
  })).filter(row => row.dueDate && row.name && row.reminderMessage);

  const now = new Date();
  const today = new Date();
  const currentHour = now.getHours();

  // 期日とリマインダーでグループ化（同じ期日の人をまとめる）
  const reminderGroups = {};

  // 今日送るべきリマインダーを確認してグループ化
  for (const person of data) {
    const results = calculateReminderDate(person.dueDate, person.reminderMessage);
    
    for (const result of results) {
      // 送信時間を決定（個人設定 > マスターのデフォルト）
      const effectiveSendTime = person.sendTime !== null && person.sendTime !== undefined 
        ? person.sendTime 
        : result.reminder.sendTime;
      
      // 今日が送信日で、かつ現在の時間が送信時間と一致する場合のみ処理
      if (isSameDate(result.date, today) && effectiveSendTime === currentHour) {
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
    
    // スレッド機能：既存のスレッドリンクがある場合はスレッドに返信
    const existingThreadLinks = group.people.map(p => p.threadLink).filter(link => link);
    
    if (existingThreadLinks.length > 0) {
      // 既存のスレッドリンクからthread_tsを抽出
      const threadLink = existingThreadLinks[0]; // 最初に見つかったスレッドリンクを使用
      let threadTs = null;
      
      // スレッドリンクからthread_tsを抽出 (例: https://slack.com/archives/C123/p1234567890123456 → 1234567890.123456)
      const match = threadLink.match(/\/p(\d+)$/);
      if (match) {
        const pValue = match[1];
        threadTs = pValue.slice(0, 10) + '.' + pValue.slice(10);
      }
      
      const result = postMessage(finalMessage, threadTs, targetChannelId);
      console.log(`スレッドリマインダー送信（${targetChannelId}）：既存スレッド\n${finalMessage}`);
      
    } else {
      // スレッドリンクがない場合：新規投稿
      const result = postMessage(finalMessage, null, targetChannelId);
      
      // セット名が指定されている場合、新しいスレッドとして管理
      if (reminder.setName && result) {
        const threadKey = `${reminder.setName}_${group.dueDate.getTime()}`;
        setThreadTs(threadKey, result);
        
        // スレッドリンクを生成してスプレッドシートに記録
        const threadLink = `https://slack.com/archives/${targetChannelId}/p${result.replace('.', '')}`;
        updateThreadLinks(reminder.peopleData, threadLink);
        
        console.log(`新しいスレッド開始：${threadKey} - ${result}`);
      }
      
      console.log(`通常リマインダー送信（${targetChannelId}）：\n${finalMessage}`);
    }
    
    Utilities.sleep(1000);
  }
}

// テスト用関数（現在の時間での実行）
function testReminder() {
  console.log('テスト実行開始');
  hourlyCheck();
  console.log('テスト実行完了');
}

// 特定の時間のリマインダーをテスト
function testReminderAtHour(hour) {
  console.log(`${hour}時のリマインダーテスト開始`);
  
  // 元のgetHours関数を保存
  const originalGetHours = Date.prototype.getHours;
  
  try {
    // 一時的に時間を変更してテスト
    Date.prototype.getHours = function() { return hour; };
    hourlyCheck();
  } finally {
    // 必ず元の関数を復元
    Date.prototype.getHours = originalGetHours;
  }
  
  console.log(`${hour}時のリマインダーテスト完了`);
}

// 1時間ごとの定期実行トリガー設定
function setupHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => ScriptApp.deleteTrigger(trigger));
  
  ScriptApp.newTrigger('hourlyCheck')
    .timeBased()
    .everyHours(1)
    .create();
    
  console.log('トリガー設定完了：1時間ごとに実行');
}

// 後方互換性のための関数（古い方式）
function dailyCheck() {
  console.log('注意: dailyCheck()は非推奨です。hourlyCheck()を使用してください。');
  hourlyCheck();
}