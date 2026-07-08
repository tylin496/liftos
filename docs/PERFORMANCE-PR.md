# LiftOS — Performance PR（log-time feedback + engine coupling）

把「新紀錄」拆成兩軸,讓 e1RM 看不見的「更重的真實工作」也被認可,**同時不動 e1RM status 模型**。

## ⭐ ScoreMode：每個動作有「一個 primary 評分指標」（2026-07-08）

**每個動作依 `exercises.compound` 決定 primary metric：複合 = e1RM，孤立 = Volume（best-set tonnage = 重量 × 次數，kg·reps）。** `type ScoreMode = "compound" | "isolation"` 在 `logic.ts`，`cmpStrength(a, b, mode)` 依此切軸——**它仍是唯一比較器**，只是被 mode 參數化。下面整份文件「純 e1RM」的敘述,對**孤立動作**一律換成 tonnage（複合維持原樣）。

**為什麼：** Epley e1RM 結構性地獎勵低 reps。孤立動作刻意改高 rep block（側平舉 14×12 → 10×16）會讓 e1RM 掉 ~28%（19.6→14）被誤判成退步,但 tonnage 幾乎不動（168→160，~95%）。這是換一把更合適的尺,不是補破洞。孤立動作的 PR 也收斂成單一 🏆 **Hypertrophy PR**（新 tonnage 天花板）。細節見 memory `compound-isolation-score-mode`。

**「primary」是關鍵字：** `metric` 指的是**評分採用哪一個**,不是唯一存在的。e1RM 對孤立動作仍算得出來（只是不拿來評分）,未來也可能再加 relative strength / velocity 等——它們不會取代 primary。

**匯出 schema 2.6（`copyAllData.ts`）：** 每個動作帶一個 `metric: "e1rm" | "volume"`,並用**具體欄位名**（`bestE1RM`/`bestVolume`、`pr.e1rm`/`pr.volume`、`logs[].e1rm`/`logs[].volume`）而非抽象 `best`+`metric` 查表,讓 JSON self-describing。`units.volume = "kg·reps"`（不是 `"kg"`）。一句話定義：

> **Exactly one primary metric exists per exercise.** Compound lifts use e1RM; isolation lifts use Volume (kg·reps). `retentionPct`, `status`, and PR calculations always reference the exercise's primary metric. e1RM is still computable for isolation lifts but is not their scoring axis.

## 問題

Training status/PR 原本 100% 靠 e1RM(Epley)。Epley 把 `77kg×7 ≈ 75kg×8` 評成同一個 e1RM,所以真的更重的一組會被當成**沒進步**、默默記下。拆兩軸讓更重的真實工作被看見。

## 兩軸

- 🏆 **Strength PR** — 新的 rounded-e1RM 天花板。
- 💪 **Performance PR** — 不是新天花板,而是**史上最重的完成重量**,或在 e1RM 平手時**做了更多總 reps**。
- 🎯 **Milestone** — 整數重量。**未建**(需要 per-exercise 邊界規則)。

## 已 ship 的 feedback 層(2 檔)

**`src/features/training/logic.ts`** — 只加不刪:
```ts
interface PRBests { e1rm: number; weightKg: number }
computePRBests(logs, setCount): PRBests          // 全時期 max e1RM & max 完成重量
type PRKind = "strength" | "performance" | null
classifyPR(entry, prev: PRBests, prevBest): PRKind
```
`classifyPR` 規則(依序):
```
e1 = round(entry.e1rm,1); prevE1 = round(prev.e1rm,1)
e1 > prevE1                     → "strength"     // 新天花板
entry.weightKg > prev.weightKg  → "performance"  // 史上最重(77kg 案例)
cmpStrength(entry, prevBest) > 0 → "performance" // e1RM 平手、更多 reps
else                            → null
```
第一組永遠是 Strength PR。e1RM round 到 UI 的 1 位小數,所以只是「顯示上平手」的組不會被誤標。

**`src/features/training/ExerciseCard.tsx`** — `handleAdd`/`handleEdit` 分三層:strength→金色 confetti;performance→success toast(**無** confetti/prFlash);null→`Set logged`。Edit 對照其他所有 log(排除自己),編輯現任最佳列時抑制 PR。

## 🔒 不可破壞的 invariant

`cmpStrength` 是**唯一**餵 status / retention / trend / 歷史列 PR 標記的比較器（自 2026-07-08 起依 ScoreMode 切軸：複合 e1RM→totalReps、孤立 tonnage→重量→reps，見頂端 ScoreMode 段）。Performance PR **只**活在 log-time feedback。歷史列**只顯示一個** PR 標記(產品約束)。**別讓 performance 軸滲進 status 比較器。**

## 🔗 Engine coupling（已實作,連到 `DECISION-ENGINE.md`）

Decision Engine 的 `TrainingEvaluation`(訓練是否退步)判 `DECLINING` 的條件是:
```ts
// overview/strength.ts — buildTrainingEvaluation
exercises.filter(e => e.status === "watch" && e.stalledWeeks >= 3)
```
所以 `stalledWeeks` 直接決定 engine 會不會誤觸 Prioritize-recovery / Reduce-deficit。

**已做:`computeStrengthSummary` 的 `stalledWeeks` 改成兩軸。** 現在 stall clock 在「任一軸 PR」時重置——mirror `classifyPR` 的前兩支(新 rounded-e1RM 天花板 **或** 新史上最重),所以一個 Epley-flat 的更重頂組(Performance PR)也會重置。效果:一個在**重量軸**有真進步的 lift 不會被 engine 讀成 declining。`buildTrainingEvaluation` 不用改,透明變準。測試在 `overview/strength.test.ts`。

**刻意留下的兩點(守 invariant):**
- **status / hero retention % 維持動作 primary metric（複合 e1RM、孤立 tonnage）。** 兩軸只加進 `stalledWeeks`,只會**移除誤判的 decline,永遠不造出 improvement**。`IMPROVING`(→ engine Tier 4「Push for a PR」)同樣走 primary metric。（原文寫「純 e1RM」——2026-07-08 ScoreMode 後對孤立動作是 tonnage。）
- **reps-tiebreak 第三支未納入 stall clock。** 它需要 `setCount`(目前沒 thread 進 `computeStrengthSummary`);heaviest-weight 那支已涵蓋主要案例(77kg)。要完全忠實需把 setCount 傳進來——見下方「未建」。

> ⚠️ 注意:`computeStrengthSummary` 已從 `overview/api.ts` **搬到 `overview/strength.ts`**(api.ts re-export)。舊 handoff 指向 api.ts,現以 strength.ts 為準,`buildTrainingEvaluation` 就在隔壁。

## 未建（剩下的 engine work）

1. **snapshotHighlight「本週新 PR」納入 Performance PR** — 目前仍只數 e1RM。這是 highlight 不是 status,不碰 engine 的 `IMPROVING`。
2. **「Completed all working sets」Performance PR** — 需要結構化 target sets/reps;`exercises.target` 現為自由文字(data-model 工作)。同一份 setCount 若 thread 進 `computeStrengthSummary`,也能讓 stall clock 納入 reps-tiebreak 第三支。
3. **Milestone** — 需要邊界規則(側平舉 vs 深蹲尺度差很大)。

## Open knobs（產品決定）

Strength confetti vs 全 toast · toast emoji · 一個 rep 底線讓一組大重量單次不算「completed workload」。
