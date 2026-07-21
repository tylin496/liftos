# LiftOS — Codebase Navigation

React 18 / Vite / TypeScript + Supabase (Postgres + RLS + Auth)。4 tabs = 4 個獨立 feature：**Overview**（總覽/決策）、**Training**（訓練，主功能，最複雜）、**Nutrition**（卡路里）、**Health**（體重/體脂）。

Shell 結構：`main.tsx → App.tsx → AuthGate → Shell（Header + feature page + TabBar）`。`NavContext` 管當前 tab，`TabActivityContext` 追蹤各 tab 最後活躍時間，`SessionContext` 管使用者 session。路徑別名 `@shared/*` = `src/shared/*`。

## 資料流
`Supabase → features/*/api.ts → page.tsx → 子元件`。所有 Supabase 查詢集中在各 feature 的 `api.ts`，元件不直呼 supabase。**唯一例外**：`training/LogForms.tsx` 的 AddAssistedForm 直接查 `health_metrics` 做 prefill。

純函數邏輯（統計/計算/解析/評估）抽在各 feature 的 `logic.ts` / `*.ts` module 並附 `.test.ts`——**改邏輯先看有無對應測試，改完跑 `npm test`**。

## 速查（去哪改）
| 任務 | 檔案 |
|------|------|
| Overview 總覽頁 | `overview/page.tsx` + `overview/api.ts` |
| **決策引擎**（System card 的建議）| `overview/recommendations/`：`engine.ts`(ladder 判定) / `nutrition.ts`+`recovery.ts`(providers) / `index.ts`(registry) / `types.ts`。動前讀 `docs/DECISION-ENGINE.md` |
| Overview 階段/趨勢衍生 | `overview/derive.ts`、`phaseTriggers.ts`、`goal.ts`、`strength.ts`、`format.ts` |
| 階段報告 sheet | `overview/PhaseReportSheet.tsx` + `shared/lib/phaseReport.ts` |
| Training 主頁（分組列表 / split 切換 / 新增 exercise）| `training/page.tsx` |
| Training 卡片 UI | `training/ExerciseCard.tsx` |
| 輸入表單（Add/InlineEdit ×4）| `training/LogForms.tsx`；常數/工具在 `logFormHelpers.ts`；編輯 exercise 用 `EditExerciseForm.tsx` |
| 重量顯示格式 | `training/ExprDisplay.tsx`（fmtWeightNum、isLbUnit）|
| 重量表達式解析 | `training/parser.ts`（parse、score、normalize）|
| 訓練統計 / 趨勢 | `training/logic.ts`（computeStats、buildTrendSeries、windowTrend）|
| Deload / 停滯偵測 | `training/deload.ts` |
| 里程碑（PR/session/訓練）| `training/milestone.ts`、`sessionMilestone.ts`、`TrainingMilestone.tsx` |
| 肌群分組 / 圖示 | `training/muscleGroup.ts`、`muscleCluster.ts`、`muscleGrid.ts`、`MuscleIcon.tsx` |
| 力量標準 / 健康度卡 | `training/strengthStandards.ts`、`StrengthHealthCard.tsx` |
| 每週訓練量卡 | `training/WeeklyVolumeCard.tsx`（+ `WeeklyVolumeTrendSheet.tsx`）|
| 卡路里計算 | `nutrition/logic.ts`；Today UI `nutrition/today.tsx`；歷史 `nutrition/history.tsx` |
| 營養評估 / 建議 / Insight | `nutrition/evaluation.ts`(+`evaluationApi.ts`)、`recommendation.ts`、`targetRanges.ts`、`NutritionInsightCard.tsx`、`NutritionConfigContext.tsx` |
| Health 體重/體脂頁 | `health/page.tsx`；趨勢 `health/TrendSheet.tsx` |
| TDEE / 目標區間 / 數學 | `health/tdee.ts`、`activeTarget.ts`、`math.ts` |
| Shell / TabBar / tab 切換 / scroll | `app/layout/Shell.tsx`（**先載入 `tab-navigation-scroll` skill**）；`activeScroller.ts`、`revealScroll.ts`、`swipeLock.ts` |
| 全螢幕高度 / 狀態列 / safe-area / PWA meta | **先載入 `ios-standalone-viewport` skill**；一律 `var(--app-height)`，勿寫 100vh/100dvh |
| 動畫 / 過場 / count-up | **先載入 `motion` skill**；只用 `--dur-*` / `--ease-*` role token |
| 顏色 / 間距 / 字級 token | `src/shared/styles/tokens.css`；全域 reset/animations `global.css` |
| 共用元件 | `shared/components/`（ActivityRing、AnimatedNumber、Badge、SegmentedControl、Toast、Metric…）|
| 共用 hooks | `shared/hooks/`（useTrendChart、useChartScrub、useSheetSwipe、useHorizontalSwipe、useCountUp、useFocusTrap…）|
| 匯出全部資料 | `shared/lib/copyAllData.ts` |
| 找 CSS class | 大 CSS 檔頂部有 TOC（附行號），先看 TOC 跳行 |

