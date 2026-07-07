"""
お盆キャンプ場 空き監視スクリプト（2026/8/8〜8/15・1泊または2泊）
対象:
  - オートリゾート苫小牧アルテン（なっぷ / campsite_id=13288）
  - 初山別村みさき台公園オートキャンプ場（なっぷ / campsite_id=13293）
  - モラップキャンプ場（休暇村支笏湖 / 予約プロ ypro_stocksearch_api・Playwright経由）
通知: Gmail (smtplib)
重複防止: camp_august_status.json（「新しく出現した空き」だけを通知）
"""

import json
import os
import re
import smtplib
import time
from datetime import date, datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import requests

# 監視対象期間: PERIOD_START チェックイン〜PERIOD_END チェックアウトの範囲内で
# NIGHTS 泊の連続した空きを探す
PERIOD_START = date.fromisoformat(os.environ.get("MONITOR_PERIOD_START", "2026-08-08"))
PERIOD_END = date.fromisoformat(os.environ.get("MONITOR_PERIOD_END", "2026-08-15"))
NIGHTS_LIST = [int(n) for n in os.environ.get("MONITOR_NIGHTS", "1,2").split(",")]

STATUS_FILE = Path("camp_august_status.json")
JST = timezone(timedelta(hours=9))

GMAIL_SENDER = os.environ.get("GMAIL_SENDER", "")
GMAIL_RECIPIENT = os.environ.get("GMAIL_RECIPIENT", "")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}

QKAMURA_MENU_URL = "https://www.qkamura.or.jp/qkamura/489/menu.asp?id=shikotsu&ty=lim&gl=4"
QKAMURA_YADO_ID = "03260001"

CAMPGROUNDS = [
    {
        "key": "alten",
        "name": "オートリゾート苫小牧アルテン",
        "kind": "napcamp",
        "campsite_id": 13288,
        "url": "https://www.nap-camp.com/hokkaido/13288",
    },
    {
        "key": "misakidai",
        "name": "初山別村みさき台公園オートキャンプ場",
        "kind": "napcamp",
        "campsite_id": 13293,
        "url": "https://www.nap-camp.com/hokkaido/13293",
    },
    {
        "key": "morappu",
        "name": "モラップキャンプ場（休暇村支笏湖）",
        "kind": "qkamura",
        "url": QKAMURA_MENU_URL,
    },
]

WEEKDAY_JP = "月火水木金土日"


def stay_label(checkin: date, nights: int) -> str:
    checkout = checkin + timedelta(days=nights)
    return (
        f"{checkin.month}/{checkin.day}({WEEKDAY_JP[checkin.weekday()]})"
        f"〜{checkout.month}/{checkout.day}({WEEKDAY_JP[checkout.weekday()]}) {nights}泊"
    )


def iter_checkins(nights: int):
    d = PERIOD_START
    while d + timedelta(days=nights) <= PERIOD_END:
        yield d
        d += timedelta(days=1)


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


# ---------------------------------------------------------------------------
# なっぷ (nap-camp.com)
# ---------------------------------------------------------------------------

def check_napcamp(campsite_id: int) -> dict:
    """{ "YYYY-MM-DD|nights": "空きサイトの説明" } を返す"""
    stays = {}
    for nights in NIGHTS_LIST:
        for checkin in iter_checkins(nights):
            checkout = checkin + timedelta(days=nights)
            url = f"https://www.nap-camp.com/api/campsite/{campsite_id}/plans"
            params = {"check_in": checkin.isoformat(), "check_out": checkout.isoformat()}
            resp = requests.get(url, params=params, headers=HEADERS, timeout=20)
            resp.raise_for_status()
            data = resp.json()
            plans = data.get("list", []) if isinstance(data, dict) else []
            # テント泊できる区画/フリーサイトのみ（バンガロー・コテージ等は除外）
            matched = [
                p for p in plans
                if "サイト" in (p.get("basic_info", {}).get("master_site_type") or "")
            ]
            if matched:
                names = "、".join(p["site_name"] for p in matched[:3])
                more = f" 他{len(matched) - 3}件" if len(matched) > 3 else ""
                stays[f"{checkin.isoformat()}|{nights}"] = f"{names}{more}"
            time.sleep(0.4)
    return stays


# ---------------------------------------------------------------------------
# 休暇村支笏湖 モラップキャンプ場（予約プロ）
# ---------------------------------------------------------------------------

