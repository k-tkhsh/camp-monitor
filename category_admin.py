"""
サイトの「カテゴリー管理」から届いた依頼（GitHub Issue）を categories/ に反映する

GitHub Actions（.github/workflows/category_admin.yml）から呼ばれる。
Issue の本文に含まれる ```yaml ... ``` ブロックを読み、mode に応じて
カテゴリーのファイルを追加・更新・削除する。結果は result.md に書き出し、
ワークフローが Issue へのコメントに使う。

  mode: add      新しいカテゴリーを作る
  mode: update   既存カテゴリーの名前・キーワードなどを書き換える
                 （feeds は丸ごと置き換え、add_feeds は既存の RSS に追加）
  mode: delete   カテゴリーを削除する（記事も次回の収集時に消える）
"""

import os
import re
import sys
from pathlib import Path

import yaml

CATEGORIES_DIR = Path("categories")
RESULT_FILE = Path("result.md")

ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
LIMITS = {"name": 30, "emoji": 8, "word": 60, "keywords": 15, "exclude": 30, "feeds": 5, "match": 20}

# フォームから変更できる項目。それ以外（yahoo_realtime など）は更新時もそのまま残す
EDITABLE = ("name", "emoji", "lang", "notify", "keywords", "exclude", "feeds")


class RequestError(Exception):
    """依頼の内容に不備がある（Issue にそのまま理由を返す）"""


def extract_yaml(body: str) -> dict:
    match = re.search(r"```ya?ml\s*\n(.*?)```", body or "", re.S)
    if not match:
        raise RequestError("本文に設定（```yaml で始まるブロック）が見つかりません。")
    try:
        data = yaml.safe_load(match.group(1))
    except yaml.YAMLError as e:
        raise RequestError(f"設定を読み取れません: {e}") from None
    if not isinstance(data, dict):
        raise RequestError("設定の形式が正しくありません。")
    return data


def _words(value, field: str, max_items: int) -> list[str]:
    """改行区切りの文字列か一覧を受け取り、空でない語の一覧にする"""
    if value is None:
        return []
    if isinstance(value, str):
        value = value.splitlines()
    if not isinstance(value, list):
        raise RequestError(f"{field} は一覧で指定してください。")
    words = [str(v).strip() for v in value if str(v).strip()]
    if len(words) > max_items:
        raise RequestError(f"{field} は {max_items} 個までです（{len(words)} 個あります）。")
    for w in words:
        if len(w) > LIMITS["word"]:
            raise RequestError(f"{field} の「{w[:20]}…」が長すぎます（{LIMITS['word']} 文字まで）。")
    return words


def _feeds(value) -> list[dict]:
    if not value:
        return []
    if not isinstance(value, list) or len(value) > LIMITS["feeds"]:
        raise RequestError(f"feeds は {LIMITS['feeds']} 件までの一覧で指定してください。")
    feeds = []
    for f in value:
        if not isinstance(f, dict):
            raise RequestError("feeds の各項目には name と url を書いてください。")
        url = str(f.get("url", "")).strip()
        if not url.startswith("https://"):
            raise RequestError(f"RSS の URL は https:// で始まる必要があります: {url[:60]}")
        feed = {"name": str(f.get("name") or url)[: LIMITS["name"]], "url": url}
        match = _words(f.get("match"), "feeds の match", LIMITS["match"])
        if match:
            feed["match"] = match
        feeds.append(feed)
    return feeds


def clean_fields(data: dict, require_all: bool) -> dict:
    """フォームの値を検証し、カテゴリーファイルに書く形に整える"""
    fields: dict = {}
    if require_all or "name" in data:
        name = str(data.get("name") or "").strip()
        if not name:
            raise RequestError("カテゴリー名（name）を入力してください。")
        if len(name) > LIMITS["name"]:
            raise RequestError(f"カテゴリー名は {LIMITS['name']} 文字までです。")
        fields["name"] = name
    if require_all or "emoji" in data:
        fields["emoji"] = str(data.get("emoji") or "📰").strip()[: LIMITS["emoji"]]
    if require_all or "lang" in data:
        lang = str(data.get("lang") or "ja").strip()
        if lang not in ("ja", "en"):
            raise RequestError("lang は ja（日本語）か en（英語）を指定してください。")
        fields["lang"] = lang
    if require_all or "notify" in data:
        fields["notify"] = bool(data.get("notify", False))
    if require_all or "keywords" in data:
        fields["keywords"] = _words(data.get("keywords"), "keywords", LIMITS["keywords"])
    if require_all or "exclude" in data:
        fields["exclude"] = _words(data.get("exclude"), "exclude", LIMITS["exclude"])
    if require_all or "feeds" in data:
        fields["feeds"] = _feeds(data.get("feeds"))
    return fields


def category_path(cat_id: str) -> Path:
    if not ID_RE.match(cat_id or ""):
        raise RequestError(f"カテゴリー id「{cat_id}」は使えません（半角英小文字・数字・_・- のみ）。")
    return CATEGORIES_DIR / f"{cat_id}.yaml"


def existing_categories() -> dict[str, dict]:
    result = {}
    for path in sorted(CATEGORIES_DIR.glob("*.yaml")):
        if not path.name.startswith("_"):
            result[path.stem] = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return result


def _dump(data: dict) -> str:
    return yaml.safe_dump(data, allow_unicode=True, sort_keys=False, default_flow_style=False)


def write_category(path: Path, conf: dict) -> None:
    path.write_text(_dump(conf), encoding="utf-8")


