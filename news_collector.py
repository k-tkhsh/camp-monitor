"""
個人情報収集システム
Google News RSS から各カテゴリの最新情報を収集し、
ntfy で通知 + GitHub Pages 用 JSON を更新する
"""

import email.utils
import hashlib
import html
import json
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote, unquote_plus

import requests
import yaml

JST = timezone(timedelta(hours=9))
DATA_FILE = Path("docs/data/articles.json")
KEYWORDS_FILE = Path("keywords.yaml")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}


def load_config() -> dict:
    with open(KEYWORDS_FILE, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_existing() -> dict:
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[WARN] articles.json 読み込みエラー: {e}")
    return {"last_updated": "", "articles": []}


def save_data(data: dict) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def make_id(title: str, source: str) -> str:
    return hashlib.md5(f"{title}::{source}".encode()).hexdigest()


def strip_tags(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text).strip()


def normalize_title(title: str) -> str:
    """URL エンコードされたまま配信された見出し（a+b+c%E2%80%99t 形式）を元に戻す

    途中で改行できない長い文字列になり、画面幅を押し広げる原因になるため。
    エンコード済みの見出しは ASCII だけで書かれているので、日本語を含む
    見出し（「ドコモ+ahamo+povo」や「50%OFF」など）は対象にしない。
    """
    if not title.isascii():
        return title
    encoded = len(re.findall(r"%[0-9A-Fa-f]{2}", title)) >= 2
    plus_joined = " " not in title and title.count("+") >= 3
    return unquote_plus(title) if encoded or plus_joined else title


def repair_title(article: dict) -> dict:
    """過去に取り込んだ URL エンコード済みの見出しを直し、再翻訳の対象に戻す

    英語記事は翻訳済みだと原文が title_en 側にあるので、そちらも調べる。
    id も直した見出しで作り直し、次回の取得分と同じ記事として扱えるようにする。
    """
    original = article.get("title_en") or article["title"]
    fixed = normalize_title(original)
    if fixed == original:
        return article
    repaired = {**article, "title": fixed, "id": make_id(fixed, article["source"])}
    repaired.pop("title_en", None)
    return repaired


def dedupe(articles: list[dict]) -> list[dict]:
    """同じ記事（原文の見出し＋情報源が同じ）は最初に見つかった1件だけ残す

    id ではなく原文から判定する。id の作り方が過去と違う記事も重複とみなすため。
    """
    seen: set[str] = set()
    result = []
    for a in articles:
        key = make_id(a.get("title_en") or a["title"], a["source"])
        if key not in seen:
            seen.add(key)
            result.append(a)
    return result


def parse_rfc822(date_str: str) -> str:
    """RFC 822 日付文字列を JST ISO 文字列に変換"""
    try:
        dt = email.utils.parsedate_to_datetime(date_str)
        return dt.astimezone(JST).isoformat()
    except Exception:
        return datetime.now(JST).isoformat()


def fetch_google_news(query: str, lang: str = "ja", max_items: int = 10) -> list[dict]:
    if lang == "en":
        url = (
            "https://news.google.com/rss/search"
            f"?q={quote(query)}&hl=en-US&gl=US&ceid=US:en"
        )
    else:
        url = (
            "https://news.google.com/rss/search"
            f"?q={quote(query)}&hl=ja&gl=JP&ceid=JP:ja"
        )

    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()

        root = ET.fromstring(resp.content)
        channel = root.find("channel")
        if channel is None:
            return []

        feed_title = (channel.findtext("title") or "Google News").strip()
        articles = []

        for item in list(channel.iter("item"))[:max_items]:
            title = normalize_title(strip_tags(item.findtext("title") or ""))
            link = item.findtext("link") or ""
            pub_str = item.findtext("pubDate") or ""
            published = parse_rfc822(pub_str) if pub_str else datetime.now(JST).isoformat()

            # ソース名: <source> タグ優先、なければフィードタイトル
            src_el = item.find("source")
            source = (src_el.text or "").strip() if src_el is not None else feed_title

            # description からサマリーを抽出（最初の <a> タグ内テキストを除外）
            desc = strip_tags(item.findtext("description") or "")
            # Google News の description は "タイトル - ソース" 形式が多い
            summary = desc[:200] if len(desc) > len(title) + 5 else ""

            if title:
                articles.append(
                    {
                        "title": title,
                        "url": link,
                        "source": source,
                        "published": published,
                        "summary": summary,
                    }
                )

        return articles

    except requests.RequestException as e:
        print(f"[ERROR] HTTP エラー '{query}': {e}")
        return []
    except ET.ParseError as e:
        print(f"[ERROR] XML パースエラー '{query}': {e}")
        return []


YAHOO_RT_BASE = "https://search.yahoo.co.jp"
_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S
)


