"""
キャンセル空き監視スクリプト（複数キャンプ場対応）
対象: 環境変数 CAMP_CHECKIN / CAMP_CHECKOUT で指定した日程（一泊） フリーサイト or カーサイト
  - 仲洞爺キャンプ場（なっぷ / campsite_id=13362）
  - オートリゾート苫小牧アルテン（なっぷ / campsite_id=13288）
  - 財田キャンプ場（489pro-x / オンライン予約再開を監視）
通知: Gmail (smtplib)
重複防止: camp_cancellation_status.json
"""

import json
import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import requests

# 日程は GitHub Secrets 経由の環境変数で指定（コードに直接書かない）
CHECK_IN = os.environ.get("CAMP_CHECKIN", "")    # 例: "2026-07-04"
CHECK_OUT = os.environ.get("CAMP_CHECKOUT", "")  # 例: "2026-07-05"
STATUS_FILE = Path("camp_cancellation_status.json")

GMAIL_SENDER = os.environ.get("GMAIL_SENDER", "")
GMAIL_RECIPIENT = os.environ.get("GMAIL_RECIPIENT", "")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}

# なっぷ(nap-camp.com)の master_site_type のうち、フリーサイト/カーサイトに該当するもの
CAMPGROUNDS = [
    {
        "key": "nakatoya",
        "name": "仲洞爺キャンプ場",
        "kind": "napcamp",
        "campsite_id": 13362,
        "site_types": {"フリーサイト"},
        "url": "https://www.nap-camp.com/hokkaido/13362",
    },
    {
        "key": "alten",
        "name": "オートリゾート苫小牧アルテン",
        "kind": "napcamp",
        "campsite_id": 13288,
        # アルテンは「区画サイト」=車で乗り入れ可能な番号付きサイト（カーサイト相当）
        "site_types": {"区画サイト"},
        "url": "https://www.nap-camp.com/hokkaido/13288",
    },
    {
        "key": "takarada",
        "name": "財田キャンプ場（洞爺水辺の里財田キャンプ場）",
        "kind": "takarada_resume",
        "url": "https://www.489pro-x.com/ja/s/takarada108/",
    },
]


def load_last_status() -> dict:
    if STATUS_FILE.exists():
        try:
            return json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[WARN] ステータスファイル読み込みエラー: {e}")
    return {}


def save_status(status: dict) -> None:
    STATUS_FILE.write_text(
        json.dumps(status, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def check_napcamp(campsite_id: int, site_types: set) -> tuple[str, str]:
    url = f"https://www.nap-camp.com/api/campsite/{campsite_id}/plans"
    params = {"check_in": CHECK_IN, "check_out": CHECK_OUT}
    resp = requests.get(url, params=params, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    plans = resp.json().get("list", [])
    matched = [
        p for p in plans
        if p.get("basic_info", {}).get("master_site_type") in site_types
    ]
    if matched:
        return "available", "、".join(p["site_name"] for p in matched)
    return "full", ""


def check_takarada_resume(url: str) -> tuple[str, str]:
    resp = requests.get(url, headers=HEADERS, timeout=20)
    resp.raise_for_status()
    if "一時停止" in resp.text:
        return "suspended", ""
    return "resumed", ""


def send_gmail_notification(subject: str, body: str) -> None:
    if not all([GMAIL_SENDER, GMAIL_RECIPIENT, GMAIL_APP_PASSWORD]):
        print("[ERROR] Gmail環境変数が未設定")
        return

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


def main() -> None:
    print("=" * 50)
    print("キャンセル空き監視 開始")
    print("=" * 50)

    if not CHECK_IN or not CHECK_OUT:
        print("[ERROR] CAMP_CHECKIN / CAMP_CHECKOUT の環境変数が未設定です。監視を中止します。")
        return

    last_status = load_last_status()
    new_status = dict(last_status)

    for camp in CAMPGROUNDS:
        key = camp["key"]
        name = camp["name"]
        try:
            if camp["kind"] == "napcamp":
                status, detail = check_napcamp(camp["campsite_id"], camp["site_types"])
            else:
                status, detail = check_takarada_resume(camp["url"])
        except Exception as e:
            print(f"[ERROR] [{name}] チェック失敗: {e}")
            continue

        prev = last_status.get(key, "unknown")
        print(f"[INFO] [{name}] 現在: {status} / 前回: {prev}")

        if status == "available" and prev != "available":
            print(f"[INFO] [{name}] 空きを検出！メール送信します。")
            send_gmail_notification(
                subject=f"【キャンセル空き】{name} {CHECK_IN}〜{CHECK_OUT}",
                body=(
                    f"{name} で {CHECK_IN}〜{CHECK_OUT}（一泊）の空きが見つかりました。\n\n"
                    f"■ 空きサイト: {detail}\n\n"
                    f"今すぐ予約ページを確認してください:\n{camp['url']}\n\n"
                    f"※このメールは自動送信されています。"
                ),
            )
        elif status == "resumed" and prev != "resumed":
            print(f"[INFO] [{name}] オンライン予約再開を検出！メール送信します。")
            send_gmail_notification(
                subject=f"【予約再開】{name} のオンライン予約が再開しました",
                body=(
                    f"{name} のオンライン予約再開を検知しました。\n\n"
                    f"予約ページで {CHECK_IN}〜{CHECK_OUT} の空き状況を確認してください:\n{camp['url']}\n\n"
                    f"※このメールは自動送信されています。"
                ),
            )
        else:
            print(f"[INFO] [{name}] 通知なし。")

        new_status[key] = status

    save_status(new_status)
    print("=" * 50)
    print("監視終了")
    print("=" * 50)


if __name__ == "__main__":
    main()
