//HTTP GETをハンドリングする
function doGet(e){

  //リクエストパラメータ id（note ID または URL）と period（1w / 2w / 1m）を取得する
  let paramID = getNoteUserID(e.parameter.id || '');
  let paramPeriod = e.parameter.period;
  let result;
  let out;

  try{
    if(!/^[A-Za-z0-9_]+$/.test(paramID)){
      throw new Error('ユーザーIDが正しくありません。');
    }
    if(!(paramPeriod in CONF.PERIOD_DAYS)){
      throw new Error('期間が正しく指定されていません。');
    }

    // 返信漏れをチェック
    result = main(paramID, getSinceDate(CONF.PERIOD_DAYS[paramPeriod]));

  }catch(e){
    console.log(e);
    result = { status: 'error', message: e.message };
  }

  //Mime TypeをJSONに設定
  out = ContentService.createTextOutput();
  out.setMimeType(ContentService.MimeType.JSON);
  out.setContent(JSON.stringify(result));

  return out;
}

//入力値がIDがURLかでIDを抜き出す
function getNoteUserID(inputString) {
  // URLだった場合
  if (inputString.includes("note.com/")) {
    const parts = inputString.split('/');
    return (parts[3] || '').trim();
  }

  // IDだった場合
  return inputString.trim();
}

//今日（日本時間）から days 日前の日付を YYYY-MM-DD で返す
function getSinceDate(days) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return Utilities.formatDate(since, 'Asia/Tokyo', 'yyyy-MM-dd');
}
