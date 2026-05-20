"""
Nintendo Switch 2 本体 在庫監視スクリプト
対象: マイニンテンドーストア / Amazon.co.jp / 楽天ブックス / ヨドバシ.com /
      ビックカメラ / ジョーシン / ソフマップ
定価: 49,980円（税込）
通知: Gmail (smtplib) ※ 既存宛先 + horikayo1128@icloud.com
重複防止: switch2_last_status.json
"""

import asyncio
import json
import os
import re
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Optional

from playwright.async_api import async_playwright, BrowserContext

STATUS_FILE = Path("switch2_last_status.json")
TARGET_PRICE_YEN = 49980  # 定価（税込）
# 定価±10%を「定価付近」とみなす（転売価格を除外）
PRICE_TOLERANCE = 0.10

GMAIL_SENDER = os.environ.get("GMAIL_SENDER", "")
GMAIL_RECIPIENT = os.environ.get("GMAIL_RECIPIENT", "")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")

# 追加宛先（ユーザー指定）
ADDITIONAL_RECIPIENTS = ["horikayo1128@icloud.com"]

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# 監視対象サイト
SITES = [
    {
        "name": "マイニンテンドーストア",
        "url": "https://store-jp.nintendo.com/hardware-switch2-japan",
        "available_keywords": [
            "カートに入れる",
            "ご購入手続き",
            "今すぐ購入",
        ],
        "unavailable_keywords": [
            "現在販売しておりません",
            "販売停止",
            "入荷をお待ちください",
            "抽選販売",
            "完売",
            "在庫切れ",
            "SOLD OUT",
        ],
    },
    {
        "name": "Amazon.co.jp",
        "url": "https://www.amazon.co.jp/s?k=Nintendo+Switch+2+本体&i=videogames",
        "available_keywords": [
            "カートに入れる",
            "今すぐ買う",
        ],
        "unavailable_keywords": [
            "在庫切れ",
            "現在お取り扱いできません",
            "入荷時期は未定",
        ],
    },
    {
        "name": "楽天ブックス",
        "url": "https://books.rakuten.co.jp/search?sitem=Nintendo+Switch+2+本体&g=003",
        "available_keywords": [
            "カートに入れる",
            "在庫あり",
        ],
        "unavailable_keywords": [
            "予約受付終了",
            "ご注文できない商品",
            "在庫なし",
            "販売停止",
        ],
    },
    {
        "name": "ヨドバシ.com",
        "url": "https://www.yodobashi.com/?word=Nintendo+Switch+2+本体",
        "available_keywords": [
            "ご注文できる商品",
            "在庫あり",
            "お取り寄せ",
            "ショッピングカートに入れる",
        ],
        "unavailable_keywords": [
            "販売を終了しました",
            "現在ご注文をお受けできない商品",
            "予定数の販売を終了",
        ],
    },
    {
        "name": "ビックカメラ.com",
        "url": "https://www.biccamera.com/bc/category/search.jsp?q=Nintendo+Switch+2+本体",
        "available_keywords": [
            "カゴに入れる",
            "在庫あり",
        ],
        "unavailable_keywords": [
            "販売を終了",
            "予約受付終了",
            "現在お取り扱いできません",
            "在庫切れ",
        ],
    },
    {
        "name": "Joshin web",
        "url": "https://joshinweb.jp/_search.html?KEYWD=Nintendo+Switch+2+本体",
        "available_keywords": [
            "カートに入れる",
            "在庫有り",
        ],
        "unavailable_keywords": [
            "完売",
            "販売を終了",
            "予約受付終了",
        ],
    },
    {
        "name": "ソフマップ.com",
        "url": "https://www.sofmap.com/search_result/spm/searchall/Nintendo+Switch+2+本体",
        "available_keywords": [
            "カートに入れる",
            "在庫あり",
        ],
        "unavailable_keywords": [
            "販売終了",
            "在庫切れ",
            "予約受付終了",
        ],
    },
]


