/* ============================================================
   マイニュース — 記事一覧とカテゴリー管理
   データ: data/articles.json（記事）と data/categories.json（カテゴリー）
   既読・前回の閲覧時刻などはこの端末のブラウザにだけ保存する
   ============================================================ */
(() => {
  "use strict";

  const PAGE_SIZE = 120;
  const READ_LIMIT = 4000;            // 既読として覚えておく記事数の上限
  const PENDING_TTL = 30 * 60 * 1000; // 「反映待ち」を表示しておく時間
  const KEY = { read: "mn.read", seen: "mn.seenAt", unread: "mn.unreadOnly", pending: "mn.pending" };

  // GitHub Pages の URL（<owner>.github.io/<repo>/）からリポジトリを割り出す
  const REPO = (() => {
    const host = location.hostname;
    if (host.endsWith(".github.io")) {
      const owner = host.split(".")[0];
      const repo = location.pathname.split("/").filter(Boolean)[0] || `${owner}.github.io`;
      return `${owner}/${repo}`;
    }
    return "k-tkhsh/camp-monitor";
  })();

  // ── 小さな道具 ──────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);

  // 記事データには X の投稿など第三者が書いた文章が入るので、必ずエスケープして表示する
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // http / https 以外（javascript: など）のリンクは無効にする
  function safeUrl(url) {
    return /^https?:\/\//i.test(url || "") ? esc(url) : "#";
  }
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 保存できなくても表示は続ける */ }
  }

  // カテゴリーごとの色相（id から決める。ライト/ダークの明るさは CSS 側で切り替える）
  function hue(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  }

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // 過去のデータに残る見出し末尾の「 - 媒体名」を表示時に取り除く
  function cleanTitle(title, source) {
    if (!source) return title;
    const re = new RegExp(`\\s*[-–|]\\s*${escapeRegExp(source)}\\s*$`);
    const cut = title.replace(re, "");
    return cut.length >= 8 ? cut : title;
  }

  const pad = (n) => String(n).padStart(2, "0");
  function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function dayLabel(key) {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    if (key === dayKey(today)) return "今日";
    if (key === dayKey(yesterday)) return "昨日";
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return `${m}月${d}日（${"日月火水木金土"[date.getDay()]}）`;
  }
  function relTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const diffMin = (Date.now() - d.getTime()) / 60000;
    if (diffMin < 60) return `${Math.max(1, Math.floor(diffMin))}分前`;
    if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}時間前`;
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ── 状態 ────────────────────────────────────────────────
  const state = {
    articles: [],
    categories: [],
    lastUpdated: "",
    active: "all",
    query: "",
    unreadOnly: load(KEY.unread, false),
    read: new Set(load(KEY.read, [])),
    shown: PAGE_SIZE,
    // 前回見た時点（ミリ秒）より後に集めた記事を NEW とする（初回は直近24時間）
    seenAt: Number(load(KEY.seen, 0)) || Date.now() - 86400000,
  };

  const catById = (id) => state.categories.find((c) => c.id === id);
  const isNew = (a) => Date.parse(a.first_seen || "") > state.seenAt;
  const isRead = (a) => state.read.has(a.id);
  const isEnjo = (a) => a.keyword === "炎上" || a.keyword === "謝罪";
  // 急上昇ワードは単語だけで中身が分かりにくいので、「すべて」では一覧に混ぜず上部の帯にまとめる
  const isTrendWord = (a) => a.keyword === "急上昇ワード";
  const sortTime = (a) => a.published || a.first_seen || "";

  function markRead(ids) {
    for (const id of ids) state.read.add(id);
    const list = [...state.read];
    save(KEY.read, list.slice(Math.max(0, list.length - READ_LIMIT)));
  }

  // ── 記事一覧 ────────────────────────────────────────────
  function filtered() {
    const q = state.query.trim().toLowerCase();
    return state.articles.filter((a) => {
      if (state.active !== "all" && a.category !== state.active) return false;
      if (state.active === "all" && !q && isTrendWord(a)) return false;
      if (state.unreadOnly && isRead(a)) return false;
      if (q) {
        const hay = `${a.title} ${a.title_en || ""} ${a.source} ${a.summary || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderChips() {
    const unread = {};
    let all = 0;
    for (const a of state.articles) {
      if (isRead(a)) continue;
      unread[a.category] = (unread[a.category] || 0) + 1;
      all += 1;
    }
    const chip = (id, label, n) =>
      `<button class="chip" type="button" data-cat="${esc(id)}" aria-pressed="${state.active === id}">` +
      `${esc(label)}${n ? `<span class="n">${n}</span>` : ""}</button>`;
    $("#chips").innerHTML =
      chip("all", "すべて", all) +
      state.categories.map((c) => chip(c.id, c.label, unread[c.id] || 0)).join("");
    $("#chips [aria-pressed='true']")?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function rowHtml(a, showCat) {
    const cat = catById(a.category);
    const related = Array.isArray(a.related) ? a.related : [];
    const tags = [
      showCat && cat ? `<span class="cat" style="--hue:${hue(cat.id)}">${esc(cat.label)}</span>` : "",
      isEnjo(a) ? '<span class="badge enjo">炎上</span>' : "",
      isNew(a) && !isRead(a) ? '<span class="badge new">NEW</span>' : "",
    ].join("");
    // 急上昇ワードは単語だけでは中身が分からないので要約（関連語など）も出す
    const summary = isTrendWord(a) && a.summary ? `<p class="row-sum">${esc(a.summary)}</p>` : "";
    return `
      <article class="row${isRead(a) ? " is-read" : ""}" data-id="${esc(a.id)}">
        <a class="row-link" href="${safeUrl(a.url)}" target="_blank" rel="noopener">
          ${tags ? `<div class="row-tags">${tags}</div>` : ""}
          <h3 class="row-title">${esc(cleanTitle(a.title, a.source))}</h3>
          ${summary}
        </a>
        <div class="row-meta">
          <span class="src">${esc(a.source)}</span><span class="dot">·</span>
          <time datetime="${esc(sortTime(a))}">${esc(relTime(sortTime(a)))}</time>
          ${related.length ? `<button class="more" type="button" aria-expanded="false">＋${related.length}媒体</button>` : ""}
        </div>
        ${related.length ? `<ul class="related" hidden>${related.map((r) =>
          `<li><a href="${safeUrl(r.url)}" target="_blank" rel="noopener">${esc(r.source)}</a></li>`).join("")}</ul>` : ""}
      </article>`;
  }

  function renderFeed() {
    const items = filtered().sort((x, y) => (sortTime(y) > sortTime(x) ? 1 : -1));
    const fresh = items.filter((a) => isNew(a) && !isRead(a)).length;
    $("#count").innerHTML = `${items.length}件` + (fresh ? ` · <strong>新着 ${fresh}</strong>` : "");

    if (!items.length) {
      $("#feed").innerHTML = `<div class="empty">${
        state.query ? "見つかりませんでした" : state.unreadOnly ? "未読の記事はありません 🎉" : "まだ記事がありません"}</div>`;
      return;
    }

    const showCat = state.active === "all";
    let html = "";
    let currentDay = "";
    let open = false;
    for (const a of items.slice(0, state.shown)) {
      const d = new Date(sortTime(a));
      const key = Number.isNaN(d.getTime()) ? "" : dayKey(d);
      if (key !== currentDay) {
        if (open) html += "</div>";
        html += `<h2 class="day">${esc(key ? dayLabel(key) : "日付不明")}</h2><div class="list">`;
        currentDay = key;
        open = true;
      }
      html += rowHtml(a, showCat);
    }
    if (open) html += "</div>";
    if (items.length > state.shown) {
      html += `<button class="load-more" id="load-more" type="button">もっと見る（残り ${items.length - state.shown}件）</button>`;
    }
    $("#feed").innerHTML = html;
  }

  function renderTrends() {
    const box = $("#trends");
    const words = state.active === "all" && !state.query
      ? state.articles.filter(isTrendWord).sort((x, y) => (sortTime(y) > sortTime(x) ? 1 : -1)).slice(0, 12)
      : [];
    box.hidden = !words.length;
    if (!words.length) return;
    const sns = words[0].category;
    box.innerHTML =
      `<a class="trends-head" href="#${esc(sns)}">🔥 いま急上昇</a>` +
      words.map((a) => `<a class="trend" href="${safeUrl(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a>`).join("");
  }

  function renderStamp() {
    const d = new Date(state.lastUpdated);
    $("#stamp").textContent = Number.isNaN(d.getTime())
      ? ""
      : `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())} 更新`;
  }

  // ── カテゴリー管理 ──────────────────────────────────────
  function yamlScalar(v) {
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return String(v);
    return JSON.stringify(String(v)); // JSON の文字列表記は YAML としても正しい
  }
  function toYaml(obj, indent = "") {
    let out = "";
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        if (!v.length) { out += `${indent}${k}: []\n`; continue; }
        out += `${indent}${k}:\n`;
        for (const item of v) {
          if (item && typeof item === "object") {
            out += `${indent}  - ${toYaml(item, `${indent}    `).trimStart()}`;
          } else {
            out += `${indent}  - ${yamlScalar(item)}\n`;
          }
        }
      } else {
        out += `${indent}${k}: ${yamlScalar(v)}\n`;
      }
    }
    return out;
  }

  function openIssue(title, data) {
    const body =
      "サイトの「カテゴリー管理」から作成した依頼です。\n" +
      "このまま「Create」（送信）を押すと、数分後にサイトへ反映されます。\n\n" +
      "```yaml\n" + toYaml(data) + "```\n";
    const url = `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    // "noopener" を指定すると window.open は常に null を返し、下の代替処理が毎回動いてしまう。
    // 開いてから opener を切る
    const win = window.open(url, "_blank");
    if (win) win.opener = null;
    else location.href = url; // ポップアップが止められたときだけ、この画面で開く

    const pending = load(KEY.pending, []);
    pending.push({ mode: data.mode, id: data.id || "", name: data.name || "", title, at: Date.now() });
    save(KEY.pending, pending);
    renderSettings();
  }

  // 反映待ち: 追加は名前が現れたら、削除は id が消えたら完了とみなす。それ以外は時間で消す
  function activePending() {
    const now = Date.now();
    const list = load(KEY.pending, []).filter((p) => {
      if (now - p.at > PENDING_TTL) return false;
      if (p.mode === "add") return !state.categories.some((c) => c.name === p.name);
      if (p.mode === "delete") return state.categories.some((c) => c.id === p.id);
      return true;
    });
    save(KEY.pending, list);
    return list;
  }

  function renderSettings() {
    const pending = activePending();
    $("#pending").innerHTML = pending.length
      ? `<div class="notice">⏳ 反映待ち: ${pending.map((p) => esc(p.title)).join("、")}<br>` +
        "GitHub で「Create」を押していれば、数分後に反映されます（このページを開き直すと確認できます）。</div>"
      : "";

    $("#category-list").innerHTML = state.categories.map((c) => {
      const tags = (list) => list.map((w) => `<span class="tag">${esc(w)}</span>`).join(" ");
      const lines = [
        c.keywords.length ? `<div class="kv"><b>キーワード</b>${tags(c.keywords)}</div>` : "",
        c.exclude.length ? `<div class="kv"><b>除外</b>${tags(c.exclude)}</div>` : "",
        c.feeds.length ? `<div class="kv"><b>RSS</b>${tags(c.feeds.map((f) => f.name || f.url))}</div>` : "",
        c.realtime ? '<div class="kv"><b>情報源</b><span class="tag">Yahoo!リアルタイム検索</span></div>' : "",
        `<div class="kv"><b>言語</b>${c.lang === "en" ? "英語（翻訳）" : "日本語"}<b style="margin-left:10px">通知</b>${c.notify ? "あり" : "なし"}</div>`,
      ].join("");
      return `
        <article class="cat-card" style="--hue:${hue(c.id)}">
          <header><span class="swatch"></span><h3>${esc(c.label)}</h3></header>
          ${lines}
          <div class="card-actions">
            <button class="btn small danger" type="button" data-delete="${esc(c.id)}">削除</button>
            <button class="btn small" type="button" data-edit="${esc(c.id)}">編集</button>
          </div>
        </article>`;
    }).join("");
  }

  const lines = (text) => String(text || "").split("\n").map((s) => s.trim()).filter(Boolean);
  let editing = null; // 編集中のカテゴリー（追加のときは null）

  function openSheet(cat) {
    editing = cat || null;
    const form = $("#category-form");
    const f = form.elements; // f.name はフォーム自身の名前になるので elements 経由で参照する
    form.reset();
    $("#form-error").hidden = true;
    $("#sheet-title").textContent = cat ? `「${cat.label}」を編集` : "カテゴリーを追加";
    if (cat) {
      f.emoji.value = cat.emoji || "";
      f.name.value = cat.name;
      f.keywords.value = cat.keywords.join("\n");
      f.exclude.value = cat.exclude.join("\n");
      f.lang.value = cat.lang === "en" ? "en" : "ja";
      f.notify.checked = !!cat.notify;
    }
    form.querySelector("details.adv summary").textContent = cat && cat.feeds.length
      ? `RSS を追加する（今の ${cat.feeds.length} 件はそのまま残ります）`
      : "RSS を追加する（上級者向け・任意）";
    $("#sheet").showModal();
  }

  function submitSheet(event) {
    event.preventDefault();
    const form = $("#category-form");
    const f = form.elements; // f.name はフォーム自身の名前になるので elements 経由で参照する
    const error = (msg) => { $("#form-error").textContent = msg; $("#form-error").hidden = false; };

    const name = f.name.value.trim();
    const keywords = lines(f.keywords.value);
    const feedUrl = f.feed_url.value.trim();
    if (!name) return error("名前を入力してください。");
    if (feedUrl && !/^https:\/\//i.test(feedUrl)) return error("RSS の URL は https:// で始まるものを入力してください。");
    const feed = feedUrl
      ? [{ name: f.feed_name.value.trim() || feedUrl, url: feedUrl, match: lines(f.feed_match.value) }]
      : [];
    const hasSource = keywords.length || feed.length || (editing && (editing.feeds.length || editing.realtime));
    if (!hasSource) return error("検索キーワードか RSS を1つ以上入力してください。");
    const dup = state.categories.find((c) => c.name === name && c.id !== editing?.id);
    if (dup) return error(`「${name}」は既にあります。`);

    const emoji = f.emoji.value.trim() || "📰";
    const common = {
      name,
      emoji,
      lang: f.lang.value,
      notify: f.notify.checked,
      keywords,
      exclude: lines(f.exclude.value),
    };
    if (editing) {
      openIssue(`カテゴリー編集: ${emoji} ${name}`, { mode: "update", id: editing.id, ...common, add_feeds: feed });
    } else {
      openIssue(`カテゴリー追加: ${emoji} ${name}`, { mode: "add", ...common, feeds: feed });
    }
    $("#sheet").close();
  }

  // ── 画面の切り替え ──────────────────────────────────────
  function route() {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    const settings = hash === "settings";
    $("#view-news").hidden = settings;
    $("#view-settings").hidden = !settings;
    $("#chips").hidden = settings;
    $("#settings-link").setAttribute("aria-current", settings ? "page" : "false");
    if (settings) {
      renderSettings();
      window.scrollTo(0, 0);
      return;
    }
    const next = catById(hash) ? hash : "all";
    if (next !== state.active) {
      state.active = next;
      state.shown = PAGE_SIZE;
      window.scrollTo(0, 0);
    }
    renderChips();
    renderTrends();
    renderFeed();
  }

  // 日付見出しをヘッダーのすぐ下に貼り付けるため、ヘッダーの高さを CSS に渡す
  function syncStickyTop() {
    document.documentElement.style.setProperty("--sticky-top", `${$(".topbar").offsetHeight}px`);
  }

  // 前回見た時点を記録（次に開いたとき、それより後の記事に NEW を付ける）
  function rememberSeen() {
    const latest = state.articles.reduce((m, a) => Math.max(m, Date.parse(a.first_seen || "") || 0), 0);
    if (latest) save(KEY.seen, latest);
  }

  // ── イベント ────────────────────────────────────────────
  function bind() {
    $("#chips").addEventListener("click", (e) => {
      const btn = e.target.closest(".chip");
      if (btn) location.hash = btn.dataset.cat === "all" ? "" : btn.dataset.cat;
    });

    $("#feed").addEventListener("click", (e) => {
      const more = e.target.closest(".more");
      if (more) {
        const list = more.closest(".row").querySelector(".related");
        const open = list.hidden;
        list.hidden = !open;
        more.setAttribute("aria-expanded", String(open));
        return;
      }
      if (e.target.closest("#load-more")) {
        state.shown += PAGE_SIZE;
        renderFeed();
        return;
      }
      const row = e.target.closest(".row");
      if (row && e.target.closest("a")) {
        markRead([row.dataset.id]);
        row.classList.add("is-read");
        row.querySelector(".badge.new")?.remove();
        renderChips();
      }
    });

    $("#search-toggle").addEventListener("click", () => {
      const row = $("#search-row");
      row.hidden = !row.hidden;
      $("#search-toggle").setAttribute("aria-pressed", String(!row.hidden));
      if (!row.hidden) {
        $("#search").focus();
      } else if (state.query) {
        state.query = "";
        $("#search").value = "";
        renderFeed();
      }
      syncStickyTop();
    });
    $("#search").addEventListener("input", (e) => {
      state.query = e.target.value;
      state.shown = PAGE_SIZE;
      renderTrends();
      renderFeed();
    });

    const unreadBtn = $("#unread-toggle");
    unreadBtn.setAttribute("aria-pressed", String(state.unreadOnly));
    unreadBtn.addEventListener("click", () => {
      state.unreadOnly = !state.unreadOnly;
      save(KEY.unread, state.unreadOnly);
      unreadBtn.setAttribute("aria-pressed", String(state.unreadOnly));
      renderFeed();
    });

    $("#mark-all").addEventListener("click", () => {
      const ids = filtered().map((a) => a.id);
      if (!ids.length) return;
      if (!confirm(`表示中の ${ids.length} 件を既読にしますか？`)) return;
      markRead(ids);
      renderChips();
      renderFeed();
    });

    $("#add-category").addEventListener("click", () => openSheet(null));
    $("#category-list").addEventListener("click", (e) => {
      const edit = e.target.closest("[data-edit]");
      if (edit) return openSheet(catById(edit.dataset.edit));
      const del = e.target.closest("[data-delete]");
      if (del) {
        const cat = catById(del.dataset.delete);
        if (cat && confirm(`「${cat.label}」を削除しますか？\nこのカテゴリーの記事もサイトから消えます。`)) {
          openIssue(`カテゴリー削除: ${cat.label}`, { mode: "delete", id: cat.id, name: cat.name });
        }
      }
    });
    $("#category-form").addEventListener("submit", submitSheet);
    $("#sheet-cancel").addEventListener("click", () => $("#sheet").close());

    window.addEventListener("hashchange", route);
    window.addEventListener("resize", syncStickyTop);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") rememberSeen();
    });
    window.addEventListener("pagehide", rememberSeen);
  }

  // ── 読み込み ────────────────────────────────────────────
  async function fetchJson(path) {
    const res = await fetch(`${path}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`${path} を読み込めませんでした（HTTP ${res.status}）`);
    return res.json();
  }

  async function init() {
    bind();
    syncStickyTop();
    try {
      const [articles, cats] = await Promise.all([
        fetchJson("data/articles.json"),
        fetchJson("data/categories.json").catch(() => null),
      ]);
      state.articles = articles.articles || [];
      state.lastUpdated = articles.last_updated || "";
      state.categories = cats?.categories?.length
        ? cats.categories
        : [...new Map(state.articles.map((a) => [a.category, a])).values()].map((a) => ({
            id: a.category, name: a.category_label, label: a.category_label, emoji: "",
            keywords: [], exclude: [], feeds: [], lang: a.lang, notify: false, realtime: false,
          }));
      renderStamp();
      route();
    } catch (err) {
      $("#feed").innerHTML = `<div class="empty">データを読み込めませんでした<br><small>${esc(err.message)}</small></div>`;
    }
  }

  init();
})();