def fetch_realtime_page(path: str, params: dict | None = None) -> dict | None:
    """Yahoo!リアルタイム検索のページを取得し、ページに埋め込まれた pageData を返す

    取得や解析に失敗したら None を返す（レイアウト変更などで収集全体を止めないため）。
    """
    url = f"{YAHOO_RT_BASE}{path}"
    try:
        resp = requests.get(
            url,
            params=params,
            headers={**HEADERS, "Accept-Language": "ja"},
            timeout=20,
        )
        resp.raise_for_status()
        match = _NEXT_DATA_RE.search(resp.text)
        if not match:
            print(f"[WARN] Yahoo!リアルタイム検索: データが見つかりません ({path})")
            return None
        return json.loads(match.group(1))["props"]["pageProps"]["pageData"]
    except (requests.RequestException, ValueError, KeyError) as e:
        print(f"[ERROR] Yahoo!リアルタイム検索の取得に失敗 ({path}): {e}")
        return None


def _abs_yahoo_url(url: str) -> str:
    return url if url.startswith("http") else f"{YAHOO_RT_BASE}{url}"


def _epoch_to_jst(epoch) -> str:
    """UNIX 時刻（秒・ミリ秒・文字列）を JST ISO 文字列に。読めなければ現在時刻"""
    try:
        value = float(epoch)
        if value > 1e11:  # ミリ秒で来た場合
            value /= 1000
        return datetime.fromtimestamp(value, JST).isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return datetime.now(JST).isoformat()


def _clean_tweet_text(text: str, limit: int = 110) -> str:
    """検索語の強調マーカー・URL・返信先を取り除き、見出し向けに短くする"""
    text = text.replace("\tSTART\t", "").replace("\tEND\t", "")
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"^(?:@\w+\s+)+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def _num(value) -> int:
    """件数などの数値を int に。欠けていたり形式が違ったりすれば 0"""
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _trend_to_article(item: dict, published: str, enjo_pct: int) -> dict:
    negative = _num(item.get("negative"))
    parts = [item["genre"]] if item.get("genre") else []
    parts.append(f"ツイート {_num(item.get('tweetCount')):,}件")
    if negative:
        parts.append(f"否定的な投稿 {negative}%")
    summary = "・".join(parts)
    related = "、".join(str(w) for w in (item.get("childBuzz") or [])[:5])
    if related:
        summary += f" ／ 関連: {related}"
    return {
        "title": str(item["query"]),
        "url": _abs_yahoo_url(item["url"]),
        "source": "Yahoo!リアルタイム検索 急上昇ワード",
        "published": published,
        "summary": summary,
        "keyword": "炎上" if negative >= enjo_pct else "急上昇ワード",
    }


def _matome_to_article(m: dict) -> dict:
    return {
        "title": str(m["title"]),
        "url": _abs_yahoo_url(m["url"]),
        "source": "Yahoo!リアルタイム検索 話題まとめ",
        "published": _epoch_to_jst(m.get("createdAt")),
        "summary": str(m.get("summary") or "")[:200],
        "keyword": "話題まとめ",
    }


def _post_to_article(e: dict, keyword: str) -> dict:
    return {
        "title": _clean_tweet_text(e["displayText"]),
        "url": e["url"],
        "source": "Yahoo!リアルタイム検索 X投稿",
        "published": _epoch_to_jst(e.get("createdAt")),
        "summary": (
            f"いいね {_num(e.get('likesCount')):,}・リポスト {_num(e.get('rtCount')):,}"
            f"・返信 {_num(e.get('replyCount')):,}"
        ),
        "keyword": keyword,
    }


