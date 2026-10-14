"""
個人情報収集システム
カテゴリーごとに Google ニュース・RSS・Yahoo!リアルタイム検索から最新情報を集め、
ntfy で通知 + GitHub Pages 用 JSON を更新する

カテゴリーの設定は categories/<id>.yaml（1カテゴリー = 1ファイル）、
全体の設定は keywords.yaml にある。
"""

import email.utils
import hashlib
import html
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, unquote_plus

import requests
import yaml

JST = timezone(timedelta(hours=9))
DATA_FILE = Path("docs/data/articles.json")
CATEGORIES_JSON = Path("docs/data/categories.json")
KEYWORDS_FILE = Path("keywords.yaml")
CATEGORIES_DIR = Path("categories")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}


BROKEN_CATEGORIES: set[str] = set()  # 設定ファイルを読めなかったカテゴリー（記事は消さずに残す）


def load_categories(directory: Path = CATEGORIES_DIR) -> dict[str, dict]:
    """categories/*.yaml を読み、並び順（order → ファイル名）に並べて返す

    ファイル名（拡張子なし）がカテゴリー id になる。「_」で始まるファイルと
    読めないファイルは飛ばす（1ファイルの書き間違いで収集全体を止めないため）。
    """
    loaded = []
    for path in sorted(directory.glob("*.yaml")):
        if path.name.startswith("_"):
            continue
        try:
            conf = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            if not isinstance(conf, dict) or not conf.get("name"):
                raise ValueError("name がありません")
        except Exception as e:
            print(f"[WARN] カテゴリー設定を読めないためスキップ（記事は残します）: {path} ({e})")
            BROKEN_CATEGORIES.add(path.stem)
            continue
        emoji = str(conf.get("emoji") or "").strip()
        conf["label"] = f"{emoji} {conf['name']}".strip()
        loaded.append((conf.get("order", 999), path.stem, conf))
    loaded.sort(key=lambda t: (t[0], t[1]))
    return {cat_id: conf for _, cat_id, conf in loaded}


def load_config() -> dict:
    with open(KEYWORDS_FILE, encoding="utf-8") as f:
        config = yaml.safe_load(f) or {}
    config["categories"] = load_categories()
    return config


