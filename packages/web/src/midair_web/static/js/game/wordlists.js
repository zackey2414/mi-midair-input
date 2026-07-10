// お題(単語)ソース。タイピングゲーム(gameplay.js)から言語別にランダム抽出して使う。
// SKK辞書はゲーム向けでない語(古語・専門語等)を返す可能性があるため使わず、
// 日常語のみを手動収録した固定リストを既定ソースとする。
//
// 差し替え設計:
//   gameplay.js は本ファイルの getWordList(lang) しか呼ばない (固定順)。
//   将来 辞書API・頻度リスト等に差し替える場合は WORD_SOURCES の該当エントリ
//   (関数) を差し替えるだけでよく、gameplay.js 側の変更は不要。
//
// エントリ形式: { text: string, hint?: string }
//   text: 実際に入力させる文字列 (JPはひらがなのみ = フリック入力の出力と一致させる。
//         カタカナ語は運指表に無いため対象外)
//   hint: 参考表示 (JPは漢字表記、ENは未使用)

// デモ用固定順リスト (3文字以上、ゲーム開始のたびに先頭から同じ順で出題)。
// カテゴリが偏らないよう動物・食・人・形容詞・モノをインターリーブ済み。
// 事前練習 → 本番で同じ順序を体験できる。
const JAPANESE_WORDS = [
  { text: "さかな",     hint: "魚"    },  // 動物
  { text: "たまご",     hint: "卵"    },  // 食
  { text: "ともだち",   hint: "友達"  },  // 人
  { text: "はやい",     hint: "早い"  },  // 形容詞
  { text: "とけい",     hint: "時計"  },  // モノ
  { text: "うさぎ",     hint: "兎"    },  // 動物
  { text: "ごはん",     hint: "ご飯"  },  // 食
  { text: "かぞく",     hint: "家族"  },  // 人
  { text: "たかい",     hint: "高い"  },  // 形容詞
  { text: "めがね",     hint: "眼鏡"  },  // モノ
  { text: "きつね",     hint: "狐"    },  // 動物
  { text: "やさい",     hint: "野菜"  },  // 食
  { text: "あたま",     hint: "頭"    },  // からだ
  { text: "あたらしい", hint: "新しい"},  // 形容詞
  { text: "かばん",     hint: "鞄"    },  // モノ
  { text: "ひつじ",     hint: "羊"    },  // 動物
  { text: "くだもの",   hint: "果物"  },  // 食
  { text: "こころ",     hint: "心"    },  // からだ
  { text: "たのしい",   hint: "楽しい"},  // 形容詞
  { text: "さいふ",     hint: "財布"  },  // モノ
  { text: "きのう",     hint: "昨日"  },  // 時間
  { text: "からだ",     hint: "体"    },  // からだ
  { text: "いもうと",   hint: "妹"    },  // 人
  { text: "あした",     hint: "明日"  },  // 時間
];

const ENGLISH_WORDS = [
  { text: "cat" }, { text: "dog" }, { text: "bird" }, { text: "fish" }, { text: "lion" },
  { text: "bear" }, { text: "wolf" }, { text: "mouse" }, { text: "horse" }, { text: "sheep" },
  { text: "apple" }, { text: "bread" }, { text: "water" }, { text: "juice" }, { text: "milk" },
  { text: "coffee" }, { text: "sugar" }, { text: "salt" }, { text: "rice" }, { text: "meat" },
  { text: "fruit" }, { text: "chair" }, { text: "table" }, { text: "house" }, { text: "window" },
  { text: "door" }, { text: "phone" }, { text: "book" }, { text: "pen" }, { text: "pencil" },
  { text: "paper" }, { text: "school" }, { text: "teacher" }, { text: "student" }, { text: "friend" },
  { text: "family" }, { text: "mother" }, { text: "father" }, { text: "sister" }, { text: "brother" },
  { text: "child" }, { text: "baby" }, { text: "hand" }, { text: "foot" }, { text: "head" },
  { text: "eye" }, { text: "ear" }, { text: "nose" }, { text: "mouth" }, { text: "heart" },
  { text: "body" }, { text: "color" }, { text: "red" }, { text: "blue" }, { text: "green" },
  { text: "yellow" }, { text: "black" }, { text: "white" }, { text: "big" }, { text: "small" },
  { text: "tall" }, { text: "short" }, { text: "fast" }, { text: "slow" }, { text: "happy" },
  { text: "sad" }, { text: "hot" }, { text: "cold" }, { text: "new" }, { text: "old" },
  { text: "good" }, { text: "bad" }, { text: "sun" }, { text: "moon" }, { text: "star" },
  { text: "sky" }, { text: "cloud" }, { text: "rain" }, { text: "snow" }, { text: "wind" },
  { text: "summer" }, { text: "winter" }, { text: "spring" }, { text: "autumn" }, { text: "morning" },
  { text: "night" }, { text: "today" }, { text: "time" }, { text: "clock" }, { text: "car" },
  { text: "train" }, { text: "bus" }, { text: "bike" }, { text: "road" }, { text: "city" },
  { text: "town" }, { text: "park" }, { text: "garden" }, { text: "tree" }, { text: "flower" },
  { text: "grass" }, { text: "mountain" }, { text: "river" }, { text: "sea" }, { text: "ocean" },
  { text: "world" }, { text: "earth" }, { text: "music" }, { text: "movie" }, { text: "game" },
  { text: "sport" }, { text: "soccer" }, { text: "tennis" }, { text: "run" }, { text: "walk" },
  { text: "jump" }, { text: "swim" }, { text: "read" }, { text: "write" }, { text: "speak" },
  { text: "listen" }, { text: "sleep" }, { text: "eat" }, { text: "drink" }, { text: "love" },
  { text: "like" }, { text: "want" }, { text: "need" }, { text: "know" }, { text: "think" },
  { text: "work" }, { text: "play" }, { text: "learn" }, { text: "teach" }, { text: "open" },
  { text: "close" }, { text: "start" }, { text: "stop" }, { text: "smile" }, { text: "laugh" },
];

// lang -> エントリ配列を返す関数。差し替え時はここだけ変更すればよい。
const WORD_SOURCES = {
  japanese: () => JAPANESE_WORDS,
  english: () => ENGLISH_WORDS,
};

export function getWordList(lang) {
  const source = WORD_SOURCES[lang];
  if (!source) throw new Error(`unknown word list lang: ${lang}`);
  return source();
}

// 直前と同じ語が連続しないようにランダム抽出する。
export function pickRandomWord(lang, excludeText = null) {
  const list = getWordList(lang);
  if (!list.length) throw new Error(`empty word list: ${lang}`);
  if (list.length === 1) return list[0];
  let w;
  do { w = list[Math.floor(Math.random() * list.length)]; } while (w.text === excludeText);
  return w;
}