def _convert_all(items, convert, *args) -> list[dict]:
    """1件ずつ変換し、形式が想定と違う項目は飛ばす（1件の不備で全体を止めない）"""
    result = []
    for item in items:
        try:
            article = convert(item, *args)
        except (KeyError, TypeError, ValueError, AttributeError) as e:
            print(f"[WARN] Yahoo!リアルタイム検索: 読めない項目をスキップ ({type(e).__name__}: {e})")
            continue
        if article["title"] and str(article["url"]).startswith("http"):
            result.append(article)
    return result


def fetch_yahoo_realtime(conf: dict) -> list[dict]:
    """Yahoo!リアルタイム検索から「バズ」「炎上」の話題を集める

    - 急上昇ワード: トップページの急上昇ワード。否定的な投稿が多いものは「炎上」扱い
    - 話題まとめ:   Yahoo が投稿を要約した、いま話題のトピック
    - 炎上の人気投稿: 指定した検索語を含む、直近24時間でいいね数の多い投稿

    ページの形式が変わっても例外は外に出さず、取れた分だけ返す。
    """
    articles: list[dict] = []

    # ── 急上昇ワード（トップページ） ──
    top = fetch_realtime_page("/realtime")
    if top:
        trend = top.get("buzzTrend") or {}
        min_tweets = conf.get("trend_min_tweets", 100)
        items = [
            i for i in (trend.get("items") or [])
            if isinstance(i, dict) and _num(i.get("tweetCount")) >= min_tweets
        ][: conf.get("trend_words", 12)]
        articles += _convert_all(
            items,
            _trend_to_article,
            _epoch_to_jst(trend.get("buzzTimestamp")),
            conf.get("enjo_negative_pct", 50),
        )

    # ── 検索語ごとの人気投稿 + 話題まとめ ──
    matome_done = False
    for n, search in enumerate(conf.get("searches", [])):
        keyword = search["keyword"]
        if n:
            time.sleep(1.5)  # 相手サーバーへの負荷を抑える
        # md=h: 話題順（直近24時間でいいね数の多い順）
        page = fetch_realtime_page(
            "/realtime/search", {"p": keyword, "ei": "UTF-8", "md": "h"}
        )
        if not page:
            continue

        if not matome_done and conf.get("matome", 0):
            items = (page.get("buzzMatomeList") or {}).get("items") or []
            articles += _convert_all(items[: conf["matome"]], _matome_to_article)
            matome_done = True

        min_likes = search.get("min_likes", 1000)
        posts = [
            e
            for e in (page.get("timeline") or {}).get("entry") or []
            if isinstance(e, dict)
            and _num(e.get("likesCount")) >= min_likes
            and "\tSTART\t" in str(e.get("displayText", ""))
        ]
        posts.sort(key=lambda e: _num(e.get("likesCount")), reverse=True)
        articles += _convert_all(posts[: search.get("limit", 8)], _post_to_article, keyword)

    print(f"[INFO] Yahoo!リアルタイム検索: {len(articles)} 件取得")
    return articles


def collect(config: dict) -> tuple[list[dict], dict]:
    existing = load_existing()
    # 既存記事の見出しを先に直しておき、今回取得した同じ記事と id をそろえる
    existing["articles"] = dedupe(
        [repair_title(a) for a in existing.get("articles", [])]
    )
    seen_ids = {a["id"] for a in existing["articles"]}

    new_articles: list[dict] = []
    now_str = datetime.now(JST).isoformat()

    categories: dict = config.get("categories", {})
    settings: dict = config.get("settings", {})
    max_per_kw: int = settings.get("max_articles_per_keyword", 8)

    for cat_id, cat_conf in categories.items():
        label: str = cat_conf.get("label", cat_id)
        lang: str = cat_conf.get("lang", "ja")

        # (キーワード, 取得結果) の組を集める。取得元はカテゴリごとに切り替える
        batches: list[tuple[str, list[dict]]] = []
        if cat_conf.get("source") == "yahoo_realtime":
            print(f"  [{label}] Yahoo!リアルタイム検索")
            batches.append(("", fetch_yahoo_realtime(cat_conf.get("realtime", {}))))
        else:
            for keyword in cat_conf.get("keywords", []):
                print(f"  [{label}] {keyword}")
                batches.append((keyword, fetch_google_news(keyword, lang, max_per_kw)))
                time.sleep(1.0)  # Rate limit

        for keyword, raw_list in batches:
            for raw in raw_list:
                art_id = make_id(raw["title"], raw["source"])
                if art_id in seen_ids:
                    continue
                new_articles.append(
                    {
                        "id": art_id,
                        "title": raw["title"],
                        "url": raw["url"],
                        "source": raw["source"],
                        "published": raw["published"],
                        "summary": raw["summary"],
                        "category": cat_id,
                        "category_label": label,
                        "keyword": raw.get("keyword") or keyword,
                        "first_seen": now_str,
                        "lang": lang,
                    }
                )
                seen_ids.add(art_id)

    return new_articles, existing