def save_categories_json(config: dict) -> None:
    """サイトのタブやカテゴリー管理画面で使うカテゴリー一覧を書き出す"""
    categories = []
    for cat_id, c in config["categories"].items():
        categories.append(
            {
                "id": cat_id,
                "name": c["name"],
                "emoji": c.get("emoji", ""),
                "label": c["label"],
                "lang": c.get("lang", "ja"),
                "notify": bool(c.get("notify", False)),
                "keywords": c.get("keywords") or [],
                "exclude": c.get("exclude") or [],
                "feeds": [
                    {"name": f.get("name", ""), "url": f.get("url", ""), "match": f.get("match") or []}
                    for f in (c.get("feeds") or [])
                ],
                "realtime": bool(c.get("yahoo_realtime")),
                "shop_pages": [
                    {"name": p.get("name", ""), "url": p.get("url", "")}
                    for p in (c.get("shop_pages") or []) if isinstance(p, dict)
                ],
                "x_accounts": [
                    {"id": a.get("id", ""), "name": a.get("name", "")}
                    for a in (c.get("x_accounts") or []) if isinstance(a, dict)
                ],
            }
        )
    CATEGORIES_JSON.parent.mkdir(parents=True, exist_ok=True)
    CATEGORIES_JSON.write_text(
        json.dumps({"categories": categories}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


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


def parse_date(date_str: str) -> str:
    """RSS / Atom の日付（RFC 822 か ISO 8601）を JST ISO 文字列に。読めなければ現在時刻"""
    date_str = (date_str or "").strip()
    if not date_str:
        return datetime.now(JST).isoformat()
    try:
        dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=JST)
        return dt.astimezone(JST).isoformat()
    except ValueError:
        return parse_rfc822(date_str)


def strip_source_suffix(title: str, source: str) -> str:
    """Google ニュースの見出し末尾に付く「 - 媒体名」を取り除く（媒体名は別に表示する）"""
    if source:
        for sep in (" - ", " – ", " | "):
            suffix = f"{sep}{source}"
            if title.endswith(suffix) and len(title) > len(suffix):
                return title[: -len(suffix)].rstrip()
    return title


def fetch_google_news(
    query: str, lang: str = "ja", max_items: int = 10, days: int = 7
) -> list[dict]:
    # when:Nd で直近 N 日の記事に絞る（指定しないと数か月前の記事も返ってくる）
    q = quote(f"{query} when:{days}d")
    if lang == "en":
        url = f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
    else:
        url = f"https://news.google.com/rss/search?q={q}&hl=ja&gl=JP&ceid=JP:ja"

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
            raw_title = title
            title = strip_source_suffix(title, source)

            # description からサマリーを抽出（最初の <a> タグ内テキストを除外）
            desc = strip_tags(item.findtext("description") or "")
            # Google News の description は "タイトル - ソース" 形式が多い
            summary = desc[:200] if len(desc) > len(title) + 5 else ""

            if title:
                articles.append(
                    {
                        "title": title,
                        # 末尾の「 - 媒体名」付きの見出し。以前はこちらで id を作っていたので照合に使う
                        "raw_title": raw_title,
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


def _local(tag: str) -> str:
    """名前空間を除いたタグ名（{http://...}title → title）"""
    return tag.rsplit("}", 1)[-1]


def _child_text(el: ET.Element, *names: str) -> str:
    """子要素のうち、names に挙げた最初のタグのテキストを返す（名前空間は無視）"""
    for name in names:
        for child in el:
            if _local(child.tag) == name:
                return (child.text or "").strip()
    return ""


def _entry_link(el: ET.Element) -> str:
    """RSS の <link>テキスト</link> と Atom の <link href="..."/> の両方に対応"""
    for child in el:
        if _local(child.tag) != "link":
            continue
        if child.get("href") and child.get("rel", "alternate") == "alternate":
            return child.get("href", "").strip()
        if (child.text or "").strip():
            return child.text.strip()
    return ""


def parse_feed(content: bytes) -> list[dict]:
    """RSS 2.0 / RSS 1.0 (RDF) / Atom を共通の形 {title, url, published, summary} にする"""
    root = ET.fromstring(content)
    items = []
    for el in root.iter():
        if _local(el.tag) not in ("item", "entry"):
            continue
        title = normalize_title(strip_tags(_child_text(el, "title")))
        url = _entry_link(el)
        if not title or not url.startswith("http"):
            continue
        items.append(
            {
                "title": title,
                "url": url,
                "published": parse_date(
                    _child_text(el, "pubDate", "date", "published", "updated")
                ),
                "summary": strip_tags(
                    _child_text(el, "description", "summary", "content")
                )[:200],
            }
        )
    return items


_feed_cache: dict[str, list[dict]] = {}


def fetch_feed_items(url: str) -> list[dict]:
    """RSS を取得する。同じ URL は1回の実行で1度だけ取りに行く（複数カテゴリーで共有）"""
    if url not in _feed_cache:
        try:
            resp = requests.get(url, headers=HEADERS, timeout=20)
            resp.raise_for_status()
            _feed_cache[url] = parse_feed(resp.content)
        except (requests.RequestException, ET.ParseError) as e:
            print(f"[ERROR] RSS の取得に失敗 ({url}): {e}")
            _feed_cache[url] = []
        time.sleep(1.0)  # Rate limit
    return _feed_cache[url]


def matches_any(text: str, patterns: list[str]) -> bool:
    """patterns のどれかに当てはまるか。空白区切りの語は「すべてを含む」とみなす

    例: ["日本酒 北海道", "酒蔵"] → (日本酒 かつ 北海道) または 酒蔵
    """
    text = text.lower()
    for pattern in patterns:
        words = str(pattern).lower().split()
        if words and all(w in text for w in words):
            return True
    return False


def fetch_feed(feed: dict) -> list[dict]:
    """カテゴリー設定の feeds 1件分を取得し、match で絞り込んで新しい順に返す"""
    items = fetch_feed_items(feed["url"])
    match = feed.get("match") or []
    if match:
        items = [i for i in items if matches_any(f"{i['title']} {i['summary']}", match)]
    items = sorted(items, key=lambda i: i["published"], reverse=True)
    name = feed.get("name") or feed["url"]
    return [
        {**i, "source": name, "keyword": feed.get("keyword") or name, "lang": feed.get("lang")}
        for i in items[: feed.get("limit", 10)]
    ]


# ── お店のネットショップ（MakeShop）の新着検知 ──────────────────

SHOP_STATE_FILE = Path("state/shop_pages.json")
SHOP_MEMORY_LIMIT = 3000      # ページごとに覚えておく商品・お知らせの数
SHOP_BASELINE_ITEMS = 5       # 初めて見るページでは、登録の新しい商品をこの数だけ載せる


def load_shop_state() -> dict:
    try:
        return json.loads(SHOP_STATE_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}


def save_shop_state(state: dict) -> None:
    SHOP_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    SHOP_STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")


def _decode_html(content: bytes) -> str:
    """meta の charset（MakeShop は EUC-JP が多い）に従って HTML を文字列にする"""
    m = re.search(rb'charset=["\']?([\w-]+)', content[:4000])
    charset = m.group(1).decode("ascii", "ignore") if m else "utf-8"
    try:
        return content.decode(charset, errors="replace")
    except LookupError:
        return content.decode("utf-8", errors="replace")


def parse_makeshop_page(text: str, base_url: str) -> tuple[list[dict], list[dict]]:
    """MakeShop のページから (商品, お知らせ) を取り出す

    商品: /shopdetail/<番号>/ へのリンク（番号は登録が新しいほど大きい）
    お知らせ: /new/YYYY-MM-DD-*.html へのリンク（日付つき）
    """
    root = re.match(r"https?://[^/]+", base_url).group(0)
    absolute = lambda href: href if href.startswith("http") else root + "/" + href.lstrip("/")

    products: dict[str, dict] = {}
    for m in re.finditer(r'<a[^>]+href="([^"]*shopdetail/(\d+)[^"]*)"[^>]*>(.*?)</a>', text, re.S):
        href, num, inner = m.groups()
        alt = re.search(r'alt="([^"]*)"', inner)
        name = strip_tags(alt.group(1) if alt and alt.group(1).strip() else inner)
        name = " ".join(name.split())
        if name and num not in products:
            products[num] = {"key": num, "title": name, "url": absolute(href)}

    news: dict[str, dict] = {}
    for m in re.finditer(r'<a[^>]+href="([^"]*/new/(\d{4}-\d{2}-\d{2})-\d+\.html)"[^>]*>(.*?)</a>', text, re.S):
        href, day, inner = m.groups()
        title = " ".join(strip_tags(inner).split())
        url = absolute(href)
        if title and url not in news:
            news[url] = {"key": url, "title": title, "url": url, "published": parse_date(f"{day}T09:00:00+09:00")}
    return list(products.values()), list(news.values())


def fetch_shop_page(page: dict, state: dict) -> list[dict]:
    """お店のページを見て、前回までに無かった商品・お知らせを新着として返す

    初めて見るページは、今ある商品を覚えるだけにして、登録の新しい数件と
    直近のお知らせだけを載せる（既存の全商品を「新着」にしないため）。
    """
    url, name = page["url"], page.get("name") or page["url"]
    try:
        resp = requests.get(url, headers=HEADERS, timeout=25)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"[ERROR] お店のページの取得に失敗 ({name}): {e}")
        return []
    products, news = parse_makeshop_page(_decode_html(resp.content), url)
    if not products and not news:
        print(f"[WARN] {name}: 商品・お知らせが見つかりません（ページの作りが変わった可能性）")
        return []

    memory = state.get(url)
    first_time = memory is None
    memory = memory or {"products": [], "news": []}
    known_products, known_news = set(memory["products"]), set(memory["news"])
    now = datetime.now(JST).isoformat()
    news_match = page.get("news_match") or []
    # products: false のお店は商品一覧を見ない（トップページに定番品しか並ばないお店など）
    watch_products = page.get("products", True)

    if not watch_products:
        new_products = []
    elif first_time:
        new_products = sorted(products, key=lambda p: int(p["key"]), reverse=True)[:SHOP_BASELINE_ITEMS]
    else:
        new_products = [p for p in products if p["key"] not in known_products]
    new_news = [n for n in news if n["key"] not in known_news]
    if news_match:
        new_news = [n for n in new_news if matches_any(n["title"], news_match)]

    memory["products"] = (memory["products"] + [p["key"] for p in products if p["key"] not in known_products])[-SHOP_MEMORY_LIMIT:]
    memory["news"] = (memory["news"] + [n["key"] for n in news if n["key"] not in known_news])[-SHOP_MEMORY_LIMIT:]
    state[url] = memory

    items = [
        {"title": p["title"], "url": p["url"], "published": now, "summary": "", "keyword": "新商品"}
        for p in new_products
    ] + [
        {"title": n["title"], "url": n["url"], "published": n["published"], "summary": "", "keyword": "お知らせ"}
        for n in new_news
    ]
    for item in items:
        item["source"] = name
    print(f"[INFO] {name}: 商品 {len(products)} 件・お知らせ {len(news)} 件を確認 → 新着 {len(items)} 件"
          + ("（初回のため最近の分のみ）" if first_time else ""))
    return items


# ── 同じ話題の記事をまとめる ──────────────────────────────────

def story_key(title: str) -> str:
    """話題の比較用に見出しを正規化する（記号・空白を除き、小文字にする）"""
    title = re.sub(r"【[^】]*】|\[[^\]]*\]", "", title)
    return re.sub(r"[\W_]+", "", title).lower()


@lru_cache(maxsize=8192)
def _bigrams(text: str) -> frozenset[str]:
    return frozenset(text[i : i + 2] for i in range(len(text) - 1))


def is_realtime(article: dict) -> bool:
    """Yahoo!リアルタイム検索の項目か（急上昇ワード・X 投稿は記事とまとめない）"""
    return str(article.get("source", "")).startswith("Yahoo!リアルタイム検索")


def is_duplicate_of(head: dict, head_key: str, item: dict, item_key: str) -> bool:
    """item が head と同じ話題の別媒体の記事か

    同じ媒体の似た見出し（「日経平均 週間」のような定期記事や続報）は別の記事として残す。
    """
    if head.get("source") == item.get("source") and head_key != item_key:
        return False
    return same_story(head_key, item_key)


def same_story(a: str, b: str, threshold: float = 0.6) -> bool:
    """正規化した見出し同士が同じ話題か（文字の2-gram の重なりで判定）

    短い見出し（急上昇ワードなど）は別の話題でも重なりやすいので対象にしない。
    """
    if len(a) < 12 or len(b) < 12:
        return False
    if a == b:
        return True
    ga, gb = _bigrams(a), _bigrams(b)
    return len(ga & gb) / len(ga | gb) >= threshold


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


def fetch_x_accounts(accounts: list, match: list[str]) -> list[dict]:
    """指定した X アカウントの最近の投稿を Yahoo!リアルタイム検索（ID:アカウント）経由で取得する

    酒屋の入荷情報のように「特定のお店の発信」を追うためのもの。match があれば、
    その語を含む投稿だけを取り込む（営業案内などを除くため）。
    """
    articles: list[dict] = []
    for n, acct in enumerate(accounts or []):
        if not isinstance(acct, dict) or not re.fullmatch(r"[A-Za-z0-9_]{1,15}", str(acct.get("id", ""))):
            print(f"[WARN] X アカウントの指定が正しくないためスキップ: {acct}")
            continue
        acct_id = acct["id"]
        name = acct.get("name") or f"@{acct_id}"
        if n:
            time.sleep(1.5)  # 相手サーバーへの負荷を抑える
        page = fetch_realtime_page("/realtime/search", {"p": f"ID:{acct_id}", "ei": "UTF-8"})
        if not page:
            continue
        posts = [
            e for e in (page.get("timeline") or {}).get("entry") or []
            if isinstance(e, dict)
            and str(e.get("screenName", "")).lower() == acct_id.lower()
            and (not match or matches_any(str(e.get("displayText", "")), match))
        ]
        for article in _convert_all(posts, _post_to_article, name):
            article["source"] = f"{name}（X）"
            article["summary"] = ""
            # お店の投稿はハッシュタグが多く見出しが読みにくいので取り除く
            article["title"] = re.sub(r"\s*[#＃]\S+", "", article["title"]).strip()
            articles.append(article)
    print(f"[INFO] X のお店の投稿: {len(articles)} 件取得")
    return articles


def fetch_yahoo_realtime(conf: dict) -> list[dict]:
    """Yahoo!リアルタイム検索から「バズ」「炎上」の話題を集める

    - 急上昇ワード: トップページの急上昇ワード。否定的な投稿が多いものは「炎上」扱い
    - 話題まとめ:   Yahoo が投稿を要約した、いま話題のトピック
    - 炎上の人気投稿: 指定した検索語を含む、直近24時間でいいね数の多い投稿

    ページの形式が変わっても例外は外に出さず、取れた分だけ返す。
    """
    articles: list[dict] = []

    # ── 急上昇ワード（トップページ） ──
    top = fetch_realtime_page("/realtime") if conf.get("trend_words") else None
    if top:
        trend = top.get("buzzTrend") or {}
        min_tweets = conf.get("trend_min_tweets", 100)
        items = [
            i for i in (trend.get("items") or [])
            if isinstance(i, dict) and _num(i.get("tweetCount")) >= min_tweets
        ][: conf["trend_words"]]
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


MAX_RELATED = 10   # 1件の記事にまとめる他媒体の最大数
STORY_WINDOW_DAYS = 3   # この日数以内の記事と同じ話題かを照合する


MAX_MERGED_IDS = 50


def remember_merged(article: dict, item_id: str) -> None:
    """まとめた記事の id を覚えておく（照合期間を過ぎて同じ記事が届いても取り込まないため）"""
    merged = article.setdefault("merged_ids", [])
    if item_id and item_id not in merged and len(merged) < MAX_MERGED_IDS:
        merged.append(item_id)


def attach_related(article: dict, raw: dict) -> bool:
    """同じ話題の別媒体を related に足す。既に同じ媒体があれば何もしない"""
    related = article.setdefault("related", [])
    sources = {article["source"], *(r["source"] for r in related)}
    if raw["source"] in sources or len(related) >= MAX_RELATED:
        return False
    related.append({"source": raw["source"], "url": raw["url"]})
    return True


def exclude_words(config: dict, cat_id: str) -> list[str]:
    """全体とカテゴリーの除外ワードを合わせた一覧"""
    cat_conf = config.get("categories", {}).get(cat_id, {})
    return (config.get("exclude") or []) + (cat_conf.get("exclude") or [])


def is_excluded(article: dict, config: dict) -> bool:
    words = exclude_words(config, article["category"])
    text = f"{article.get('title_en', '')} {article['title']} {article.get('summary', '')}"
    return bool(words) and matches_any(text, words)


def consolidate(articles: list[dict]) -> list[dict]:
    """保存済みの記事のうち、同じ話題の重複を最初に集めた1件にまとめる

    取り込み時にもまとめているが、照合期間の外で入った記事や、この仕組みより前に
    保存された記事にも重複が残るため、毎回まとめ直す（何度実行しても結果は同じ）。
    """
    span = timedelta(days=STORY_WINDOW_DAYS)
    heads: dict[str, list[tuple[str, datetime, dict]]] = {}
    merged_ids: set[str] = set()

    for a in sorted(articles, key=lambda x: x.get("first_seen", "")):
        if is_realtime(a):
            continue
        key = story_key(a.get("title_en") or a["title"])
        try:
            seen_at = datetime.fromisoformat(a["first_seen"])
        except (KeyError, ValueError):
            continue
        group = heads.setdefault(a["category"], [])
        head = next(
            (h for k, t, h in group if seen_at - t <= span and is_duplicate_of(h, k, a, key)),
            None,
        )
        if head is None:
            group.append((key, seen_at, a))
            continue
        attach_related(head, a)
        for r in a.get("related", []):
            attach_related(head, r)
        for item_id in [a["id"], *a.get("merged_ids", [])]:
            remember_merged(head, item_id)
        merged_ids.add(a["id"])

    if merged_ids:
        print(f"[INFO] 保存済みの重複 {len(merged_ids)} 件を同じ話題の記事にまとめました")
    return [a for a in articles if a["id"] not in merged_ids]


def gather(
    cat_conf: dict, label: str, settings: dict, shop_state: dict
) -> list[tuple[str, list[dict]]]:
    """カテゴリー1件分の情報源をすべて取得し、(キーワード, 取得結果) の組で返す"""
    lang: str = cat_conf.get("lang", "ja")
    max_per_kw: int = settings.get("max_articles_per_keyword", 8)
    days: int = settings.get("retention_days", 7)

    batches: list[tuple[str, list[dict]]] = []
    if cat_conf.get("yahoo_realtime"):
        print(f"  [{label}] Yahoo!リアルタイム検索")
        batches.append(("", fetch_yahoo_realtime(cat_conf["yahoo_realtime"])))
    for keyword in cat_conf.get("keywords") or []:
        print(f"  [{label}] {keyword}")
        batches.append((keyword, fetch_google_news(keyword, lang, max_per_kw, days)))
        time.sleep(1.0)  # Rate limit
    if cat_conf.get("x_accounts"):
        print(f"  [{label}] X: " + "、".join(str(a.get("name") or a.get("id")) for a in cat_conf["x_accounts"] if isinstance(a, dict)))
        batches.append(("", fetch_x_accounts(cat_conf["x_accounts"], cat_conf.get("x_match") or [])))
    for page in cat_conf.get("shop_pages") or []:
        if not isinstance(page, dict) or not str(page.get("url", "")).startswith("https://"):
            continue
        print(f"  [{label}] お店のページ: {page.get('name') or page['url']}")
        batches.append(("", fetch_shop_page(page, shop_state)))
        time.sleep(1.0)  # Rate limit
    for feed in cat_conf.get("feeds") or []:
        if not isinstance(feed, dict) or not str(feed.get("url", "")).startswith("http"):
            continue
        print(f"  [{label}] RSS: {feed.get('name') or feed['url']}")
        batches.append(("", fetch_feed(feed)))
    return batches


def collect(config: dict) -> tuple[list[dict], dict, dict]:
    """(新着の記事, 保存済みのデータ, お店のページの記録) を返す"""
    existing = load_existing()
    shop_state = load_shop_state()
    # 既存記事の見出しを先に直しておき、今回取得した同じ記事と id をそろえる
    existing["articles"] = consolidate(
        dedupe([repair_title(a) for a in existing.get("articles", [])])
    )
    seen_ids = {a["id"] for a in existing["articles"]}
    for a in existing["articles"]:
        seen_ids.update(a.get("merged_ids", []))

    now = datetime.now(JST)
    now_str = now.isoformat()
    settings: dict = config.get("settings", {})
    cutoff = (now - timedelta(days=settings.get("retention_days", 7))).isoformat()

    # 同じ話題の照合先: カテゴリーごとに直近の記事の (正規化した見出し, 記事)
    window = (now - timedelta(days=STORY_WINDOW_DAYS)).isoformat()
    pool: dict[str, list[tuple[str, dict]]] = {}
    for a in existing["articles"]:
        if a.get("first_seen", "") >= window and not is_realtime(a):
            key = story_key(a.get("title_en") or a["title"])
            pool.setdefault(a["category"], []).append((key, a))

    new_articles: list[dict] = []
    counts = {"excluded": 0, "old": 0, "merged": 0}

    for cat_id, cat_conf in config.get("categories", {}).items():
        label: str = cat_conf["label"]
        exclude = exclude_words(config, cat_id)

        for keyword, raw_list in gather(cat_conf, label, settings, shop_state):
            for raw in raw_list:
                art_id = make_id(raw["title"], raw["source"])
                legacy_id = make_id(raw.get("raw_title") or raw["title"], raw["source"])
                if art_id in seen_ids or legacy_id in seen_ids:
                    continue

                if raw["published"] < cutoff:
                    counts["old"] += 1
                    continue
                # 除外はこのカテゴリーだけの判断。同じ記事が別カテゴリーに入るのは妨げない
                if exclude and matches_any(f"{raw['title']} {raw.get('summary', '')}", exclude):
                    counts["excluded"] += 1
                    continue
                seen_ids.add(art_id)

                key = story_key(raw["title"])
                twin = None if is_realtime(raw) else next(
                    (a for k, a in pool.get(cat_id, []) if is_duplicate_of(a, k, raw, key)),
                    None,
                )
                if twin is not None:
                    if attach_related(twin, raw):
                        counts["merged"] += 1
                    remember_merged(twin, art_id)
                    continue

                article = {
                    "id": art_id,
                    "title": raw["title"],
                    "url": raw["url"],
                    "source": raw["source"],
                    "published": raw["published"],
                    "summary": raw.get("summary", ""),
                    "category": cat_id,
                    "category_label": label,
                    "keyword": raw.get("keyword") or keyword,
                    "first_seen": now_str,
                    "lang": raw.get("lang") or cat_conf.get("lang", "ja"),
                }
                new_articles.append(article)
                if not is_realtime(article):
                    pool.setdefault(cat_id, []).append((key, article))

    print(
        f"[INFO] 除外ワードで除外 {counts['excluded']} 件 / 古い記事 {counts['old']} 件 / "
        f"同じ話題として他媒体にまとめた {counts['merged']} 件"
    )
    return new_articles, existing, shop_state


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
    """保持期間を過ぎた記事と、無くなったカテゴリーの記事を消し、件数の上限に収める

    カテゴリに max_articles があればその件数までに抑える。件数の多いカテゴリが
    全体の上限を埋めて、ほかのカテゴリが保持期間より早く消えるのを防ぐため。
    """
    categories: dict = config.get("categories", {})
    cutoff = (datetime.now(JST) - timedelta(days=retention_days)).isoformat()
    # 削除されたカテゴリーの記事もここで消える（設定を読めなかっただけのカテゴリーは残す）
    recent = [
        a for a in articles
        if a.get("first_seen", "") >= cutoff
        and (a.get("category") in categories or a.get("category") in BROKEN_CATEGORIES)
    ]
    recent.sort(key=lambda a: a.get("first_seen", ""), reverse=True)

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
    # --fast: fast: true のカテゴリー（酒屋の入荷情報など）だけを集める。
    # 30分ごとの確認用で、新着が無ければ何も保存しない（無駄なコミットを作らない）
    fast = "--fast" in sys.argv[1:]
    now_str = datetime.now(JST).strftime("%Y-%m-%d %H:%M JST")
    print("=" * 60)
    print(f"個人情報収集システム 開始  {now_str}" + ("（すぐ知りたいカテゴリーのみ）" if fast else ""))
    print("=" * 60)

    config = load_config()
    settings = config.get("settings", {})
    retention_days: int = settings.get("retention_days", 7)
    max_total: int = settings.get("max_total_articles", 800)

    target = config
    if fast:
        target = {**config, "categories": {k: c for k, c in config["categories"].items() if c.get("fast")}}
        if not target["categories"]:
            print("[INFO] fast: true のカテゴリーがありません。終了します。")
            return

    print("\n■ 記事収集中...")
    new_articles, existing, shop_state = collect(target)
    print(f"\n[INFO] 新着: {len(new_articles)} 件")
    # お店のページで見た商品は、新着の有無にかかわらず覚えておく（次回の「新着」判定に使う）
    save_shop_state(shop_state)
    if fast and not new_articles:
        print("[INFO] 新着なし。記事は保存せずに終了します。")
        return

    all_articles = existing.get("articles", []) + new_articles
    all_articles = prune(all_articles, retention_days, max_total, config)
    # 除外ワードは保存済みの記事にも当てる（後から除外ワードを足したときにすぐ消えるように）
    kept = [a for a in all_articles if not is_excluded(a, config)]
    if len(kept) < len(all_articles):
        print(f"[INFO] 除外ワードに当たる保存済みの記事 {len(all_articles) - len(kept)} 件を削除")
    all_articles = kept
    # カテゴリー名を変えた場合に、既存記事の表示名も合わせる
    for a in all_articles:
        if a["category"] in config["categories"]:
            a["category_label"] = config["categories"][a["category"]]["label"]

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
    save_categories_json(config)
    print(f"[INFO] 保存完了: 合計 {len(all_articles)} 件 → {DATA_FILE}")

    # 追加したばかりのカテゴリー（保存済みの記事がまだ無い）は、最初の取り込み分を通知しない
    # （1週間分の記事がまとめて「新着」になり、通知が大量に届くのを防ぐため）
    known_categories = {a["category"] for a in existing.get("articles", [])}
    to_notify = [a for a in new_articles if a["category"] in known_categories]
    if len(to_notify) < len(new_articles):
        print(f"[INFO] 追加したばかりのカテゴリーの {len(new_articles) - len(to_notify)} 件は通知しません")

    if to_notify:
        print("\n■ ntfy 通知...")
        # 翻訳後のタイトルで通知するため all_articles から新着分を引き直す
        new_ids = {a["id"] for a in to_notify}
        notify_ntfy([a for a in all_articles if a["id"] in new_ids], config)

    print("\n" + "=" * 60)
    print("完了")
    print("=" * 60)


if __name__ == "__main__":
    main()
