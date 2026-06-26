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
from urllib.parse import quote

import requests
import yaml
try:
    from deep_translator import GoogleTranslator
    _translator_available = True
except ImportError:
    _translator_available = False

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
            title = strip_tags(item.findtext("title") or "")
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


def collect(config: dict) -> tuple[list[dict], dict]:
    existing = load_existing()
    seen_ids = {a["id"] for a in existing.get("articles", [])}

    new_articles: list[dict] = []
    now_str = datetime.now(JST).isoformat()

    categories: dict = config.get("categories", {})
    settings: dict = config.get("settings", {})
    max_per_kw: int = settings.get("max_articles_per_keyword", 8)

    for cat_id, cat_conf in categories.items():
        label: str = cat_conf.get("label", cat_id)
        lang: str = cat_conf.get("lang", "ja")
        keywords: list[str] = cat_conf.get("keywords", [])

        for keyword in keywords:
            print(f"  [{label}] {keyword}")
            raw_list = fetch_google_news(keyword, lang, max_per_kw)

            for raw in raw_list:
                art_id = make_id(raw["title"], raw["source"])
                if art_id not in seen_ids:
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
                            "keyword": keyword,
                            "first_seen": now_str,
                            "lang": lang,
                        }
                    )
                    seen_ids.add(art_id)

            time.sleep(1.0)  # Rate limit

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


def translate_en_titles(articles: list[dict]) -> list[dict]:
    """lang==en の記事タイトルを日本語に翻訳する"""
    if not _translator_available:
        print("[WARN] deep-translator 未インストール。翻訳スキップ。")
        return articles

    targets = [(i, a) for i, a in enumerate(articles) if a.get("lang") == "en"]
    if not targets:
        return articles

    titles = [a["title"] for _, a in targets]
    print(f"[INFO] 英語タイトル {len(titles)} 件を翻訳中...")

    try:
        translator = GoogleTranslator(source="en", target="ja")
        translated = translator.translate_batch(titles)

        result = list(articles)
        for (i, _), ja_title in zip(targets, translated):
            if ja_title and ja_title != titles[0]:
                orig = result[i]["title"]
                result[i] = {**result[i], "title": ja_title, "title_en": orig}
        return result

    except Exception as e:
        print(f"[WARN] 翻訳失敗: {e}")
        return articles


def prune(articles: list[dict], retention_days: int, max_total: int) -> list[dict]:
    cutoff = (datetime.now(JST) - timedelta(days=retention_days)).isoformat()
    recent = [a for a in articles if a.get("first_seen", "") >= cutoff]
    recent.sort(key=lambda a: a.get("first_seen", ""), reverse=True)
    return recent[:max_total]


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

    if new_articles:
        print("\n■ 英語タイトルを日本語翻訳中...")
        new_articles = translate_en_titles(new_articles)

    all_articles = existing.get("articles", []) + new_articles
    all_articles = prune(all_articles, retention_days, max_total)

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
        notify_ntfy(new_articles, config)

    print("\n" + "=" * 60)
    print("完了")
    print("=" * 60)


if __name__ == "__main__":
    main()
