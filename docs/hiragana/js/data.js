// ひらがなの一覧と、1文字ずつの「絵ことば」。
// 3〜4歳が知っている言葉だけを選び、絵はすべて絵文字で表す（画像ファイル不要）。
// playable: 音から文字を選ぶ問題に出すか（「を」は「お」と同じ音なので出さない）
// picture:  その文字で始まる言葉があるか（「ん」「を」は無い）

export const KANA = [
  { k: 'あ', word: 'あり',     emoji: '🐜', row: 'あ' },
  { k: 'い', word: 'いぬ',     emoji: '🐶', row: 'あ' },
  { k: 'う', word: 'うま',     emoji: '🐴', row: 'あ' },
  { k: 'え', word: 'えんぴつ', emoji: '✏️', row: 'あ' },
  { k: 'お', word: 'おにぎり', emoji: '🍙', row: 'あ' },

  { k: 'か', word: 'かさ',     emoji: '☂️', row: 'か' },
  { k: 'き', word: 'きりん',   emoji: '🦒', row: 'か' },
  { k: 'く', word: 'くま',     emoji: '🐻', row: 'か' },
  { k: 'け', word: 'けいと',   emoji: '🧶', row: 'か' },
  { k: 'こ', word: 'こおり',   emoji: '🧊', row: 'か' },

  { k: 'さ', word: 'さかな',   emoji: '🐟', row: 'さ' },
  { k: 'し', word: 'しまうま', emoji: '🦓', row: 'さ' },
  { k: 'す', word: 'すいか',   emoji: '🍉', row: 'さ' },
  { k: 'せ', word: 'せみ',     emoji: '🦗', row: 'さ' },
  { k: 'そ', word: 'そり',     emoji: '🛷', row: 'さ' },

  { k: 'た', word: 'たまご',   emoji: '🥚', row: 'た' },
  { k: 'ち', word: 'ちず',     emoji: '🗺️', row: 'た' },
  { k: 'つ', word: 'つき',     emoji: '🌙', row: 'た' },
  { k: 'て', word: 'てぶくろ', emoji: '🧤', row: 'た' },
  { k: 'と', word: 'とけい',   emoji: '⏰', row: 'た' },

  { k: 'な', word: 'なす',     emoji: '🍆', row: 'な' },
  { k: 'に', word: 'にんじん', emoji: '🥕', row: 'な' },
  { k: 'ぬ', word: 'ぬいぐるみ', emoji: '🧸', row: 'な' },
  { k: 'ね', word: 'ねこ',     emoji: '🐱', row: 'な' },
  { k: 'の', word: 'のこぎり', emoji: '🪚', row: 'な' },

  { k: 'は', word: 'はな',     emoji: '🌸', row: 'は' },
  { k: 'ひ', word: 'ひこうき', emoji: '✈️', row: 'は' },
  { k: 'ふ', word: 'ふね',     emoji: '⛵', row: 'は' },
  { k: 'へ', word: 'へび',     emoji: '🐍', row: 'は' },
  { k: 'ほ', word: 'ほし',     emoji: '⭐', row: 'は' },

  { k: 'ま', word: 'まる',     emoji: '⭕', row: 'ま' },
  { k: 'み', word: 'みかん',   emoji: '🍊', row: 'ま' },
  { k: 'む', word: 'むし',     emoji: '🐛', row: 'ま' },
  { k: 'め', word: 'めがね',   emoji: '👓', row: 'ま' },
  { k: 'も', word: 'もも',     emoji: '🍑', row: 'ま' },

  { k: 'や', word: 'やま',     emoji: '⛰️', row: 'や' },
  { k: 'ゆ', word: 'ゆき',     emoji: '❄️', row: 'や' },
  { k: 'よ', word: 'よつば',   emoji: '🍀', row: 'や' },

  { k: 'ら', word: 'らくだ',   emoji: '🐫', row: 'ら' },
  { k: 'り', word: 'りんご',   emoji: '🍎', row: 'ら' },
  { k: 'る', word: 'るすばん', emoji: '🏠', row: 'ら' },
  { k: 'れ', word: 'れもん',   emoji: '🍋', row: 'ら' },
  { k: 'ろ', word: 'ろけっと', emoji: '🚀', row: 'ら' },

  { k: 'わ', word: 'わに',     emoji: '🐊', row: 'わ' },
  { k: 'を', word: 'ぞうを みる', emoji: '🐘', row: 'わ', playable: false, picture: false,
    note: '「を」は ことばの あいだで つかうよ' },
  { k: 'ん', word: 'らいおん', emoji: '🦁', row: 'わ', picture: false,
    note: '「ん」で はじまる ことばは ないよ' },
];

/** 行の並び（画面の五十音表と、やさしい順の出題に使う） */
export const ROWS = [
  { id: 'あ', label: 'あいうえお' },
  { id: 'か', label: 'かきくけこ' },
  { id: 'さ', label: 'さしすせそ' },
  { id: 'た', label: 'たちつてと' },
  { id: 'な', label: 'なにぬねの' },
  { id: 'は', label: 'はひふへほ' },
  { id: 'ま', label: 'まみむめも' },
  { id: 'や', label: 'やゆよ' },
  { id: 'ら', label: 'らりるれろ' },
  { id: 'わ', label: 'わをん' },
];

/** 形が似ていて まちがえやすい文字のグループ。まちがい選択肢を選ぶときに優先する。 */
export const CONFUSABLE = [
  ['ぬ', 'め', 'あ'],
  ['わ', 'ね', 'れ'],
  ['さ', 'き', 'ち'],
  ['は', 'ほ', 'ま'],
  ['る', 'ろ', 'そ'],
  ['し', 'つ', 'く'],
  ['あ', 'お'],
  ['い', 'り', 'こ'],
  ['す', 'む'],
  ['く', 'へ'],
  ['た', 'な'],
  ['う', 'ら'],
  ['け', 'に'],
  ['ゆ', 'ぬ'],
  ['よ', 'ま'],
];

export const BY_KANA = new Map(KANA.map((e) => [e.k, e]));

/** ステッカー（がんばったごほうび）。集めた順に貼られる。 */
export const STICKERS = [
  '🌟', '🐣', '🍓', '🚗', '🌈', '🐬', '🎈', '🦄', '🍩', '🐢',
  '🚂', '🌻', '🐧', '🍄', '🎁', '🦕', '⚽', '🐝', '🍡', '👑',
];
