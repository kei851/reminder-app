function hourlyCheck() {
  console.log('=== hourlyCheck開始 ===');
  const now = new Date();
  const today = new Date();
  const currentHour = now.getHours();
  console.log(`現在時刻: ${Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss')}`);
  console.log(`現在の時間: ${currentHour}時`);
  
  const values = personalSettingSheet.getRange(2, 1, personalSettingSheet.getLastRow() - 1, 6).getValues();
  console.log(`スプレッドシートから読み込んだデータ数: ${values.length}`);

  const data = values.map((row, index) => ({
    dueDate: row[0],            // A列: 本番の日付
    name: row[1],               // B列: 名前
    reminderMessage: row[2],    // C列: リマインドするメッセージ
    channel: row[3],            // D列: チャンネル
    threadLink: row[4],         // E列: スレッドリンク
    sendTime: row[5],           // F列: 送信時間
    rowIndex: index + 2         // スプレッドシートの行番号（1-indexed + ヘッダー）
  })).filter(row => row.dueDate && row.name && row.reminderMessage);
  
  console.log(`フィルタ後のデータ数: ${data.length}`);
  data.forEach((person, index) => {
    console.log(`${index + 1}. 期日: ${Utilities.formatDate(person.dueDate, Session.getScriptTimeZone(), 'yyyy/MM/dd')}, 名前: ${person.name}, メッセージ: ${person.reminderMessage}, 送信時間: ${person.sendTime}`);
  });

  // 期日とリマインダーでグループ化（同じ期日の人をまとめる）
  const reminderGroups = {};

  // 今日送るべきリマインダーを確認してグループ化
  console.log('=== リマインダー判定開始 ===');
  for (const person of data) {
    console.log(`\n--- ${person.name}のリマインダー判定 ---`);
    const results = calculateReminderDate(person.dueDate, person.reminderMessage);
    console.log(`リマインダー結果数: ${results.length}`);
    
    for (const result of results) {
      // 送信時間を決定（個人設定 > マスターのデフォルト）
      const effectiveSendTime = (person.sendTime !== null && person.sendTime !== undefined && person.sendTime !== '') 
        ? person.sendTime 
        : result.reminder.sendTime;
      
      const reminderDateStr = Utilities.formatDate(result.date, Session.getScriptTimeZone(), 'yyyy/MM/dd');
      const todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy/MM/dd');
      const isSameDateResult = isSameDate(result.date, today);
      const isTimeMatch = effectiveSendTime === currentHour;
      
      console.log(`  リマインダー名: ${result.reminder.name}`);
      console.log(`  リマインダー日: ${reminderDateStr} (今日: ${todayStr})`);
      console.log(`  日付一致: ${isSameDateResult}`);
      console.log(`  送信時間: ${effectiveSendTime}時 (現在: ${currentHour}時)`);
      console.log(`  時間一致: ${isTimeMatch}`);
      console.log(`  両方一致: ${isSameDateResult && isTimeMatch}`);
      
      // 今日が送信日で、かつ現在の時間が送信時間と一致する場合のみ処理
      if (isSameDate(result.date, today) && effectiveSendTime === currentHour) {
        console.log(`  → リマインダー送信対象に追加`);
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
      } else {
        console.log(`  → リマインダー送信対象外`);
      }
    }
  }
  
  console.log(`\n=== 送信対象グループ数: ${Object.keys(reminderGroups).length} ===`);

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

// デバッグ専用：データとリマインダー設定の確認
function debugCurrentData() {
  console.log('=== デバッグ：現在のデータ確認 ===');
  
  const now = new Date();
  const timezone = Session.getScriptTimeZone();
  console.log(`スクリプトのタイムゾーン: ${timezone}`);
  console.log(`現在時刻: ${Utilities.formatDate(now, timezone, 'yyyy/MM/dd HH:mm:ss')}`);
  console.log(`現在の時間: ${now.getHours()}時`);
  console.log(`UTCとの時差: ${now.getTimezoneOffset()}分`);
  
  // スプレッドシートデータ確認
  const values = personalSettingSheet.getRange(2, 1, personalSettingSheet.getLastRow() - 1, 6).getValues();
  console.log(`\n--- スプレッドシートデータ（行数: ${values.length}）---`);
  values.forEach((row, index) => {
    if (row[0] && row[1] && row[2]) { // 必須項目がある行のみ
      console.log(`${index + 2}行目: 期日=${Utilities.formatDate(row[0], Session.getScriptTimeZone(), 'yyyy/MM/dd')}, 名前=${row[1]}, メッセージ=${row[2]}, チャンネル=${row[3]}, 送信時間=${row[5]}`);
    }
  });
  
  // リマインダーマスター確認
  console.log(`\n--- リマインダーマスター（行数: ${allReminders.length}）---`);
  allReminders.forEach((reminder, index) => {
    console.log(`${index + 1}. 名前="${reminder.name}", タイミング="${reminder.timing}"(${typeof reminder.timing}), 送信時間=${reminder.sendTime}時`);
  });
  
  // 今日のリマインダー計算テスト
  console.log(`\n--- 今日のリマインダー計算テスト ---`);
  const testData = values.filter(row => row[0] && row[1] && row[2]);
  testData.forEach((row, index) => {
    const dueDate = row[0];
    const name = row[1];
    const reminderMessage = row[2];
    const sendTime = row[5];
    
    console.log(`\n${name}のテスト:`);
    console.log(`  期日: ${Utilities.formatDate(dueDate, Session.getScriptTimeZone(), 'yyyy/MM/dd')}`);
    console.log(`  リマインダーメッセージ: ${reminderMessage}`);
    console.log(`  個人送信時間: ${sendTime}`);
    
    const results = calculateReminderDate(dueDate, reminderMessage);
    console.log(`  計算結果数: ${results.length}`);
    
    results.forEach((result, i) => {
      const reminderDateStr = Utilities.formatDate(result.date, Session.getScriptTimeZone(), 'yyyy/MM/dd');
      const effectiveSendTime = (sendTime !== null && sendTime !== undefined && sendTime !== '') ? sendTime : result.reminder.sendTime;
      const isTodayReminder = isSameDate(result.date, now);
      const isTimeMatch = effectiveSendTime === now.getHours();
      
      console.log(`    ${i + 1}. リマインダー名: ${result.reminder.name}`);
      console.log(`       リマインダー日: ${reminderDateStr}`);
      console.log(`       送信時間: ${effectiveSendTime}時`);
      console.log(`       今日のリマインダー: ${isTodayReminder}`);
      console.log(`       時間一致: ${isTimeMatch}`);
      console.log(`       送信対象: ${isTodayReminder && isTimeMatch}`);
    });
  });
  
  console.log('=== デバッグデータ確認完了 ===');
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

// 現在時刻でのテスト（送信時間を無視）
function testReminderNow() {
  console.log('=== 現在時刻でのリマインダーテスト（送信時間無視）===');
  
  const values = personalSettingSheet.getRange(2, 1, personalSettingSheet.getLastRow() - 1, 6).getValues();
  const data = values.map((row, index) => ({
    dueDate: row[0],
    name: row[1],
    reminderMessage: row[2],
    channel: row[3],
    threadLink: row[4],
    sendTime: row[5],
    rowIndex: index + 2
  })).filter(row => row.dueDate && row.name && row.reminderMessage);

  const now = new Date();
  const today = new Date();
  
  console.log(`現在時刻: ${Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss')}`);
  
  for (const person of data) {
    console.log(`\n--- ${person.name}のテスト ---`);
    const results = calculateReminderDate(person.dueDate, person.reminderMessage);
    
    for (const result of results) {
      const reminderDateStr = Utilities.formatDate(result.date, Session.getScriptTimeZone(), 'yyyy/MM/dd');
      const todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy/MM/dd');
      const isTodayReminder = isSameDate(result.date, today);
      
      console.log(`  リマインダー名: ${result.reminder.name}`);
      console.log(`  リマインダー日: ${reminderDateStr} (今日: ${todayStr})`);
      console.log(`  今日のリマインダー: ${isTodayReminder}`);
      
      if (isTodayReminder) {
        console.log(`  → 今日送信すべきリマインダーです！`);
        
        // 強制送信テスト
        const finalMessage = `テスト送信: <@${getIdByName(person.name)}>\n${result.reminder.message}`;
        const targetChannelId = person.channel ? getChannelIdByName(person.channel) : channelId;
        
        console.log(`  送信先チャンネル: ${targetChannelId}`);
        console.log(`  送信メッセージ: ${finalMessage}`);
        
        // 実際に送信（コメントアウトを外して実行）
        // const sendResult = postMessage(finalMessage, null, targetChannelId);
        // console.log(`  送信結果: ${sendResult}`);
      }
    }
  }
  
  console.log('=== テスト完了 ===');
}

// タイムゾーン確認・設定
function checkAndSetTimezone() {
  console.log('=== タイムゾーン確認 ===');
  
  const currentTimezone = Session.getScriptTimeZone();
  console.log(`現在のタイムゾーン: ${currentTimezone}`);
  
  const now = new Date();
  console.log(`現在時刻（UTC）: ${now.toISOString()}`);
  console.log(`現在時刻（スクリプト設定）: ${Utilities.formatDate(now, currentTimezone, 'yyyy/MM/dd HH:mm:ss')}`);
  console.log(`getHours()の値: ${now.getHours()}`);
  console.log(`UTCとの時差: ${now.getTimezoneOffset()}分`);
  
  // 日本時間の確認
  const jstTime = Utilities.formatDate(now, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm:ss');
  console.log(`日本時間: ${jstTime}`);
  
  if (currentTimezone !== 'Asia/Tokyo') {
    console.log('警告: タイムゾーンが日本時間（Asia/Tokyo）に設定されていません！');
    console.log('Google Apps Scriptの設定で Asia/Tokyo に変更してください。');
  } else {
    console.log('✓ タイムゾーンは正しく日本時間に設定されています。');
  }
  
  console.log('=== タイムゾーン確認完了 ===');
}

// 現在時刻（15時）でのテスト実行
function testReminderAt15() {
  console.log('=== 15時のリマインダーテスト ===');
  testReminderAtHour(15);
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