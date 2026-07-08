# LiftOS — Codebase Navigation

React / Vite / TypeScript + Supabase (Postgres + RLS + Auth)。4 tabs = 4 個獨立 feature。

## 資料流
`Supabase → features/*/api.ts → page.tsx → 子元件`。所有 Supabase 查詢在各 feature 的 `api.ts`，元件不直呼 supabase（唯一例外：AddAssistedForm 的 health_metrics prefill）。

## 速查（去哪改）
| 任務 | 檔案 |
|------|------|
| Overview 總覽 | `overview/page.tsx` + `overview/api.ts` |
| Training 主頁（分組列表 / split 切換）| `training/page.tsx` |
| Training 卡片 UI | `training/ExerciseCard.tsx` |
| 輸入表單（Add/InlineEdit ×4）| `training/LogForms.tsx`；常數/工具在 `logFormHelpers.ts` |
| 重量顯示格式 | `training/ExprDisplay.tsx`（fmtWeightNum、isLbUnit）|
| 重量表達式解析 | `training/parser.ts`（parse、score、normalize）|
| 訓練統計 / 停滯 | `training/logic.ts`（computeStats、buildStagnationView）；徽章 `StagnationBadge.tsx` |
| 卡路里計算 | `nutrition/logic.ts`；Today UI `nutrition/today.tsx` |
| Health 體重/體脂 | `health/page.tsx` |
| Shell / TabBar | `app/layout/Shell.tsx`（**先載入 `tab-navigation-scroll` skill**）|
| 顏色 / 間距 / 字級 | `src/shared/styles/tokens.css`；全域 reset/animations `global.css` |
| 動畫 / 過場 / count-up | **先載入 `motion` skill**；只用 `--dur-*` / `--ease-*` role token |

Shell 結構：`App.tsx → AuthGate → Shell（Header + TabBar + feature page）`。`NavContext` 管當前 tab，`TabActivityContext` 追蹤各 tab 最後活躍時間。

## Supabase / Mock
正式 `shared/lib/supabase.ts`、mock `mock-supabase.ts`、切換 `config.ts`。env：`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`（`.env.local`）。

## Token Discipline（護欄，lint:css error 級強制）
不寫 magic number；`npm run lint:css` 會擋。
- **圓角**：`--radius`(18 modal) / `--radius-card`(14) / `--radius-sm`(10 input/控制項) / `--radius-pill`(999)。圓形 `50%`；1–4px 圖形細節可例外。
- **字級**：只用 `--text-*`；responsive hero 可 `clamp()`。
- **間距**：layout 一律 `--space-*`（4/8/12/16/20/24/32）；component micro-spacing 白名單 `6px`/`10px`/`-6px`；≤4px 光學微調可例外。不新增 `space-1.5`/`2.5`。
- 真的要 raw 值：`/* stylelint-disable-next-line scale-unlimited/declaration-strict-value */` + 原因（目前全 codebase 僅 1 處）。
- **動畫時序**：一律 role token（`tokens.css` §Motion），勿硬寫 ms 或新增曲線；動任何 `@keyframes`/`animation`/`transition` 前先載 `motion` skill。

## 灰色面規則
- **被動面**（chip/tag/toggle/segmented/區塊）：`--bg-soft`（小 chip 可 `--rule`），**無 border**。
- **可編輯輸入**（含貼附 stepper）：`--bg-input` 或 `--bg-soft` + `1px solid var(--rule)` + focus ring——border = 可輸入訊號，被動面加了會被誤讀。
- **bar 底軌**：`--rule-strong`。radius：區塊/輸入 `--radius-sm`，chip/pill `--radius-pill`。
- 灰底 caption 至少 `--ink-3`（`--ink-4` 疊 `--bg-soft` 對比不足）。
