// GAS をウェブアプリとしてデプロイしたときのデプロイ ID
const GAS_DEPLOY_ID = 'AKfycby9LwprXt1sVuqAP6vl0VwIv35A1uWpXppysEzS9FLp3YSx5tbSyD6EyAJb07BgRfs';

function checkReplies() {
    const resultDispId = 'note_result';
    let req = new XMLHttpRequest();
    let form = document.getElementById('setting');
    let noteId = form.note_id.value.trim();

    // 未入力なら実行しない
    if (noteId === '') {
        document.getElementById(resultDispId).innerHTML = '<div class="note_status">noteのIDを入力してください。</div>';
        return;
    }

    let url = 'https://script.google.com/macros/s/' + GAS_DEPLOY_ID +
        '/exec?id=' + encodeURIComponent(noteId) +
        '&period=' + encodeURIComponent(form.note_period.value);

    //結果をクリア＆フォームをロック
    document.getElementById(resultDispId).innerHTML = '<div class="note_status note_loading">しばらく時間がかかります。。。</div>';
    setFormDisabled(true);

    req.open("GET", url, true);
    req.onreadystatechange = function() {
        if (req.readyState == 4) {
            //ロックを解除
            setFormDisabled(false);
            drawResult(req.status == 200 ? req.responseText : '', resultDispId);
        }
    };
    req.send(null);
}

function setFormDisabled(lock) {
    document.getElementById('note_exe').disabled = lock;
    document.getElementById('note_id').disabled = lock;
}

// HTMLに埋め込む値をエスケープ（XSS対策）
function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
}

function showStatus(elementId, message) {
    document.getElementById(elementId).innerHTML = '<div class="note_status">' + escapeHtml(message) + '</div>';
}

function drawResult(jsonText, elementId) {
    let obj;

    try {
        obj = JSON.parse(jsonText);
    } catch (e) {
        showStatus(elementId, '情報を取得できませんでした。');
        return;
    }

    if (obj.status === 'error') {
        showStatus(elementId, obj.message || '情報を取得できませんでした。');
        return;
    }
    if (obj.article_count === 0) {
        showStatus(elementId, '期間内に公開した、新しいコメント方式の記事がありません。');
        return;
    }

    const s = obj.stats;
    let html = '<div class="note_count">' +
        escapeHtml(obj.since) + ' 以降に公開した ' + escapeHtml(obj.article_count) + ' 記事、' +
        'コメント ' + escapeHtml(s.targets) + ' 件をチェック' +
        '<span class="note_summary">' +
        '返信漏れ ' + escapeHtml(s.missing) + ' 件 ・ 要確認 ' + escapeHtml(s.check) + ' 件 ・ ' +
        'スキで完結 ' + escapeHtml(s.liked) + ' 件' +
        '</span></div>';

    if (obj.rows.length === 0) {
        html += '<div class="note_list note_empty">返信漏れ・要確認はありませんでした 🎉</div>';
        document.getElementById(elementId).innerHTML = html;
        return;
    }

    html += '<ul class="note_list">';
    for (let i = 0; i < obj.rows.length; i++) {
        const r = obj.rows[i];
        const statusClass = r.status === '返信漏れ' ? 'note_badge_missing' : 'note_badge_check';
        let title = r.article_name;
        if (title == null || title == '') {
            title = '[タイトルなし]';
        }
        html += '<li class="note_item">' +
            '<div class="note_row">' +
            '<a class="note_user" href="' + escapeHtml(r.user_url) + '" target="_blank" rel="noopener">' +
            '<img class="note_avatar" src="' + escapeHtml(r.user_profile_image_path) + '" alt="">' +
            '<span class="note_body">' +
            '<span class="note_data_name">' + escapeHtml(r.user_nickname) + '</span>' +
            '<span class="note_data_id">' + escapeHtml(r.date) + '</span>' +
            '</span>' +
            '</a>' +
            '<span class="note_badge ' + statusClass + '">' + escapeHtml(r.status) + '</span>' +
            '</div>' +
            '<div class="note_comment">' + escapeHtml(r.comment) + '</div>' +
            '<a class="note_article" href="' + escapeHtml(r.article_url) + '" target="_blank" rel="noopener">' +
            escapeHtml(title) + '</a>' +
            '</li>';
    }
    html += '</ul>';

    document.getElementById(elementId).innerHTML = html;
}
