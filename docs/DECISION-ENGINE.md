# LiftOS — Decision Engine（設計 v1）

把 Overview 的 Recommendation 從「只看體重調熱量」升級成**綜合全 app 資料的 weekly directive**。
狀態：**已實作（ladder）**。engine 在 `src/features/overview/recommendations/engine.ts`（`decide()`＝4 層短路），由 `topRecommendation` 對外；四個 slice 在 `evaluationApi.recomputeAndPersist` 組好餵進去。

## 實作與 spec 的兩個刻意偏差
1. **Tier 1a（Prioritize recovery）改為「recovery POOR 單獨即觸發」**，不強制 AND Training=DECLINING。低 readiness 本身就時效敏感，硬要等訓練退步會在最該休息時噤聲；training load 只用來改文案（沿用既有 recovery provider）。
2. **cut-rate 顏色一併收斂**：Overview Weight card 的 Rate 箭頭（原本 sign-only，掉就綠）拿掉，rate 數字改中性 signed；pace 判決全歸 status pill，`paceTone`/`paceLabel` 修正為「只有 on-pace 是綠，太快=Too fast/warn，太慢=warn，減重期增重=bad」。綠＝在 band 內，不再是「在掉」。

## 核心原則

1. **Ladder not leaderboard** — 不是每個 domain 各投一票比 priority 數字，而是 4 層優先級由上往下走，**第一個成立的 tier 直接勝出並壓掉下面所有 tier**。這是「Prioritize recovery」能穩定壓過「Push for a PR」的唯一正確機制。
2. **Engine 只讀 Evaluation，不讀 raw data** — 沿用現有 `src/features/overview/recommendations/` 的 `RecContext` 契約。每個 domain 先各自把 raw metrics 收斂成一個有信心值的判斷，engine 只負責「組合判斷」。
3. **一次只出一個 directive** — System card 就是這一句。維持 `topRecommendation()` 對外形狀，內部從「排序取最大」換成「走階梯取第一個」。`reason` 可多因子，但**動作唯一**。
4. **Sticky** — 訊號不夠穩就不換檔。寧可維持舊指令，也不要每次量體重就翻臉。

## 輸入訊號盤點

| Domain | 判斷物件 | 關鍵欄位 | 現況 |
|---|---|---|---|
| 體重速率 | `NutritionEvaluation` | `observedRate`, `targetRange{min,max}`, `confidence`, `status` | ✅ 已有 |
| 熱量遵守 | `diagnostics` | `daysOnTarget`, `intakeDifference`, monthlyStats adherence | ✅ 已有 |
| Recovery | `RecoverySnapshot` | `score(0–3)`, `status`, hrv/rhr/sleep vs baseline | ✅ 已有 |
| Cut 進度 | `Goal` | `progressPct`, `remainingWeight`, `leanMass30dAvg` | ✅ 已有 |
| **Training 趨勢** | `TrainingEvaluation` | 需新建 → improving/holding/declining + confidence | ❌ 缺 |
| **Lean Mass 流失** | `LeanMassEvaluation` | 需新建 → stable/falling + confidence | ❌ 缺 |

## 訊號離散化（raw evaluation → 階梯吃的 enum）

Engine 不直接吃浮點數，先把每個 evaluation 收斂成小 enum，門檻集中一處、好調好測：

| 訊號 | 狀態 | 判定 |
|---|---|---|
| Weight rate | `FAST` / `ON_PACE` / `SLOW` / `STALLED` | 相對 `targetRange`（見門檻表） |
| Adherence | `ADHERENT` / `DRIFTING` | `daysOnTarget ≥ 5` 且近 14 天 intake 貼 target |
| Recovery | `GOOD` / `OK` / `POOR` | score 3 / 2 / ≤1，POOR 需持續 |
| Training | `IMPROVING` / `HOLDING` / `DECLINING` | 見「兩個要新建的 Evaluation」 |
| Lean mass | `STABLE` / `FALLING` | 見「兩個要新建的 Evaluation」 |

## 四層階梯（精確觸發，由上往下第一個 fire 勝出）

### Tier 1 — Protect（保護，最高優先）
| # | 指令 | 觸發條件 |
|---|---|---|
| 1a | **Prioritize recovery** | `Recovery=POOR`（持續）**AND** `Training=DECLINING` |
| 1b | **Hold off on further cuts** | `LeanMass=FALLING`（持續、high-conf） |

### Tier 2 — Correct（校正）
| # | 指令 | 觸發條件 |
|---|---|---|
| 2a | **Reduce deficit slightly** | `Weight=FAST` **AND** (`Training=DECLINING` **OR** `Recovery=POOR`) |
| 2b | **Increase activity** | `Weight=STALLED` **AND** `Adherence=ADHERENT` |

### Tier 3 — Sustain（維持，預設）
| # | 指令 | 觸發條件 |
|---|---|---|
| 3 | **Maintain current target** | Weight ON_PACE、Training 非 DECLINING、Recovery 非 POOR、LeanMass STABLE |

### Tier 4 — Capitalize（把握機會，Tier 1–3 全沒 fire 才輪到）
| # | 指令 | 觸發條件 |
|---|---|---|
| 4 | **Push for a PR this week** | `Recovery=GOOD` **AND** `Training=IMPROVING` |

> 語意優先序：安全 > 體組成完整 > 速率校正 > 表現機會。

