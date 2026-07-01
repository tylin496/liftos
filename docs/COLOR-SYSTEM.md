# LiftOS Color System — governing law

顏色是訊號,不是裝飾。一段文字只有屬於以下 4 種角色才可上色;其餘一律中性 ink(`--ink`/`-2`/`-3`/`-4`),無論內容好壞。主數字(PR 重量、TDEE、Sleep/HRV/RHR、adherence %、Training-Health %、週均)一律白色。

## 1. Identity 數字
5 指標各擁固定色,與數值無關:

| 指標 | Token |
|------|-------|
| Calories | `--good` |
| Protein | `--blue` |
| Weight | `--health-weight` |
| Body Fat | `--health-bodyfat` |
| Lean Mass | `--health-leanmass` |

## 2. Delta / 趨勢微字 + 方向箭頭
唯一可用色表達好壞處:

- 正 / 改善 = `--good`
- 負 / 退步 = `--bad`
- 平 = `--ink-4`

方向箭頭也是 delta,永不用 `--accent`;好壞永不上溢到主數字。

## 3. Badge / pill
走五色回饋系統(good/gold/bad/blue/accent)。

## 4. Accent
只代表:

1. 主要動作/可點(按鈕、加號、hover、today/selected)
2. 每張卡唯一焦點(建議新目標、Cut % + remaining)
3. 日常非-PR 慶祝

永不代表狀態/嚴重度——caution/attention 用 `--gold`,問題用 `--bad`。每卡至多一個 accent 焦點。

## 硬規則

- 只有一個綠(`--good` 同時是 good 信號與 Calories identity,同一 token)。
- 零裸色——每個有色像素都走 token,手挑 hex/oklch 一律是 bug。
- PR 永遠 `--gold`,不得降級。

## 5. Overlay(非訊號裝飾色)

不代表好壞/身份/狀態,單純是「深色底上的白字」或「照片/媒體上的暗化遮罩」,但一樣要走 token,不得手挑 hex/rgba:

| 用途 | Token |
|------|-------|
| 飽和色底上的白字/icon(按鈕、toast、選中日期、avatar fallback) | `--on-color` |
| 全螢幕 modal/sheet 遮罩(既有,`--scrim-bg` + `--scrim-blur`) | `--scrim-bg` |
| 近全黑背板(僅限 photo lightbox) | `--scrim-strong` |

**範圍邊界**:box-shadow 模糊/景深用的黑白 rgba(如 `--shadow-sm`/`--shadow-md` 內建值、卡片投影、bar 的內陰影高光)與純裝飾漸層(如 PR 卡的拉絲金屬背景)不算「訊號色」,不強制 token 化——它們不表達好壞/身份/狀態,是材質效果。
