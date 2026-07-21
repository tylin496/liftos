# LiftOS — Codebase Navigation

> 詳細的「去哪改」速查與讀檔紀律見 **`CLAUDE.md`**（canonical）。本檔為精簡入口，兩者需同步更新。

## 專案概述
React 18 / Vite / TypeScript。4 個 tab，每個是一個獨立 feature。
後端：Supabase (Postgres + RLS + Auth)。路徑別名 `@shared/*` = `src/shared/*`。

## 4 個 Tab 入口
| Tab | 角色 | 主檔案 |
|-----|------|--------|
| Overview | 總覽 / 決策引擎 | `src/features/overview/page.tsx` |
| Training | 訓練記錄（主功能，最複雜）| `src/features/training/page.tsx` |
| Nutrition | 卡路里追蹤 | `src/features/nutrition/page.tsx` |
| Health | 體重/體脂趨勢 | `src/features/health/page.tsx` |

## 資料流
```
Supabase → features/*/api.ts → page.tsx → 子元件
```
每個 feature 的 `api.ts` 包含所有 Supabase 查詢。不要在元件裡直接呼叫 supabase。**唯一例外**：`training/LogForms.tsx` 的 AddAssistedForm 直接查 `health_metrics` 做 prefill。

純函數邏輯（統計/計算/解析/評估）抽在各 feature 的 `logic.ts` / `*.ts` module 並附 `.test.ts`——**改邏輯先看有無對應測試，改完跑 `npm test`**。

## Training Feature 結構（最複雜）
| 檔案 | 內容 |
|------|------|
| `page.tsx` | 分組列表、split 切換、新增 exercise |
| `ExerciseCard.tsx` | 主要卡片元件 |
| `LogForms.tsx` | AddEntryForm、AddAssistedForm、InlineEditEntry、InlineEditAssistedEntry（常數/工具在 `logFormHelpers.ts`）|
| `EditExerciseForm.tsx` | 編輯 exercise 本身 |
| `ExprDisplay.tsx` | 重量表達式顯示元件、fmtWeightNum、isLbUnit |
| `parser.ts` | 重量表達式解析（parse、score、normalize）|
| `logic.ts` | 統計計算（computeStats、buildTrendSeries、windowTrend）|
| `deload.ts` | Deload / 停滯偵測 |
| `milestone.ts` / `sessionMilestone.ts` / `TrainingMilestone.tsx` | 里程碑（PR / session / 訓練）|
| `muscleGroup.ts` / `muscleCluster.ts` / `muscleGrid.ts` / `MuscleIcon.tsx` | 肌群分組 / 圖示 |
| `strengthStandards.ts` / `StrengthHealthCard.tsx` | 力量標準 / 健康度卡 |
| `WeeklyVolumeCard.tsx`（+ `WeeklyVolumeTrendSheet.tsx`）| 每週訓練量 |
| `api.ts` | 所有 Supabase 操作 |

## Overview 決策引擎
System card 的建議來自 `overview/recommendations/`：`engine.ts`(ladder 判定) / `nutrition.ts`+`recovery.ts`(providers) / `index.ts`(registry) / `types.ts`。階段/趨勢衍生在 `derive.ts`、`phaseTriggers.ts`、`goal.ts`、`strength.ts`、`format.ts`。動前讀 `docs/DECISION-ENGINE.md`。

## Supabase / Mock 切換
- 正式：`src/shared/lib/supabase.ts`（從 env 讀取 URL/key）
- Mock：`src/shared/lib/mock-supabase.ts`（+ `mock-training-data.ts` / `mock-health-data.ts`）
- 設定：`src/shared/lib/config.ts`
- 環境變數：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`（放在 `.env.local`）

## 建置 / 驗證指令
- `npm run typecheck`（`tsc -b --noEmit`）
- `npm test`（`vitest run`，22 個 `.test.ts`）— 改任何純函數 module 必跑
- `npm run lint:css` — stylelint（token 護欄）+ `scripts/lint-grey-surfaces.mjs`（灰色面規則）
- 交付前跑 `typecheck` + `test` + `lint:css`。UI/視覺改動不用 preview 驗證。

## 設計 Tokens
- 顏色、字體、間距：`src/shared/styles/tokens.css`
- 全域 reset / animations：`src/shared/styles/global.css`

### Token Discipline（護欄）
不要再寫 magic number。新增樣式一律用 token：
- **圓角**：只能用 `--radius`(18 modal/sheet) / `--radius-card`(14 卡片) / `--radius-sm`(10 input/控制項) / `--radius-pill`(999 chip/badge/bar)。圓形用 `50%`。1–4px 圖形細節可例外。
- **字級**：只能用 `--text-*` scale。responsive hero 可用 `clamp()`。**不要**直接寫 `13px`/`17px`。
- **間距**：**Layout**（margin / card / section / grid）一律 `--space-*`（4/8/12/16/20/24/32）。**Component micro-spacing**（chip / badge / button padding / icon-label gap / segmented control）可用 `6px` / `10px`。≤4px 光學微調可例外。**不要**新增 `space-1.5`/`2.5`（避免 scale 失控）。
- **動畫時序**：一律 role token（`tokens.css` §Motion），勿硬寫 ms 或新增曲線；動任何 `@keyframes`/`animation`/`transition` 前先載 `motion` skill。
- 機器強制：`npm run lint:css`（stylelint + declaration-strict-value）。`6px`/`10px`/`-6px` 為白名單 micro-spacing。
- 例外要極少。真的需要 raw 值時加 `/* stylelint-disable-next-line scale-unlimited/declaration-strict-value */` 並寫原因（全 codebase 少數幾處，集中在 layout / global / badge.css）。

## 灰色面規則（`scripts/lint-grey-surfaces.mjs` 強制）
- **被動面**（chip/tag/toggle/segmented/區塊）：`--bg-soft`（小 chip 可 `--rule`），**無 border**。
- **可編輯輸入**（含貼附 stepper）：`--bg-input` 或 `--bg-soft` + `1px solid var(--rule)` + focus ring——border = 可輸入訊號。
- **bar 底軌**：`--rule-strong`。灰底 caption 至少 `--ink-3`。

## 常見任務速查
| 任務 | 去哪改 |
|------|--------|
| 改顏色 / 間距 / 字級 | `tokens.css` |
| 改 Training 卡片 UI | `ExerciseCard.tsx` |
| 改輸入表單邏輯 | `LogForms.tsx` |
| 改重量顯示格式 | `ExprDisplay.tsx` |
| 改 Deload / 停滯偵測 | `training/deload.ts` |
| 改卡路里計算邏輯 | `nutrition/logic.ts` |
| 改營養評估 / 建議 | `nutrition/evaluation.ts`、`recommendation.ts` |
| 改 Nutrition Today UI | `nutrition/today.tsx` |
| 改 Overview 決策建議 | `overview/recommendations/` |
| 改 Overview 數字 | `overview/api.ts` + `overview/page.tsx` |
| 改 Health TDEE / 目標區間 | `health/tdee.ts`、`activeTarget.ts` |
| 改 Shell / TabBar / tab 切換 | `app/layout/Shell.tsx`（先載入 `tab-navigation-scroll` skill）|

## Shell 結構
```
main.tsx → App.tsx → AuthGate → Shell（Header + feature page + TabBar）
```
`NavContext` 管當前 tab；`TabActivityContext` 追蹤每個 tab 的最後活躍時間；`SessionContext` 管使用者 session。