def notify_ntfy(new_articles: list[dict], config: dict) -> None:
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        print("[INFO] NTFY_TOPIC 未設定。通知スキップ。")
        return

    server: str = config.get("ntfy", {}).get("server", "https://ntfy.sh")
    categories: dict = config.get("categories", {})

    # カテゴリごとにまとめて通知
    by_cat: dict[str, list] = {}
    for art in new_articles:
        cat_id = art["category"]
        if categories.get(cat_id, {}).get("notify", False):
            by_cat.setdefault(cat_id, []).append(art)

    for cat_id, arts in by_cat.items():
        cat_conf = categories.get(cat_id, {})
        label: str = cat_conf.get("label", cat_id)
        priority: str = cat_conf.get("priority", "default")

        title_str = f"{label} 新着 {len(arts)}件"
        lines = [f"• {a['title'][:55]}" for a in arts[:5]]
        if len(arts) > 5:
            lines.append(f"...他 {len(arts) - 5} 件")
        body = "\n".join(lines)

        try:
            resp = requests.post(
                f"{server}/{topic}",
                data=body.encode("utf-8"),
                headers={
                    "Title": title_str.encode("utf-8"),
                    "Priority": priority,
                    "Tags": "newspaper",
                },
                timeout=10,
            )
            print(f"[INFO] ntfy 送信: {label} → HTTP {resp.status_code}")
        except Exception as e:
            print(f"[ERROR] ntfy 失敗 ({label}): {e}")


MAX_TRANSLATE_PER_RUN = 60


def _translate_google(text: str) -> str | None:
    """Google 翻訳の公開エンドポイントで翻訳する

    データセンター IP からは HTTP 429 で弾かれることが多いため、
    成功しなかった場合は None を返して呼び出し側でフォールバックさせる。
    """
    resp = requests.get(
        "https://translate.googleapis.com/translate_a/single",
        params={"client": "gtx", "sl": "en", "tl": "ja", "dt": "t", "q": text},
        headers=HEADERS,
        timeout=15,
    )
    if resp.status_code != 200:
        return None
    segments = resp.json()[0]
    return "".join(seg[0] for seg in segments if seg[0]) or None


def _translate_mymemory(text: str) -> str | None:
    """MyMemory で翻訳する（Google が使えないときのフォールバック）"""
    resp = requests.get(
        "https://api.mymemory.translated.net/get",
        params={"q": text, "langpair": "en|ja"},
        headers=HEADERS,
        timeout=20,
    )
    if resp.status_code != 200:
        return None
    body = resp.json()
    translated = (body.get("responseData") or {}).get("translatedText") or ""
    # 1日の無料枠を使い切ると警告文が訳文として返ってくるので弾く
    if body.get("quotaFinished") or "MYMEMORY WARNING" in translated.upper():
        return None
    return translated or None


TRANSLATORS = (("google", _translate_google), ("mymemory", _translate_mymemory))


