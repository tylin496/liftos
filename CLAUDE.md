# LiftOS — Codebase Navigation

## 專案概述
React / Vite / TypeScript。4 個 tab，每個是一個獨立 feature。
後端：Supabase (Postgres + RLS + Auth)。

## 4 個 Tab 入口
| Tab | 角色 | 主檔案 |
|-----|------|--------|
| Overview | 總覽摘要 | `src/features/overview/page.tsx` |
| Training | 訓練記錄（主功能）| `src/features/training/page.tsx` |
| Nutrition | 卡路里追蹤 | `src/features/nutrition/page.tsx` |
| Health | 體重/體脂趨勢 | `src/features/health/page.tsx` |

## 資料流
```
Supabase → features/*/api.ts → page.tsx → 子元件
```
每個 feature 的 `api.ts` 包含所有 Supabase 查詢。不要在元件裡直接呼叫 supabase（除了 AddAssistedForm 的 health_metrics prefill）。

## Training Feature 結構（最複雜）
原本一個 1760 行的 ExerciseCard.tsx 已拆分為：

| 檔案 | 內容 |
|------|------|
| `ExerciseCard.tsx` | 主要卡片元件 + re-exports |
| `LogForms.tsx` | AddEntryForm、AddAssistedForm、InlineEditEntry、InlineEditAssistedEntry |
| `ExprDisplay.tsx` | 重量表達式顯示元件、fmtWeightNum、isLbUnit |
| `logFormHelpers.ts` | 常數、工具函數、useScrollAboveKeyboard |
| `StagnationBadge.tsx` | 停滯/進步徽章元件 |
| `@shared/components/ConfirmDialog.tsx` | ConfirmProvider、useConfirm（位於 shared，非 training 目錄）|
| `logic.ts` | 統計計算（computeStats、buildStagnationView 等）|
| `parser.ts` | 重量表達式解析（parse、score、normalize）|
| `api.ts` | 所有 Supabase 操作 |
| `page.tsx` | 分組列表、split 切換、新增 exercise |

## Supabase / Mock 切換
- 正式：`src/shared/lib/supabase.ts`（從 env 讀取 URL/key）
- Mock：`src/shared/lib/mock-supabase.ts`（本地假資料）
- 設定：`src/shared/lib/config.ts`（SUPABASE_URL、SUPABASE_ANON_KEY）
- 環境變數：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`（放在 `.env.local`）

## 設計 Tokens
- 顏色、字體、間距：`src/shared/styles/tokens.css`
- 全域 reset / animations：`src/shared/styles/global.css`

### Token Discipline（護欄）
不要再寫 magic number。新增樣式一律用 token：
- **圓角**：只能用 `--radius`(18 modal/sheet) / `--radius-card`(14 卡片) / `--radius-sm`(10 input/控制項) / `--radius-pill`(999 chip/badge/bar)。圓形用 `50%`。1–4px 圖形細節可例外。
- **字級**：只能用 `--text-*` scale。responsive hero 可用 `clamp()`。**不要**直接寫 `13px`/`17px`。
- **間距**：**Layout**（margin / card / section / grid）一律 `--space-*`（4/8/12/16/20/24/32）。**Component micro-spacing**（chip / badge / button padding / icon-label gap / segmented control）可用 `6px` / `10px`。≤4px 光學微調可例外。**不要**為了形式把 chip 硬改成 8/12px,也**不要**新增 `space-1.5`/`2.5`（避免 scale 失控）。
- 機器強制：`npm run lint:css`（stylelint + declaration-strict-value）。**radius + font-size + spacing 全數 error 級強制**。`6px`/`10px`/`-6px` 為白名單 micro-spacing。
- 例外要極少。真的需要 raw 值（如幾何置中）時加 `/* stylelint-disable-next-line scale-unlimited/declaration-strict-value */` 並寫原因——目前全 codebase 只有 1 處（confetti 粒子置中）。

## 常見任務速查
| 任務 | 去哪改 |
|------|--------|
| 改顏色 / 間距 | `tokens.css` |
| 改 Training 卡片 UI | `ExerciseCard.tsx` |
| 改輸入表單邏輯 | `LogForms.tsx` |
| 改重量顯示格式 | `ExprDisplay.tsx` |
| 改停滯徽章 | `StagnationBadge.tsx` |
| 改卡路里計算邏輯 | `nutrition/logic.ts` |
| 改 Nutrition Today UI | `nutrition/today.tsx` |
| 改 Overview 數字 | `overview/api.ts` + `overview/page.tsx` |
| 改 Shell / TabBar | `app/layout/Shell.tsx` |

## Shell 結構
```
App.tsx → AuthGate → Shell
  Shell → Header + TabBar + feature page
```
`NavContext` 管理當前 tab；`TabActivityContext` 追蹤每個 tab 的最後活躍時間。
