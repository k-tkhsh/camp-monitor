"""
Apple認定整備済品 iPhone 17 監視スクリプト
対象: Apple Japan 整備済品ストア iPhone 17 シリーズ
通知: Gmail (smtplib)
重複防止: iphone17_last_status.json
"""

import asyncio
import json
import os
import re
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from playwright.async_api import async_playwright

REFURBISHED_URL = "https://www.apple.com/jp/shop/refurbished/iphone"
STATUS_FILE = Path("iphone17_last_status.json")
TARGET_MODEL = "iPhone 17"

GMAIL_SENDER = os.environ.get("GMAIL_SENDER", "")
GMAIL_RECIPIENT = os.environ.get("GMAIL_RECIPIENT", "")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")


def load_last_products() -> set[str]:
    if STATUS_FILE.exists():
        try:
            data = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
            return set(data.get("products", []))
        except Exception as e:
            print(f"[WARN] ステータスファイル読み込みエラー: {e}")
    return set()


def save_products(products: list[dict]) -> None:
    STATUS_FILE.write_text(
        json.dumps(
            {"products": [p["name"] for p in products]},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"[INFO] ステータスを保存: {len(products)} 件")


async def fetch_iphone17_products() -> list[dict] | None:
    """Apple Japan 整備済品ストアから iPhone 17 の製品一覧を取得する。
    スクレイピング自体が失敗した場合は None を返す。
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            locale="ja-JP",
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()

        try:
            print(f"[INFO] Apple整備済品ページ取得中: {REFURBISHED_URL}")
            await page.goto(REFURBISHED_URL, timeout=60_000)
            await page.wait_for_load_state("networkidle", timeout=30_000)

            # ページ全体のテキストを確認
            page_text: str = await page.evaluate("() => document.body.innerText")

            if not page_text.strip():
                print("[ERROR] ページのテキストが空です")
                return None

            products: list[dict] = []

            # 製品タイルを複数セレクターで探す
            tile_selectors = [
                ".rf-refurbished-product",
                "[data-autom='refurbished-product-tile']",
                "[class*='refurb'][class*='product']",
                "[class*='product-tile']",
                "[class*='ProductTile']",
            ]

            tiles = []
            for selector in tile_selectors:
                tiles = await page.query_selector_all(selector)
                if tiles:
                    print(f"[INFO] セレクター '{selector}' で {len(tiles)} 件のタイルを発見")
                    break

            for tile in tiles:
                text = await tile.inner_text()
                if TARGET_MODEL not in text:
                    continue

                price_match = re.search(r"¥[\d,]+", text)
                price = price_match.group(0) if price_match else "価格不明"

                link_el = await tile.query_selector("a")
                href = await link_el.get_attribute("href") if link_el else ""
                url = (
                    f"https://www.apple.com{href}"
                    if href and href.startswith("/")
                    else (href or REFURBISHED_URL)
                )

                name_lines = [
                    line.strip() for line in text.split("\n") if TARGET_MODEL in line
                ]
                name = name_lines[0] if name_lines else TARGET_MODEL

                products.append({"name": name, "price": price, "url": url})
                print(f"[INFO] 検出: {name} / {price}")

            # タイルが取れなかった場合はページテキストから判定
            if not tiles and TARGET_MODEL in page_text:
                print("[INFO] ページテキストから iPhone 17 の記載を検出（タイル解析不可）")
                # 価格付き行を探す
                for line in page_text.split("\n"):
                    if TARGET_MODEL in line:
                        price_match = re.search(r"¥[\d,]+", line)
                        name = line.strip()[:80]
                        price = price_match.group(0) if price_match else "価格不明"
                        products.append({"name": name, "price": price, "url": REFURBISHED_URL})
                        print(f"[INFO] 検出（テキスト）: {name} / {price}")

            # 重複排除
            seen = set()
            unique_products = []
            for prod in products:
                if prod["name"] not in seen:
                    seen.add(prod["name"])
                    unique_products.append(prod)

            print(f"[INFO] iPhone 17 整備済品: {len(unique_products)} 件")
            return unique_products

        except Exception as e:
            print(f"[ERROR] スクレイピングエラー: {e}")
            return None
        finally:
            await browser.close()


def send_notification(new_products: list[dict]) -> None:
    if not all([GMAIL_SENDER, GMAIL_RECIPIENT, GMAIL_APP_PASSWORD]):
        print("[ERROR] Gmail環境変数が未設定")
        return

    product_lines = "\n".join(
        f"  ・{p['name']}  {p['price']}\n    {p['url']}"
        for p in new_products
    )
    subject = f"【Apple整備済品】iPhone 17 が {len(new_products)} 件入荷しました！"
    body = f"""Apple認定整備済品ストアに iPhone 17 シリーズが入荷しました！

■ 新着製品 ({len(new_products)} 件):
{product_lines}

■ ストアページ:
{REFURBISHED_URL}

※このメールは自動送信されています。
"""
    msg = MIMEMultipart()
    msg["From"] = GMAIL_SENDER
    msg["To"] = GMAIL_RECIPIENT
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain", "utf-8"))

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(GMAIL_SENDER, GMAIL_APP_PASSWORD)
            smtp.sendmail(GMAIL_SENDER, GMAIL_RECIPIENT, msg.as_string())
        print(f"[INFO] 通知メール送信完了 → {GMAIL_RECIPIENT}")
    except Exception as e:
        print(f"[ERROR] メール送信失敗: {e}")
        raise


async def main() -> None:
    print("=" * 50)
    print("Apple認定整備済品 iPhone 17 監視 開始")
    print("=" * 50)

    last_products = load_last_products()
    print(f"[INFO] 前回検出数: {len(last_products)} 件")

    current_products = await fetch_iphone17_products()

    if current_products is None:
        print("[WARN] ページ取得失敗。ステータス更新をスキップ。")
        print("=" * 50)
        print("監視終了（エラー）")
        print("=" * 50)
        return

    print(f"[INFO] 今回検出数: {len(current_products)} 件")

    current_names = {p["name"] for p in current_products}
    new_names = current_names - last_products

    if new_names:
        new_products = [p for p in current_products if p["name"] in new_names]
        print(f"[INFO] 新着 {len(new_products)} 件を検出！メール送信します。")
        for prod in new_products:
            print(f"  → {prod['name']} / {prod['price']}")
        send_notification(new_products)
    elif current_products:
        print("[INFO] 新着なし（既存製品と同じ）。通知スキップ。")
    else:
        print("[INFO] iPhone 17 整備済品なし。")

    save_products(current_products)

    print("=" * 50)
    print("監視終了")
    print("=" * 50)


if __name__ == "__main__":
    asyncio.run(main())