def parse_ypro_jsonp(text: str) -> dict:
    """getStockData({...}) 形式のJSONPをdictにする。値がシングルクォートのため補正する"""
    m = re.search(r"\(\s*(\{.*\})\s*\)\s*;?\s*$", text, re.S)
    if not m:
        raise ValueError(f"JSONP形式ではありません: {text[:200]}")
    body = m.group(1)
    # :'値' → :"値"（値中のダブルクォートはエスケープ）
    def repl(mm):
        return ":" + json.dumps(mm.group(1), ensure_ascii=False)
    body = re.sub(r":\s*'((?:[^'\\]|\\.)*)'", repl, body)
    return json.loads(body)


def parse_aki_date(s: str) -> date | None:
    m = re.search(r"(?:(\d{4})\D)?(\d{1,2})\D(\d{1,2})", str(s))
    if not m:
        return None
    year = int(m.group(1)) if m.group(1) else PERIOD_START.year
    return date(year, int(m.group(2)), int(m.group(3)))


def extract_camp_plans(html: str) -> list:
    """メニューHTMLから (plan_id, プラン名) を抽出。宿泊プランのみ・日帰りは除外"""
    titles = [(m.start(), re.sub(r"<[^>]+>|\s+", " ", m.group(1)).strip())
              for m in re.finditer(r"<h4[^>]*>(.*?)</h4>", html, re.S)]
    plans = {}
    for m in re.finditer(r'initStockCalendarRe\(\s*"[^"]+",\s*[^,]+,\s*(\d+)', html):
        pid = m.group(1)
        if pid in plans:
            continue
        # 直前の h4 をプラン名とみなす（「プランのポイント」等の定型見出しは除外）
        name = ""
        for pos, t in titles:
            if pos < m.start() and t and "プランのポイント" not in t and "プラン紹介" not in t:
                name = t
        plans[pid] = name
    result = []
    for pid, name in plans.items():
        if "日帰り" in name or "デイキャンプ" in name:
            continue
        if name and "宿泊" not in name and "泊" not in name:
            # プラン名が取れて宿泊要素がない場合のみ除外。名前不明なら念のため含める
            continue
        result.append((pid, name or f"プラン{pid}"))
    return result


def check_qkamura_morappu() -> dict:
    """Playwrightで休暇村予約ページを開き、同一オリジンで在庫APIを叩いて空きを探す"""
    from playwright.sync_api import sync_playwright

    stays = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(locale="ja-JP", user_agent=HEADERS["User-Agent"])
        page = context.new_page()
        try:
            print(f"[INFO] [morappu] ページ取得: {QKAMURA_MENU_URL}")
            page.goto(QKAMURA_MENU_URL, timeout=60_000, wait_until="domcontentloaded")

            # Cloudflareチャレンジ通過待ち（最大90秒）
            html = ""
            for _ in range(30):
                html = page.content()
                if "initStockCalendarRe" in html:
                    break
                page.wait_for_timeout(3_000)
            else:
                Path("camp_debug_morappu_page.html").write_text(html, encoding="utf-8")
                raise RuntimeError(
                    f"予約ページを取得できません（Cloudflare?） title={page.title()!r}"
                )

            plan_list = extract_camp_plans(html)
            print(f"[INFO] [morappu] 宿泊プラン: {plan_list}")
            if not plan_list:
                Path("camp_debug_morappu_page.html").write_text(html, encoding="utf-8")
                raise RuntimeError("宿泊プランが見つかりません（ページ構造変更?）")

            start_str = f"{PERIOD_START.year}/{PERIOD_START.month}/{PERIOD_START.day}"
            end_str = f"{PERIOD_END.year}/{PERIOD_END.month}/{PERIOD_END.day}"

            for pid, plan_name in plan_list:
                api_url = (
                    "https://www.qkamura.or.jp/qkamura/api/ypro/v2/ypro_stocksearch_api.asp"
                    f"?id={QKAMURA_YADO_ID}&planId={pid}"
                    f"&startDate={start_str}&endDate={end_str}&mo=0&meo=0"
                )
                text = page.evaluate(
                    "url => fetch(url, {credentials: 'include'}).then(r => r.text())",
                    api_url,
                )
                try:
                    data = parse_ypro_jsonp(text)
                except Exception:
                    Path(f"camp_debug_morappu_api_{pid}.txt").write_text(text, encoding="utf-8")
                    raise

                for room in data.get("rooms", []):
                    room_name = room.get("room_name", "")
                    ok_dates = set()
                    for aki in room.get("aki", []):
                        d = parse_aki_date(aki.get("aki_date", ""))
                        num = str(aki.get("aki_num", "")).strip()
                        sold_out = str(aki.get("sold_out_f", "0")).strip()
                        if d and num.isdigit() and int(num) > 0 and sold_out != "1":
                            ok_dates.add(d)
                    for nights in NIGHTS_LIST:
                        for checkin in iter_checkins(nights):
                            need = {checkin + timedelta(days=i) for i in range(nights)}
                            if need <= ok_dates:
                                key = f"{checkin.isoformat()}|{nights}"
                                detail = f"{plan_name} {room_name}".strip()
                                if key in stays:
                                    stays[key] += f"、{detail}"
                                else:
                                    stays[key] = detail
        finally:
            browser.close()
    return stays


