'use strict';
/*
 note の新コメント方式 (v3) で、作者の返信漏れをチェックする。
 （claude-skills の note-reply-check/check_replies.py の移植。判定ルールは同じ）

 対象: 基準日以降に公開された記事のコメント (古い記事は取得しない)。

 v3 のコメント構造:
   - 記事直下の root コメント (/note_comments)
   - root ごとのスレッド (/note_comments?parent_key=<rootのkey>)
     返信は全て root 直下に平らに並び、宛先は to_user (@ユーザ名) で表される

 チェック対象 (作者以外のコメントのうち):
   1. 全ての親 (root) コメント
   2. 作者宛て (to_user = 作者) の子コメント
 ※ ユーザーの同一判定は note ID ではなく内部キー (user.key) で行う
 判定:
   同じスレッド内で、そのコメントより後に作者が投稿者宛て (to_user = 投稿者) に
   返信していれば「返信済み」、なければ「返信漏れ」。
   ただし同じユーザーが続けて投稿した親コメント (間に他の親コメントがなく、
   GROUP_MINUTES 分以内) は1件とみなし、どれかに返信があれば全て「返信済み」。
   作者宛ての子コメントに作者がスキしていて、それより前に同じスレッドで作者が
   投稿者宛てに返信している (1往復以上ある) 場合は「スキで完結」とし、返信済みとみなす。
   親コメントも、作者がスキしていて、それより前に同じ記事のどこかのスレッドで作者が
   投稿者宛てに返信していれば「スキで完結」 (作者の返信に新しい親コメントで返事をしたケース)。
   スレッドで返信がなくても、同じ記事で後から作者が親コメントを書いていれば
   (親コメントで返事をするケース)「要確認」。その本文に投稿者の呼び名が
   含まれていれば「要確認(返信の可能性高)」（件数のみ集計し、一覧には出さない）。
 「スキで完結」は一覧にも含める（画面側で表示を切り替える）。
*/

const STATUS = {
  MISSING: '返信漏れ',
  CHECK: '要確認',
  CHECK_LIKELY: '要確認(返信の可能性高)',
  LIKED: 'スキで完結',
};

let requestCount = 0;  // パフォーマンス確認用のリクエスト数

function main(userID, since){
  const start = Date.now();
  requestCount = 0;

  // 基準日以降に公開された新コメント方式の記事と、作者の内部キーを取得
  const list = getArticles(userID, since);
  const authorKey = list.authorKey;
  const targets = list.articles.filter(a => a.commentCount);

  // 記事ごとの親コメント → 返信のある親コメントのスレッド の順にまとめて取得
  const baseURLs = targets.map(a => CONF.API_CMNT_URL_V3.replace('[KEY]', a.key));
  const rootLists = fetchAllPages(baseURLs);

  const threadURLs = [];
  rootLists.forEach((roots, i) => {
    roots.filter(r => r.reply_count).forEach(r => {
      threadURLs.push(baseURLs[i] + '?parent_key=' + r.key);
    });
  });
  const replyLists = fetchAllPages(threadURLs);

  // 記事ごとに判定
  const stats = { targets: 0 };
  Object.values(STATUS).forEach(s => stats[s] = 0);
  let rows = [];
  let t = 0;
  targets.forEach((a, i) => {
    const threads = rootLists[i].map(root => {
      const replies = root.reply_count ? replyLists[t++] : [];
      return { root: root, comments: sortByCreatedAt([root].concat(replies)) };
    });
    rows = rows.concat(checkArticle(userID, since, authorKey, a, threads, stats));
  });

  // 投稿日順に並べる (同じ日の中は記事の順を保つ)
  rows.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);

  return {
    status: 'ok',
    user_id: userID,
    since: since,
    article_count: list.articles.length,
    stats: {
      targets: stats.targets,
      missing: stats[STATUS.MISSING],
      check: stats[STATUS.CHECK],
      check_likely: stats[STATUS.CHECK_LIKELY],
      liked: stats[STATUS.LIKED],
    },
    rows: rows,
    requests: requestCount,
    elapsed_sec: (Date.now() - start) / 1000,
  };
}

