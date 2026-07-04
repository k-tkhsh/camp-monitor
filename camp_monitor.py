"""
タキノキャンプ場 予約キャンセル監視スクリプト
対象: 環境変数 CAMP_TARGET_DATE / CAMP_GUEST_* で指定した日付・人数 / スタンダードカーサイト
通知: Gmail (smtplib)
重複防止: camp_last_status.json
"""

import asyncio
import json
import os
import re
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

from playwright.async_api import async_playwright

BASE_URL = "https://takino.otomari.info/vacancy/list.html"
# 日付・人数は GitHub Secrets 経由の環境変数で指定（コードに直接書かない）
TARGET_DATE = os.environ.get("CAMP_TARGET_DATE", "")  # 例: "2026/06/20"
STATUS_FILE = Path("camp_last_status.json")

GMAIL_SENDER = os.environ.get("GMAIL_SENDER", "")
GMAIL_RECIPIENT = os.environ.get("GMAIL_RECIPIENT", "")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")

# スタンダードカーサイト: planno=5, rtypno=5
PLAN_NO = 5
RTYPE_NO = 5

# 人数: syug_2=子供 / syug_3=シルバー(65歳以上) / syug_4=乳幼児
GUESTS = {
    "syug_m": os.environ.get("CAMP_GUEST_ADULT_MALE", ""),
    "syug_f": os.environ.get("CAMP_GUEST_ADULT_FEMALE", ""),
    "syug_4": os.environ.get("CAMP_GUEST_INFANT", ""),
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
    year, month, day = TARGET_DATE.split("/")

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
            print("[INFO] 人数セット完了")

            # ③ CheckOnDetail(5,5,...) を JS で直接呼び出し → detail.html へ遷移
            print(f"[INFO] CheckOnDetail({PLAN_NO},{RTYPE_NO},...) 呼び出し")
            async with page.expect_navigation(timeout=30_000):
                await page.evaluate(f"CheckOnDetail({PLAN_NO},{RTYPE_NO},'{year}','04')")
            await page.wait_for_load_state("networkidle", timeout=30_000)
            print(f"[INFO] 遷移先URL: {page.url}")

            # ④ 対象月タブをクリック
            month_btn = await page.query_selector(f'input[value="{month}月"]')
            if month_btn:
                print(f"[INFO] {month}月タブをクリック")
                async with page.expect_navigation(timeout=30_000):
                    await month_btn.click()
                await page.wait_for_load_state("networkidle", timeout=30_000)
            else:
                print("[WARN] 対象月タブが見つかりません。現在の表示で確認します")

            # ⑤ 空き確認
            page_content = await page.content()

            if f"{year}/{month}/" not in page_content:
                print("[WARN] 対象月カレンダーが読み込まれていません")
                return "error"

            # CheckOnSubmit("YYYY/MM/DD",...) があれば空き有り（◎）
            pattern_available = re.compile(
                rf"CheckOnSubmit[^)]*{re.escape(TARGET_DATE)}",
                re.IGNORECASE | re.DOTALL,
            )
            if pattern_available.search(page_content):
                print("[INFO] 空き有り（◎）を検出！")
                return "available"

            print("[INFO] 満室または予約不可（×）")
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

    dt = datetime.strptime(TARGET_DATE, "%Y/%m/%d")
    weekday_jp = "月火水木金土日"[dt.weekday()]
    date_str = dt.strftime(f"%Y年%m月%d日（{weekday_jp}）")
    guest_str = (
        f"大人男{GUESTS['syug_m']}名・大人女{GUESTS['syug_f']}名・乳幼児{GUESTS['syug_4']}名"
    )

    subject = f"【キャンセル空き】タキノキャンプ場 {dt.month}/{dt.day} スタンダードカーサイト"
    body = f"""タキノキャンプ場に空きが出ました！

■ 日付: {date_str}
■ サイト: スタンダードカーサイト
■ 人数: {guest_str}

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
    print("対象: スタンダードカーサイト")
    print("=" * 50)

    if not TARGET_DATE or not all(GUESTS.values()):
        print("[ERROR] CAMP_TARGET_DATE / CAMP_GUEST_* の環境変数が未設定です。監視を中止します。")
        return

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