def update_yaml_text(text: str, updates: dict) -> str:
    """YAML の該当する最上位の項目だけを書き換え、それ以外の行やコメントは残す

    手で書いたファイルの説明コメント（しきい値の理由など）を、サイトからの編集で
    消さないため。書き換えた結果が期待どおりに読めなければ、全体を書き直す。
    """
    original = yaml.safe_load(text) or {}
    expected = {**original, **updates}
    lines = text.splitlines(keepends=True)
    key_re = re.compile(r"^([A-Za-z_][\w-]*):")
    starts = [(i, m.group(1)) for i, line in enumerate(lines) if (m := key_re.match(line))]

    pending = dict(updates)
    for n in range(len(starts) - 1, -1, -1):
        i, key = starts[n]
        if key not in pending:
            continue
        end = starts[n + 1][0] if n + 1 < len(starts) else len(lines)
        # 次の項目の直前にある行頭のコメント・空行は、次の項目の説明なので残す
        while end > i + 1 and (not lines[end - 1].strip() or lines[end - 1].startswith("#")):
            end -= 1
        lines[i:end] = [_dump({key: pending.pop(key)})]

    result = "".join(lines)
    if pending:
        result = result.rstrip("\n") + "\n" + _dump(pending)
    if yaml.safe_load(result) != expected:
        return _dump(expected)
    return result


def add(data: dict, issue_number: str) -> str:
    fields = clean_fields(data, require_all=True)
    if not fields["keywords"] and not fields["feeds"]:
        raise RequestError("検索キーワードか RSS を1つ以上入力してください。")
    current = existing_categories()
    for cid, conf in current.items():
        if conf.get("name") == fields["name"]:
            raise RequestError(f"「{fields['name']}」は既にあります（id: {cid}）。編集から変更してください。")

    cat_id = str(data.get("id") or f"c{issue_number}").strip().lower()
    path = category_path(cat_id)
    if path.exists():
        raise RequestError(f"id「{cat_id}」は既に使われています。")

    order = max((c.get("order", 0) for c in current.values()), default=0) + 10
    conf = {
        "name": fields["name"],
        "emoji": fields["emoji"],
        "order": order,
        "lang": fields["lang"],
        "notify": fields["notify"],
        "priority": "default",
        "keywords": fields["keywords"],
        "exclude": fields["exclude"],
        "feeds": fields["feeds"],
    }
    write_category(path, conf)
    return f"カテゴリー「{fields['emoji']} {fields['name']}」を追加しました（id: `{cat_id}`）。"


def update(data: dict) -> str:
    cat_id = str(data.get("id") or "").strip()
    path = category_path(cat_id)
    if not path.exists():
        raise RequestError(f"id「{cat_id}」のカテゴリーが見つかりません。")
    text = path.read_text(encoding="utf-8")
    conf = yaml.safe_load(text) or {}
    fields = clean_fields({k: v for k, v in data.items() if k in EDITABLE}, require_all=False)
    if "name" in fields:
        for cid, other in existing_categories().items():
            if cid != cat_id and other.get("name") == fields["name"]:
                raise RequestError(f"「{fields['name']}」は別のカテゴリーで使われています。")
    conf.update(fields)
    if data.get("add_feeds"):
        feeds = list(conf.get("feeds") or []) + _feeds(data["add_feeds"])
        if len(feeds) > LIMITS["feeds"] + 5:
            raise RequestError("RSS が多すぎます。不要なものを減らしてから追加してください。")
        # 同じ URL が重なったら先に登録されていた方を残す
        unique: dict[str, dict] = {}
        for f in feeds:
            unique.setdefault(f.get("url"), f)
        conf["feeds"] = list(unique.values())
    if not conf.get("keywords") and not conf.get("feeds") and not conf.get("yahoo_realtime"):
        raise RequestError("検索キーワードか RSS を1つ以上残してください。")
    changed = {k: conf[k] for k in fields}
    if data.get("add_feeds"):
        changed["feeds"] = conf["feeds"]
    path.write_text(update_yaml_text(text, changed), encoding="utf-8")
    return f"カテゴリー「{conf.get('emoji', '')} {conf.get('name', cat_id)}」を更新しました。"


def delete(data: dict) -> str:
    cat_id = str(data.get("id") or "").strip()
    path = category_path(cat_id)
    if not path.exists():
        raise RequestError(f"id「{cat_id}」のカテゴリーが見つかりません。")
    conf = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    path.unlink()
    return f"カテゴリー「{conf.get('emoji', '')} {conf.get('name', cat_id)}」を削除しました。記事もサイトから消えます。"


def main() -> int:
    body = os.environ.get("ISSUE_BODY", "")
    issue_number = re.sub(r"\D", "", os.environ.get("ISSUE_NUMBER", "")) or "0"
    try:
        data = extract_yaml(body)
        mode = str(data.get("mode") or "add").strip()
        if mode == "add":
            message = add(data, issue_number)
        elif mode == "update":
            message = update(data)
        elif mode == "delete":
            message = delete(data)
        else:
            raise RequestError(f"mode「{mode}」は使えません（add / update / delete）。")
    except RequestError as e:
        RESULT_FILE.write_text(f"⚠️ 反映できませんでした: {e}\n", encoding="utf-8")
        print(f"[ERROR] {e}")
        return 1
    RESULT_FILE.write_text(f"✅ {message}\n", encoding="utf-8")
    print(f"[INFO] {message}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