## 建置 / 驗證指令
- `npm run typecheck`（`tsc -b --noEmit`）— 型別檢查
- `npm test`（`vitest run`，22 個 `.test.ts`）— 改任何 `logic.ts` / 純函數 module 必跑
- `npm run lint:css` — stylelint（token 護欄）+ `scripts/lint-grey-surfaces.mjs`（灰色面規則）
- `npm run dev` / `npm run build` / `npm run preview`
- 交付前跑 `typecheck` + `test` + `lint:css`，輸出用 tail 截尾。**UI/視覺改動不用 preview 驗證**（三項過了就交給使用者看）。

## Token 節約守則（讀檔紀律）
- **>600 行的檔案不要整檔讀**：`training.css`(2837)、`overview/page.tsx`(2083)、`nutrition.css`(1560)、`overview.css`(1481)、`training/page.tsx`(1477)、`health/page.tsx`(1400)、`copyAllData.ts`(1234)、`ExerciseCard.tsx`(1232)、`layout.css`(1161)、`Shell.tsx`(1052)、`training/logic.ts`(1044)、`today.tsx`(810)、`LogForms.tsx`(752)、`health.css`(739)、`overview/strength.ts`(632)、`health/math.ts`(606)、`strengthHealthCard.css`(601)。先 `grep -n` 定位符號，再用 Read 的 offset/limit 讀該區段。
- 大 CSS 檔先讀前 ~30 行的 TOC，直接跳行號。
- `database.types.ts` 是生成檔：grep table 名即可，永遠不要整檔讀。
- 部分 src 檔含 UTF-8 分隔符（`─`/`✓`），會被 grep/file 誤判成 binary 而靜默跳過：`grep` 一律加 `-a`。
- `docs/*.md`（ARCHITECTURE、DECISION-ENGINE、HEALTH-SYNC、LAYOUT-STABILITY、COLOR-SYSTEM、PERFORMANCE-PR、TRAINING-HEALTH-BRIEF）只在任務直接相關時讀。

## Supabase / Mock
正式 `shared/lib/supabase.ts`（讀 env）、mock `mock-supabase.ts`（+ `mock-training-data.ts` / `mock-health-data.ts`），切換 `config.ts`。env：`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`（`.env.local`）。

## Token Discipline（護欄，lint:css error 級強制）
不寫 magic number；`npm run lint:css` 會擋。
- **圓角**：`--radius`(18 modal) / `--radius-card`(14) / `--radius-sm`(10 input/控制項) / `--radius-pill`(999)。圓形 `50%`；1–4px 圖形細節可例外。
- **字級**：只用 `--text-*`；responsive hero 可 `clamp()`。
- **間距**：layout 一律 `--space-*`（4/8/12/16/20/24/32）；component micro-spacing 白名單 `6px`/`10px`/`-6px`；≤4px 光學微調可例外。不新增 `space-1.5`/`2.5`。
- 真的要 raw 值：`/* stylelint-disable-next-line scale-unlimited/declaration-strict-value */` + 原因（全 codebase 少數幾處，集中在 layout / global / badge.css，每處都附原因）。
- **動畫時序**：一律 role token（`tokens.css` §Motion），勿硬寫 ms 或新增曲線；動任何 `@keyframes`/`animation`/`transition` 前先載 `motion` skill。

## 灰色面規則（`scripts/lint-grey-surfaces.mjs` 強制）
- **被動面**（chip/tag/toggle/segmented/區塊）：`--bg-soft`（小 chip 可 `--rule`），**無 border**。
- **可編輯輸入**（含貼附 stepper）：`--bg-input` 或 `--bg-soft` + `1px solid var(--rule)` + focus ring——border = 可輸入訊號，被動面加了會被誤讀。
- **bar 底軌**：`--rule-strong`。radius：區塊/輸入 `--radius-sm`，chip/pill `--radius-pill`。
- 灰底 caption 至少 `--ink-3`（`--ink-4` 疊 `--bg-soft` 對比不足）。