def translate_en_titles(articles: list[dict]) -> list[dict]:
    """lang==en かつ未翻訳の記事タイトルを日本語に翻訳する

    翻訳先を順に試し、1件ずつ処理する。どの翻訳先でも失敗した記事は
    原文のまま残し、次回の実行で再挑戦する。
    """
    targets = [
        (i, a)
        for i, a in enumerate(articles)
        if a.get("lang") == "en" and "title_en" not in a
    ]
    if not targets:
        return articles

    total = len(targets)
    targets = targets[:MAX_TRANSLATE_PER_RUN]
    if total > len(targets):
        print(f"[INFO] 未翻訳 {total} 件中 {len(targets)} 件を今回翻訳（残りは次回）")
    else:
        print(f"[INFO] 英語タイトル {total} 件を翻訳中...")

    result = list(articles)
    ok = 0
    used: dict[str, int] = {}
    misses: dict[str, int] = {}
    # レート制限などで連続失敗する翻訳先は、その回の残りの記事では試さない
    give_up_after = 3

    for i, art in targets:
        orig = art["title"]
        for name, translate in TRANSLATORS:
            if misses.get(name, 0) >= give_up_after:
                continue
            try:
                ja_title = translate(orig)
            except Exception as e:
                print(f"[WARN] {name} 翻訳エラー: {type(e).__name__}: {e}")
                ja_title = None

            if ja_title:
                result[i] = {**art, "title": ja_title, "title_en": orig}
                used[name] = used.get(name, 0) + 1
                misses[name] = 0
                ok += 1
                break

            misses[name] = misses.get(name, 0) + 1
            if misses[name] == give_up_after:
                print(f"[WARN] {name} は応答しないため今回は以降スキップします")
        else:
            print(f"[WARN] 翻訳失敗（次回再挑戦）: {orig[:60]}")
        time.sleep(0.5)

    detail = "、".join(f"{k} {v}件" for k, v in used.items()) or "なし"
    print(f"[INFO] 翻訳完了: {ok}/{len(targets)} 件（内訳: {detail}）")
    return result


def prune(
    articles: list[dict], retention_days: int, max_total: int, config: dict
) -> list[dict]:
    """保持期間を過ぎた記事を消し、件数の上限に収める

    カテゴリに max_articles があればその件数までに抑える。件数の多いカテゴリが
    全体の上限を埋めて、ほかのカテゴリが保持期間より早く消えるのを防ぐため。
    """
    cutoff = (datetime.now(JST) - timedelta(days=retention_days)).isoformat()
    recent = [a for a in articles if a.get("first_seen", "") >= cutoff]
    recent.sort(key=lambda a: a.get("first_seen", ""), reverse=True)

    categories: dict = config.get("categories", {})
    kept: dict[str, int] = {}
    result = []
    for a in recent:
        cap = categories.get(a["category"], {}).get("max_articles")
        if cap is not None and kept.get(a["category"], 0) >= cap:
            continue
        kept[a["category"]] = kept.get(a["category"], 0) + 1
        result.append(a)
    return result[:max_total]


def main() -> None:
    now_str = datetime.now(JST).strftime("%Y-%m-%d %H:%M JST")
    print("=" * 60)
    print(f"個人情報収集システム 開始  {now_str}")
    print("=" * 60)

    config = load_config()
    settings = config.get("settings", {})
    retention_days: int = settings.get("retention_days", 7)
    max_total: int = settings.get("max_total_articles", 600)

    print("\n■ 記事収集中...")
    new_articles, existing = collect(config)
    print(f"\n[INFO] 新着: {len(new_articles)} 件")

    all_articles = existing.get("articles", []) + new_articles
    all_articles = prune(all_articles, retention_days, max_total, config)

    # 新着に加え、過去の未翻訳分もまとめて翻訳する
    print("\n■ 英語タイトルを日本語翻訳中...")
    all_articles = translate_en_titles(all_articles)

    output = {
        "last_updated": datetime.now(JST).isoformat(),
        "last_run_new_count": len(new_articles),
        "total_articles": len(all_articles),
        "articles": all_articles,
    }
    save_data(output)
    print(f"[INFO] 保存完了: 合計 {len(all_articles)} 件 → {DATA_FILE}")

    if new_articles:
        print("\n■ ntfy 通知...")
        # 翻訳後のタイトルで通知するため all_articles から新着分を引き直す
        new_ids = {a["id"] for a in new_articles}
        notify_ntfy([a for a in all_articles if a["id"] in new_ids], config)

    print("\n" + "=" * 60)
    print("完了")
    print("=" * 60)


if __name__ == "__main__":
    main()
