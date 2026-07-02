"""
キャンセル空き監視スクリプト（複数キャンプ場対応）
対象: 2026/7/4〜7/5（一泊） フリーサイト or カーサイト
  - 仲洞爺キャンプ場（なっぷ / campsite_id=13362）
  - オートリゾート苫小牧アルテン（なっぷ / campsite_id=13288）
  - 財田キャンプ場（489pro-x / searchCalendar API）
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

CHECK_IN = "2026-07-04"
CHECK_OUT = "2026-07-05"
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
        "kind": "takarada",
        # ケビン(id=1)を除くキャンプサイト（フリーサイト/カーサイト相当）のroom_id一覧
        "room_ids": {
            2: "キャンピングカーサイト",
            3: "プライベートサイトA（管理棟側）",
            4: "プライベートサイトB",
            5: "オープンサイト（ステージ側）",
            6: "フリーサイト",
            7: "プライベートサイトA（湖側）",
            8: "プライベートサイトB（管理棟側）",
            9: "オープンサイト（湖側）",
        },
        "url": "https://www.489pro-x.com/ja/s/takarada108/search/?nights=1&r_num=1&num=2&show=room&isPriceTotalPerson=false&nights_unspecified=1&checkinDate=20260704",
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


def check_takarada(room_ids: dict) -> tuple[str, str]:
    base_url = "https://www.489pro-x.com/api/searchCalendar/"
    checkin_compact = CHECK_IN.replace("-", "")   # 20260704
    checkout_compact = CHECK_OUT.replace("-", "")  # 20260705
    available_names = []
    for room_id, room_name in room_ids.items():
        params = {
            "nights": "1", "r_num": "1", "num": "2",
            "show": "room", "isPriceTotalPerson": "false",
            "nights_unspecified": "1",
            "dt_from": checkin_compact, "dt_to": checkout_compact,
            "g": "s", "f": "takarada108", "l": "ja",
            "room_id": room_id,
        }
        resp = requests.get(base_url, params=params, headers=HEADERS, timeout=20)
        resp.raise_for_status()
        month_data = resp.json().get("data", {})
        # 7月のデータから7/4の price を確認（null=満室、数値=空き有り）
        day_info = month_data.get("202607", {}).get("4", {})
        if day_info.get("price") is not None:
            available_names.append(room_name)
    if available_names:
        return "available", "、".join(available_names)
    return "full", ""


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
    print(f"対象日程: {CHECK_IN} 〜 {CHECK_OUT}")
    print("=" * 50)

    last_status = load_last_status()
    new_status = dict(last_status)

    for camp in CAMPGROUNDS:
        key = camp["key"]
        name = camp["name"]
        try:
            if camp["kind"] == "napcamp":
                status, detail = check_napcamp(camp["campsite_id"], camp["site_types"])
            else:
                status, detail = check_takarada(camp["room_ids"])
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
        else:
            print(f"[INFO] [{name}] 通知なし。")

        new_status[key] = status

    save_status(new_status)
    print("=" * 50)
    print("監視終了")
    print("=" * 50)


if __name__ == "__main__":
    main()