// --------------------------------------------------
// 基準日以降に公開された新コメント方式の記事を取得 (一覧は新しい順)。
// 基準日より前の記事に達したら終了。作者の内部キーも返す
function getArticles(userID, since){
  const apiURL = CONF.API_URL.replace('[USER_ID]', userID);
  let articles = [];
  let authorKey = null;

  for(let page = 1; ; page++){
    let data;
    try{
      data = fetchJsonAll([apiURL + page])[0].data;
    }catch(e){
      throw new Error('記事一覧を取得できません。ユーザーIDを確認してください。');
    }
    const contents = data.contents;
    if(contents.length && authorKey === null){
      authorKey = contents[0].user.key;
    }
    const recent = contents.filter(a => a.publishAt.slice(0, 10) >= since);
    articles = articles.concat(recent.filter(a => a.capabilities.noteComment));
    if(data.isLastPage || recent.length < contents.length){
      return { articles: articles, authorKey: authorKey };
    }
  }
}

// 1記事分のスレッド ({root, comments: 投稿順}) を判定し、一覧に出す行を返す (集計は stats に加算)
function checkArticle(userID, since, authorKey, article, threads, stats){
  const results = [];  // 作者以外の親コメントを含む全チェック候補
  const authorRoots = [];
  // 記事内の作者の返信 (親コメントの「スキで完結」はスレッドをまたいで探す)
  const authorReplies = [].concat(...threads.map(t => t.comments))
                          .filter(c => c.user.key === authorKey && toUserKey(c));

  threads.forEach(t => {
    const thread = t.comments;
    if(t.root.user.key === authorKey){
      authorRoots.push(t.root);
    }
    thread.forEach(c => {
      if(isTarget(c, authorKey)){
        results.push({
          comment: c,
          reply: findReply(c, thread, authorKey),
          liked: isClosedByLike(c, thread, authorKey, authorReplies),
        });
      }
    });
  });
  mergeSplitRoots(results);

  const rows = [];
  results.forEach(r => {
    const c = r.comment;
    if(c.created_at.slice(0, 10) < since){
      return;
    }
    stats.targets++;
    if(r.reply){
      return;
    }
    // 「スキで完結」も一覧に含める (表示するかは画面側で切り替える)
    const status = r.liked ? STATUS.LIKED : checkAuthorRoots(c, authorRoots);
    stats[status]++;
    // 「要確認(返信の可能性高)」は件数が多いため一覧に出さない (ゆるめのチェック)
    if(status === STATUS.CHECK_LIKELY){
      return;
    }
    rows.push({
      date: c.created_at.slice(0, 10),
      created_at: c.created_at,
      user_nickname: c.user.nickname,
      user_urlname: c.user.urlname,
      user_url: 'https://note.com/' + c.user.urlname,
      user_profile_image_path: c.user.profile_image_url,
      comment: textOf(c.comment),
      article_name: article.name,
      article_url: CONF.NOTE_URL.replace('[USER_ID]', userID) + article.key,
      status: status,
    });
  });
  return rows;
}

function isTarget(c, authorKey){
  if(c.user.key === authorKey){
    return false;
  }
  return c.is_root || toUserKey(c) === authorKey;
}

// c より後の、作者から c の投稿者宛ての返信を返す
function findReply(c, thread, authorKey){
  return thread.find(r => r.user.key === authorKey && r.created_at > c.created_at
                          && toUserKey(r) === c.user.key) || null;
}

// 1往復以上のやり取りのあと、作者のスキで締めたコメントか
// (子コメントは同じスレッド、親コメントは記事全体から作者の返信を探す)
function isClosedByLike(c, thread, authorKey, authorReplies){
  if(!c.is_creator_liked){
    return false;
  }
  const candidates = c.is_root ? authorReplies : thread;
  return candidates.some(r => r.user.key === authorKey && r.created_at < c.created_at
                              && toUserKey(r) === c.user.key);
}

// スレッド外の返事候補 (c より後の作者の親コメント) からステータスを決める
function checkAuthorRoots(c, authorRoots){
  const later = authorRoots.filter(r => r.created_at > c.created_at);
  if(!later.length){
    return STATUS.MISSING;
  }
  const hints = nameHints(c.user);
  if(later.some(r => hints.some(h => textOf(r.comment).includes(h)))){
    return STATUS.CHECK_LIKELY;
  }
  return STATUS.CHECK;
}

