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

// スレッド管理
function getThreadTs(threadGroup) {
  return PropertiesService.getScriptProperties().getProperty(`thread_${threadGroup}`);
}

function setThreadTs(threadGroup, threadTs) {
  PropertiesService.getScriptProperties().setProperty(`thread_${threadGroup}`, threadTs);
}

// スレッドリンクをスプレッドシートに記録
function updateThreadLinks(peopleData, threadLink) {
  peopleData.forEach(person => {
    personalSettingSheet.getRange(person.rowIndex, 4).setValue(threadLink);
  });
}