## Confidence & Hysteresis 門檻（成敗關鍵）

1. **Absence = no info** — 某 domain 沒 evaluation（資料不足）時，其狀態視為「不觸發任何 tier」，而非「正常」。缺 Training 資料 → Tier 1a/2a/4 不可能 fire，自然 degrade 到 Sustain。
2. **狀態要過 confidence 門檻** — 例：`Weight=FAST` 只在 `confidence ≥ medium` 才算數；低信心一律當 ON_PACE。
3. **持續窗** — 壞消息（Recovery=POOR、LeanMass=FALLING、Training=DECLINING）都要求持續才成立，杜絕單日 blip。
4. **進出不對稱** — 進入 tier 的門檻比退出嚴；退檔需觸發訊號清除且維持 ≥3 天。
5. **Sticky** — 已顯示指令維持到「另一 tier 以持續訊號成立」才換；不因單次重算掉檔。

## 具體門檻（v1 預設，可調）

| 狀態 | v1 門檻 | 備註 |
|---|---|---|
| Weight `FAST` | `observedRate < targetRange.min − 0.15` kg/wk | 比可接受快端再快 0.15 |
| Weight `STALLED` | cut 中 `|observedRate| < 0.10` kg/wk | 21 天窗 |
| Weight 信心 | `NutritionEvaluation.confidence ≥ medium` | 低信心當 ON_PACE |
| Recovery `POOR` | score ≤ 1，且近 5 天中 ≥3 天 POOR | 擋單日 blip |
| Training `DECLINING` | ≥⅓ 現役 exercise（至少 2 個）e1RM < PR 94% **且** stalledWeeks ≥ 3 | 94% 沿用現有 watch 門檻 |
| LeanMass `FALLING` | `leanMass30dAvg` 30 天回歸斜率 < −0.15 kg/月，持續，high-conf | 寧鈍勿敏 |
| 退檔遲滯 | 觸發訊號清除後維持 ≥3 天才退回較低 tier | entry ≠ exit |

## 兩個要新建的 Evaluation（真正的工程在這）

### `TrainingEvaluation` — 穩定的趨勢判斷
- **問題**：現在只有 `computeStrengthSummary()`（`src/features/overview/api.ts`）的 improving/stable/watch **計數**，是 snapshot 不是趨勢判斷。
- **輸入**：各 exercise 的 e1RM 時序（`epley1RM`，`src/features/training/logic.ts`），需 ≥4 sessions。
- **verdict**：`DECLINING` = 夠多主課表 exercise e1RM 相對近期高點持續下滑 **且** stalledWeeks 超閾值（不是一次沒 PR 就叫退步）；`IMPROVING` = 多數貼近/刷新 PR；`HOLDING` = 之間。
- **confidence**：由資料新鮮度 + 有效 exercise 數決定；太舊或太少 → low → 不觸發壞消息 tier。
- **已實作在 `src/features/overview/strength.ts`**（`computeStrengthSummary` + `buildTrainingEvaluation`，非 api.ts）。`stalledWeeks` 已兩軸化：任一軸 PR（e1RM 天花板或史上最重）都重置 stall clock，所以在**重量軸**有真進步的 lift 不會被誤讀成 declining。詳見 [`PERFORMANCE-PR.md`](./PERFORMANCE-PR.md) 的 Engine coupling。

### `LeanMassEvaluation` — 抗雜訊的流失判斷
- **問題**：`leanMass = weight×(1−bf%)`，體脂由體重計來的很吵，naïve 週對週 delta 亂跳。而「Hold off on further cuts」是最嚴重的指令（叫使用者停掉整個 cut），絕不能誤觸。
- **做法**：用 `leanMass30dAvg` 的慢趨勢（30 天回歸斜率），FALLING 需斜率持續為負且超過 noise floor，`confidence` 需 high。
- **原則**：寧鈍勿敏。

## 輸出形狀

```
DecisionResult {
  tier:       1 | 2 | 3 | 4
  directive:  maintain | reduce_deficit | increase_activity |
              prioritize_recovery | hold_cuts | push_pr
  title:      System card 主句
  reason:     可讀多因子歸因（「HRV 低 + 睡眠差 + 訓練退步」）
  signals:    觸發時各 domain 的狀態（debug / 之後展開 diagnostics）
  confidence: 整體信心
}
```
對外仍走現有 `topRecommendation()` 的位置與 System card，不需改 Overview 佈局。

## 已定案的決定（原 §7 未定案）

1. **快掉但訓練沒事 → 不出獨立提示。** 真在傷身會顯現成 LeanMass FALLING 或 Training DECLINING，階梯自然接住；沒顯現代表身體扛得住，別吵。
2. **System card 一次只出一個 directive。** 出兩句 = 沒決定。`reason` 可多因子，動作唯一。
3. **Push for a PR 只落在 Overview System card**，不複製到 Training tab（避免兩個 surface 要同步；維持 one-source Training Health card）。
4. **門檻給 v1 具體預設值**（上表），實作後用真實資料校。

## 建議實作順序

1. `TrainingEvaluation` + `LeanMassEvaluation`（真正工程 + 信任風險）。
2. 離散化層 + 門檻（集中一處）。
3. 階梯 engine（~50 行 switch）。
4. 接進 `RecContext` / `PROVIDERS`，System card 自動吃到。
