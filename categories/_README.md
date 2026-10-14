# カテゴリー設定

1 カテゴリー = 1 ファイル（`<id>.yaml`）です。ファイルを足せばカテゴリーが増え、消せば無くなります。
サイトの「カテゴリー管理」画面から追加・削除した場合も、このフォルダのファイルが自動で作られ・消されます。

```yaml
name: "日本酒"            # タブに出る名前
emoji: "🍶"               # 名前の前に付く絵文字
order: 20                 # タブの並び順（小さいほど左）
lang: "ja"                # 記事の言語。en にすると見出しを日本語に翻訳します
notify: true              # 新着をスマホに通知するか
priority: "default"       # 通知の優先度: min / low / default / high / urgent

keywords:                 # Google ニュースで検索する語（基本の情報源）
  - "日本酒 札幌"

exclude:                  # この語を含む記事は取り込まない
  - "事故"

feeds:                    # 追加の情報源（RSS）
  - name: "PR TIMES"
    url: "https://prtimes.jp/index.rdf"
    match:                # どれかを含む記事だけ取り込む。空白区切りは「両方を含む」
      - "日本酒 北海道"
    limit: 10             # 1回に取り込む最大件数（省略時 10）
```

`yahoo_realtime:` を書くと Yahoo!リアルタイム検索から取得します（`sns_trends.yaml` を参照）。
