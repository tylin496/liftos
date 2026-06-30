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
每個 feature 的 `api.ts` 包含所有 Supabase 查詢。不要在元件裡直接呼叫 supabase（除了 AddAssistedForm 的 body_metrics prefill）。

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