// 本文で呼びかけに使われそうな名前の候補 (例: 'Noriko Kato' → 'Noriko')
function nameHints(user){
  const hints = new Set([user.urlname]);
  user.nickname.split(/[｜|【】\[\]()（）@\/／・.．。、,，!！?？~〜♪☆★\s]+/).forEach(part => {
    // 'ポッペちゃん' → 'ポッペ' (本文では 'ポッペさん' と呼ばれることがある)
    [part, part.replace(/(ちゃん|さん|くん|君|様|さま|氏)$/, '')].forEach(name => {
      if(Array.from(name).length >= 2){
        hints.add(name);
      }
    });
  });
  return Array.from(hints);
}

// 続けて投稿された同じユーザーの親コメントを1件とみなし、返信を共有する
function mergeSplitRoots(results){
  const roots = sortByCreatedAt(results.filter(r => r.comment.is_root), r => r.comment.created_at);
  const groups = [];
  roots.forEach(r => {
    const last = groups.length ? groups[groups.length - 1] : null;
    const prev = last ? last[last.length - 1].comment : null;
    if(prev && prev.user.key === r.comment.user.key
       && minutesBetween(prev.created_at, r.comment.created_at) <= CONF.GROUP_MINUTES){
      last.push(r);
    }else{
      groups.push([r]);
    }
  });
  groups.forEach(g => {
    const replied = g.find(r => r.reply);
    if(replied){
      g.forEach(r => {
        if(!r.reply){
          r.reply = replied.reply;
        }
      });
    }
  });
}

// --------------------------------------------------
// 小さなヘルパー
function toUserKey(c){
  return c.to_user ? c.to_user.key : undefined;
}

function textOf(node){
  if('value' in node){
    return node.value;
  }
  return (node.children || []).map(textOf).join('');
}

function minutesBetween(a, b){
  return Math.abs(new Date(a) - new Date(b)) / 60000;
}

// created_at (ISO 形式の文字列) の昇順に並べた新しい配列を返す (安定ソート)
function sortByCreatedAt(list, getKey){
  getKey = getKey || (c => c.created_at);
  return list.slice().sort((x, y) => {
    const a = getKey(x);
    const b = getKey(y);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

// --------------------------------------------------
// 各URLについて next_page を辿って全ページ取得し、URLごとの data 配列を返す。
// 各ページは URL をまたいで fetchAll でまとめて取得する
function fetchAllPages(urls){
  const results = urls.map(() => []);
  let pending = urls.map((url, i) => ({ index: i, url: url, page: 1 }));

  while(pending.length){
    const jsons = fetchJsonAll(pending.map(p => p.url + (p.url.includes('?') ? '&' : '?') + 'page=' + p.page));
    const next = [];
    pending.forEach((p, j) => {
      results[p.index] = results[p.index].concat(jsons[j].data);
      if(jsons[j].next_page){
        next.push({ index: p.index, url: p.url, page: jsons[j].next_page });
      }
    });
    pending = next;
  }
  return results;
}

// URLを FETCH_MAX 件ずつ fetchAll で取得し、JSON の配列を返す。
// 429・5xx は時間を置いて再試行する (404 などは再試行しても変わらないのでエラー)
function fetchJsonAll(urls){
  const jsons = [];
  for(let start = 0; start < urls.length; start += CONF.FETCH_MAX){
    const chunk = urls.slice(start, start + CONF.FETCH_MAX);
    const chunkJsons = new Array(chunk.length);
    let pending = chunk.map((url, i) => i);

    for(let attempt = 1; pending.length; attempt++){
      requestCount += pending.length;
      const responses = UrlFetchApp.fetchAll(pending.map(i => ({ url: chunk[i], muteHttpExceptions: true })));
      const retry = [];
      responses.forEach((res, j) => {
        const i = pending[j];
        const code = res.getResponseCode();
        if(code === 200){
          chunkJsons[i] = JSON.parse(res.getContentText('UTF-8'));
        }else if((code === 429 || code >= 500) && attempt < CONF.RETRY){
          console.log(`リトライ ${attempt}/${CONF.RETRY - 1}: ${chunk[i]} (${code})`);
          retry.push(i);
        }else{
          throw new Error(`取得に失敗しました (${code}): ${chunk[i]}`);
        }
      });
      pending = retry;
      if(pending.length){
        Utilities.sleep(attempt * 2000);
      }
    }
    jsons.push(...chunkJsons);
  }
  return jsons;
}
