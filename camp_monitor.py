"""
タキノキャンプ場 予約キャンセル監視スクリプト
対象: 2026/6/20 / スタンダードカーサイト / 大人男1・大人女1・幼児2名
通知: Gmail (smtplib)
重複防止: camp_last_status.json
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

BASE_URL = "https://takino.otomari.info/vacancy/list.html"
TARGET_DATE = "2026/06/20"
STATUS_FILE = Path("camp_last_status.json")

GMAIL_SENDER = os.environ.get("GMAIL_SENDER", "")
GMAIL_RECIPIENT = os.environ.get("GMAIL_RECIPIENT", "")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")

# スタンダードカーサイト: planno=5, rtypno=5
PLAN_NO = 5
RTYPE_NO = 5

# 人数: 大人男1・大人女1・乳幼児(syug_4)2
# syug_2=子供 / syug_3=シルバー(65歳以上) / syug_4=乳幼児
GUESTS = {
    "syug_m": "1",   # 大人男性
    "syug_f": "1",   # 大人女性
    "syug_4": "2",   # 乳幼児
}


def load_last_status() -> str:
    if STATUS_FILE.exists():
        try:
            data = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
            return data.get("status", "unknown")
        except Exception as e:
            print(f"[WARN] ステータスファイル読み込みエラー: {e}")
    return "unknown"


def save_status(status: str) -> None:
    STATUS_FILE.write_text(
        json.dumps({"status": status, "date": TARGET_DATE}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[INFO] ステータスを保存: {status}")


async def check_availability() -> str:
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
            # ① トップページ取得
            print(f"[INFO] サイト取得中: {BASE_URL}")
            await page.goto(BASE_URL, timeout=60_000)
            await page.wait_for_load_state("networkidle", timeout=30_000)

            # ② 人数を JS で直接セット（子供欄は非表示 select のため）
            guest_js = "; ".join(
                f"(function(){{var e=document.getElementById('{sid}');if(e)e.value='{val}';}})();"
                for sid, val in GUESTS.items()
            )
            await page.evaluate(guest_js)
            print(f"[INFO] 人数セット完了: {GUESTS}")

            # ③ CheckOnDetail(5,5,...) を JS で直接呼び出し → detail.html へ遷移
            print(f"[INFO] CheckOnDetail({PLAN_NO},{RTYPE_NO},...) 呼び出し")
            async with page.expect_navigation(timeout=30_000):
                await page.evaluate(f"CheckOnDetail({PLAN_NO},{RTYPE_NO},'2026','04')")
            await page.wait_for_load_state("networkidle", timeout=30_000)
            print(f"[INFO] 遷移先URL: {page.url}")

            # ④ 6月タブをクリック（value="06月" のボタン）
            june_btn = await page.query_selector('input[value="06月"]')
            if june_btn:
                print("[INFO] 6月タブをクリック")
                async with page.expect_navigation(timeout=30_000):
                    await june_btn.click()
                await page.wait_for_load_state("networkidle", timeout=30_000)
            else:
                print("[WARN] 6月タブが見つかりません。現在の表示で確認します")

            # ⑤ 6/20 の空き確認
            page_content = await page.content()

            # 6月カレンダーが正しく読み込まれているか確認
            if "2026/06/" not in page_content:
                print("[WARN] 6月カレンダーが読み込まれていません")
                return "error"

            # CheckOnSubmit("2026/06/20",...) があれば空き有り（◎）
            pattern_available = re.compile(
                r"CheckOnSubmit[^)]*2026/06/20",
                re.IGNORECASE | re.DOTALL,
            )
            if pattern_available.search(page_content):
                print("[INFO] 6/20: 空き有り（◎）を検出！")
                return "available"

            # 6月は表示されているが 6/20 に予約リンクなし → 満室/予約不可（×）
            print("[INFO] 6/20: 満室または予約不可（×）")
            return "full"

        except Exception as e:
            print(f"[ERROR] スクレイピングエラー: {e}")
            return "error"
        finally:
            await browser.close()



def send_gmail_notification() -> None:
    if not all([GMAIL_SENDER, GMAIL_RECIPIENT, GMAIL_APP_PASSWORD]):
        print("[ERROR] Gmail環境変数が未設定")
        return

    subject = "【キャンセル空き】タキノキャンプ場 6/20 スタンダードカーサイト"
    body = f"""タキノキャンプ場に空きが出ました！

■ 日付: 2026年6月20日（土）
■ サイト: スタンダードカーサイト
■ 人数: 大人男1名・大人女1名・幼児2名

今すぐ予約ページを確認してください:
{BASE_URL}

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
    print("タキノキャンプ場 キャンセル監視 開始")
    print(f"対象: {TARGET_DATE} / スタンダードカーサイト")
    print("=" * 50)

    last_status = load_last_status()
    print(f"[INFO] 前回ステータス: {last_status}")

    current_status = await check_availability()
    print(f"[INFO] 現在ステータス: {current_status}")

    if current_status == "error":
        print("[WARN] 状態取得失敗。ステータス更新をスキップ。")
    elif current_status == "available":
        if last_status != "available":
            print("[INFO] 空きを検出！メール送信します。")
            send_gmail_notification()
        else:
            print("[INFO] 前回も空きあり。重複通知をスキップ。")
        save_status("available")
    else:
        print("[INFO] 満室。通知なし。")
        save_status("full")

    print("=" * 50)
    print("監視終了")
    print("=" * 50)


if __name__ == "__main__":
    asyncio.run(main())