# ---------------------------------------------------------------------------
# 通知
# ---------------------------------------------------------------------------

def send_gmail_notification(subject: str, body: str) -> None:
    if not all([GMAIL_SENDER, GMAIL_RECIPIENT, GMAIL_APP_PASSWORD]):
        print("[ERROR] Gmail環境変数が未設定")
        return

    msg = MIMEMultipart()
    msg["From"] = GMAIL_SENDER
    msg["To"] = GMAIL_RECIPIENT
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain", "utf-8"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(GMAIL_SENDER, GMAIL_APP_PASSWORD)
        smtp.sendmail(GMAIL_SENDER, GMAIL_RECIPIENT, msg.as_string())
    print(f"[INFO] 通知メール送信完了 → {GMAIL_RECIPIENT}")


def main() -> None:
    print("=" * 50)
    print(f"お盆キャンプ空き監視 開始 ({PERIOD_START}〜{PERIOD_END} / {NIGHTS_LIST}泊)")
    print("=" * 50)

    today = datetime.now(JST).date()
    if today >= PERIOD_END:
        print("[INFO] 監視期間を過ぎているため終了します。")
        return

    last_status = load_last_status()
    last_available = last_status.get("available", {})
    new_available = dict(last_available)

    notifications = []
    error_count = 0

    for camp in CAMPGROUNDS:
        key = camp["key"]
        name = camp["name"]
        try:
            if camp["kind"] == "napcamp":
                stays = check_napcamp(camp["campsite_id"])
            else:
                stays = check_qkamura_morappu()
        except Exception as e:
            print(f"[ERROR] [{name}] チェック失敗: {e}")
            error_count += 1
            continue  # 失敗時は前回状態を維持（誤通知・通知漏れ防止）

        prev_keys = set(last_available.get(key, []))
        cur_keys = set(stays.keys())
        newly = sorted(cur_keys - prev_keys)
        print(f"[INFO] [{name}] 空き{len(cur_keys)}件 / 新規{len(newly)}件")

        if newly:
            lines = [f"◆ {name}"]
            for k in newly:
                checkin_str, nights_str = k.split("|")
                checkin = date.fromisoformat(checkin_str)
                lines.append(f"  ・{stay_label(checkin, int(nights_str))}: {stays[k]}")
            lines.append(f"  予約: {camp['url']}")
            notifications.append("\n".join(lines))

        new_available[key] = sorted(cur_keys)

    if notifications:
        subject = (
            f"【キャンプ空き】{PERIOD_START.month}/{PERIOD_START.day}"
            f"〜{PERIOD_END.month}/{PERIOD_END.day} に空きが出ました"
        )
        body = (
            f"お盆期間（{PERIOD_START.month}/{PERIOD_START.day}〜"
            f"{PERIOD_END.month}/{PERIOD_END.day}）に新しい空きが見つかりました。\n\n"
            + "\n\n".join(notifications)
            + "\n\n※このメールは自動送信されています。"
        )
        send_gmail_notification(subject, body)
    else:
        print("[INFO] 新規の空きなし。通知しません。")

    save_status({
        "available": new_available,
        "checked_at": datetime.now(JST).isoformat(),
    })

    print("=" * 50)
    print("監視終了")
    print("=" * 50)

    if error_count == len(CAMPGROUNDS):
        raise SystemExit(1)  # 全滅時のみ失敗にして気付けるようにする


if __name__ == "__main__":
    main()
