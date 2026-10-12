// --------------------------------------------------
// グローバル定数の定義
const CONF = {
    FETCH_MAX: 20,      // fetchAll() で一度にフェッチするURL数
    RETRY: 3,           // 429・5xx のときに試行する回数
    GROUP_MINUTES: 60,  // 同じ人の連続した親コメントを1件とみなす間隔（分）
    PERIOD_DAYS: { '1w': 7, '1m': 30, '3m': 90 },  // 期間パラメータ → 遡る日数
    NOTE_URL: 'https://note.com/[USER_ID]/n/', //記事本文
    API_URL: 'https://note.com/api/v2/creators/[USER_ID]/contents?kind=note&disabled_pinned=true&page=',
    API_CMNT_URL_V3: 'https://note.com/api/v3/notes/[KEY]/note_comments',
  };