def load_last_status() -> dict:
    if STATUS_FILE.exists():
        try:
            return json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[WARN] ステータス読み込みエラー: {e}")
    return {}


def save_status(status: dict) -> None:
    STATUS_FILE.write_text(
        json.dumps(status, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[INFO] ステータス保存: {len(status)} 件")


def detect_target_price(text: str) -> Optional[int]:
    """ページテキストから定価（49,980円付近）を検出。見つかれば該当金額を返す。"""
    low = int(TARGET_PRICE_YEN * (1 - PRICE_TOLERANCE))
    high = int(TARGET_PRICE_YEN * (1 + PRICE_TOLERANCE))

    # ¥49,980 / 49,980円 / 49980円 などのパターン
    price_patterns = [
        r"¥\s*([\d,]+)",
        r"([\d,]+)\s*円",
        r"￥\s*([\d,]+)",
    ]
    for pattern in price_patterns:
        for match in re.finditer(pattern, text):
            price_str = match.group(1).replace(",", "")
            if not price_str.isdigit():
                continue
            price = int(price_str)
            if low <= price <= high:
                return price
    return None


async def check_site(context: BrowserContext, site: dict) -> dict:
    """1サイトを判定。戻り値: {name, url, status, price, detail}"""
    name = site["name"]
    url = site["url"]
    result = {
        "name": name,
        "url": url,
        "status": "unknown",
        "price": None,
        "detail": "",
    }
    page = await context.new_page()
    try:
        print(f"[INFO] 取得開始: {name} ({url})")
        await page.goto(url, timeout=45_000, wait_until="domcontentloaded")
        try:
            await page.wait_for_load_state("networkidle", timeout=15_000)
        except Exception:
            pass  # networkidle 待ちは best-effort

        # Switch 2 商品が言及されているか念のため確認
        page_text: str = await page.evaluate("() => document.body.innerText")
        if not page_text or len(page_text) < 50:
            result["status"] = "error"
            result["detail"] = "ページ取得失敗（テキスト空）"
            return result

        mentions_switch2 = bool(
            re.search(r"Switch\s*2|スイッチ\s*2|ニンテンドースイッチ\s*2", page_text, re.IGNORECASE)
        )
        if not mentions_switch2:
            result["status"] = "not_found"
            result["detail"] = "ページ内にSwitch 2の記載なし"
            return result

        # 価格検出
        price = detect_target_price(page_text)
        result["price"] = price

        # 在庫キーワード判定
        hit_available = next(
            (kw for kw in site["available_keywords"] if kw in page_text), None
        )
        hit_unavailable = next(
            (kw for kw in site["unavailable_keywords"] if kw in page_text), None
        )

        # 在庫あり判定: 在庫キーワードがヒット かつ 売り切れキーワードがヒットしない
        if hit_available and not hit_unavailable:
            result["status"] = "available"
            result["detail"] = f"在庫キーワード『{hit_available}』検出"
        elif hit_unavailable:
            result["status"] = "unavailable"
            result["detail"] = f"売切キーワード『{hit_unavailable}』検出"
        else:
            # キーワード未ヒットだが価格表示あり → 取扱中の可能性
            result["status"] = "unknown"
            result["detail"] = "在庫/売切キーワードともに未検出"

        print(
            f"[INFO] {name}: status={result['status']} "
            f"price={price if price else '不明'} {result['detail']}"
        )
        return result

    except Exception as e:
        print(f"[ERROR] {name} 取得失敗: {e}")
        result["status"] = "error"
        result["detail"] = str(e)[:200]
        return result
    finally:
        await page.close()


async def check_all_sites() -> list[dict]:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            locale="ja-JP",
            user_agent=USER_AGENT,
            extra_http_headers={"Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.5,en;q=0.3"},
        )
        try:
            results = []
            for site in SITES:
                res = await check_site(context, site)
                results.append(res)
                # サイト間で少し間隔を空ける（DoS防止 & 検知回避）
                await asyncio.sleep(2)
            return results
        finally:
            await browser.close()


def send_notification(new_available: list[dict]) -> None:
    if not all([GMAIL_SENDER, GMAIL_RECIPIENT, GMAIL_APP_PASSWORD]):
        print("[ERROR] Gmail環境変数が未設定（GMAIL_SENDER / GMAIL_RECIPIENT / GMAIL_APP_PASSWORD）")
        return

    recipients = [GMAIL_RECIPIENT] + ADDITIONAL_RECIPIENTS
    recipients = list(dict.fromkeys(r.strip() for r in recipients if r and r.strip()))

    lines = []
    for r in new_available:
        price_str = f"{r['price']:,}円" if r["price"] else "価格不明（要確認）"
        lines.append(
            f"  ・{r['name']}  {price_str}\n    {r['url']}\n    判定: {r['detail']}"
        )
    product_lines = "\n".join(lines)

    subject = f"【在庫入荷】Nintendo Switch 2 本体 {len(new_available)} 件検出！"
    body = f"""Nintendo Switch 2 本体の在庫が検出されました！

■ 定価（税込）: {TARGET_PRICE_YEN:,}円
■ 検出サイト ({len(new_available)} 件):
{product_lines}

※ ページのHTML構造変更により誤検知の可能性があります。
※ 必ずリンク先で価格・在庫を確認してください。
※ このメールは自動送信されています。
"""

    msg = MIMEMultipart()
    msg["From"] = GMAIL_SENDER
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain", "utf-8"))

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
            smtp.login(GMAIL_SENDER, GMAIL_APP_PASSWORD)
            smtp.sendmail(GMAIL_SENDER, recipients, msg.as_string())
        print(f"[INFO] 通知メール送信完了 → {recipients}")
    except Exception as e:
        print(f"[ERROR] メール送信失敗: {e}")
        raise


def send_test_email() -> None:
    """送信経路の疎通確認用ダミー通知。"""
    print("[INFO] テストメールモード: ダミー通知を送信します")
    dummy = [
        {
            "name": "（テスト送信）マイニンテンドーストア",
            "url": "https://store-jp.nintendo.com/hardware-switch2-japan",
            "price": TARGET_PRICE_YEN,
            "detail": "これはメール疎通確認用のテスト送信です（実際の在庫ではありません）",
        }
    ]
    send_notification(dummy)


async def main() -> None:
    if os.environ.get("SWITCH2_TEST_EMAIL", "").lower() in ("1", "true", "yes"):
        print("=" * 60)
        print("Nintendo Switch 2 監視 — テストメール送信モード")
        print("=" * 60)
        send_test_email()
        return

    print("=" * 60)
    print("Nintendo Switch 2 本体 在庫監視 開始")
    print(f"定価: {TARGET_PRICE_YEN:,}円（税込）")
    print(f"監視サイト数: {len(SITES)}")
    print("=" * 60)

    last_status = load_last_status()
    print(f"[INFO] 前回ステータス: {len(last_status)} 件記録")

    results = await check_all_sites()

    # 新規に在庫検出されたサイト（前回 available 以外 → 今回 available）を抽出
    new_available = []
    for r in results:
        prev = last_status.get(r["name"], {}).get("status", "unknown")
        if r["status"] == "available" and prev != "available":
            new_available.append(r)

    if new_available:
        print(f"[INFO] 新規入荷 {len(new_available)} 件検出！メール送信します。")
        for r in new_available:
            print(f"  → {r['name']}: {r['url']}")
        send_notification(new_available)
    else:
        print("[INFO] 新規入荷なし。通知スキップ。")

    # ステータス保存（error は前回値を維持）
    new_status = dict(last_status)
    for r in results:
        if r["status"] == "error":
            print(f"[WARN] {r['name']}: エラーのため前回ステータス維持")
            continue
        new_status[r["name"]] = {
            "status": r["status"],
            "price": r["price"],
            "detail": r["detail"],
        }
    save_status(new_status)

    print("=" * 60)
    print("監視終了")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
