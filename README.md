# note-reply-check
コメントの返信漏れをチェックするツール

note (note.com) の記事についたコメントに、作者が返信し忘れていないかをチェックします。

https://licodeenar.github.io/note-reply-check/

## 使い方

1. 期間（直近1週間／1ヶ月／3ヶ月に公開した記事）を選ぶ
2. note ID または note の URL を入力して「返信漏れをチェック」を押す

`?id=<note ID>&period=1w`（`1w` / `1m` / `3m`）を付けた URL で開くと、そのまま実行します。

## 判定ルール

| ステータス | 意味 |
|---|---|
| 返信漏れ | 作者からの返信が見つからない |
| 要確認 | スレッドでの返信はないが、後から作者が親コメントを書いている（それが返事かを目で確認） |

- チェック対象は、作者以外の親コメント全てと、作者宛て（@作者）の子コメント
- そのコメントより後に、同じスレッドで作者が投稿者宛てに返信していれば返信済み
- 同じ人が続けて投稿した親コメント（間に他の親コメントがなく 60 分以内）は 1 件とみなす
- 作者宛ての子コメントに作者がスキしていて、それより前にその人へ返信している（1往復以上ある）場合は「スキで完結」として返信済み扱い（件数のみ表示）
- 「要確認」のうち、作者の親コメント本文に投稿者の呼び名があるもの（返信の可能性高）は件数のみ集計し、一覧には出さない
- ユーザーの同一判定は note ID ではなく内部キー（`user.key`）で行うため、ID や表示名の変更に影響されない

判定ロジックは claude-skills の `note-reply-check/check_replies.py` と同じです。

## 構成

```
docs/       GitHub Pages の画面 (index.html, assets/script.js, assets/style.css)
web_api/    Google Apps Script
  do_get.gs         ウェブアプリの入口。?id=&period= を受け取り JSON を返す
  config.gs         定数
  check_replies.gs  コメントの取得と判定
  test.gs           Python 版との照合用 (testCompare) と doGet の動作確認 (testDoGet)
```

### GAS のデプロイ

1. `web_api/` の `.gs` を GAS プロジェクトに貼り付ける
2. ウェブアプリとしてデプロイ（実行ユーザー: 自分、アクセス: 全員）
3. デプロイ ID を `docs/assets/script.js` の `GAS_DEPLOY_ID` に設定する

### API

`GET https://script.google.com/macros/s/<デプロイID>/exec?id=<note ID または URL>&period=<1w|1m|3m>`

```json
{
  "status": "ok",
  "user_id": "...",
  "since": "2026-09-27",
  "article_count": 15,
  "stats": { "targets": 30, "missing": 7, "check": 0, "check_likely": 0, "liked": 2 },
  "rows": [
    { "date": "...", "user_nickname": "...", "comment": "...", "article_name": "...", "article_url": "...", "status": "返信漏れ", "...": "..." }
  ],
  "requests": 36,
  "elapsed_sec": 3.1
}
```

エラー時は `{"status": "error", "message": "..."}` を返します。

### 制限

GAS の 1 回の実行は 6 分まで、URL 取得は 1 日 2 万回までです（同じ Google アカウントの他のスクリプトと合算）。
ほぼ毎日更新しているアカウントの 3 ヶ月分（約 100 記事）で 300 回程度の取得になります。
