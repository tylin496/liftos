# LiftOS — Architecture

合併 **Calorie Tracker**（本 repo）與 **Lift Log**（`/Users/thomas/Documents/lift-log`）成單一 app，後端從 Notion 改為 **Supabase**。

## 北極星

一個你每天會打開的 V1。打開永遠停在 **Overview**。殺手功能：用過去 30 天的真實資料（Apple Health 體重/體脂/活動量 + 已記錄熱量）**自動重估 TDEE 並一鍵更新減脂方案**，取代手動每月算。

## 資訊架構（4 個主頁）

```
LiftOS
├── Overview   首頁 Dashboard（聚合三邊：今日熱量/訓練/體重 + TDEE + 週趨勢）
├── Training   = Lift Log（Push / Pull / Legs）
├── Nutrition  = Calorie Tracker（Today / History / Programs）
└── Health     Apple Health 資料展示（Weight / Body Fat / Active Energy）+ TDEE 趨勢
```

真正的功能只有 Training / Nutrition / Health 三個；Overview 是首頁。Health 不過度拆（`page.tsx` + `api.ts`）。

## 已定案的決定

1. **全部收斂到 React**（不維持雙引擎）。
2. **收斂進現有 `liftos` repo**。
3. **地基 = Vite + React + TypeScript**（放棄 in-browser Babel）。
4. **後端 = Supabase**（Postgres + Auth + RLS），取代 Notion。
5. **登入 = Supabase Auth（Google）+ RLS**，丟掉兩套自製 OAuth/JWT。
6. **前端直連 Supabase**（`@supabase/supabase-js`，anon key + RLS），丟掉 ~15 支 Vercel CRUD 端點。唯一伺服器端 = 一支 Supabase Edge Function 給 iOS Shortcut。

## 架構圖

```
前端 (Vite + React + TS) ── GitHub Pages，base /LiftOS/
        │  supabase-js (anon key + 使用者 session，RLS 保護)
        ▼
Supabase (專案 gcznowwjbeqihhllllpz, ap-northeast-2, PG17)
├── Postgres  ← 唯一資料來源
│   ├── nutrition_entries / nutrition_config
│   ├── exercises / training_logs
│   └── body_metrics          ← Apple Health
├── Auth (Google) + RLS       ← 每張表 4 條 policy: auth.uid() = user_id
└── Edge Function: health-sync ← iOS Shortcut 唯一入口（共用 secret + service role）
```

## 程式結構

```
liftos/
├── index.html · vite.config.ts · tsconfig.json
├── public/                       # favicon / icon / webmanifest
├── legacy/nutrition/             # 舊 vanilla calorie app（P1 移植來源）
├── src/
│   ├── app/                      # main.tsx · App.tsx · layout/(Shell,Header,TabBar)
│   ├── features/
│   │   ├── overview/  training/  nutrition/  health/   # 各 page.tsx (+ api.ts)
│   ├── shared/
│   │   ├── lib/      # config · supabase · auth · useAuth · database.types
│   │   ├── components/  styles/(tokens.css,global.css)
│   └── vite-env.d.ts
├── supabase/migrations/0001_init.sql   # schema + RLS（已套用到專案）
└── api/ · scripts/               # 舊 Notion/Vercel（搬完即可移除）
```

## 資料層

- 每張表都有 RLS：`auth.uid() = user_id`，所以瀏覽器能用 anon key 直接讀寫。
- 前端資料存取集中在各 feature 的 `api.ts`，用型別化的 supabase-js（`database.types.ts` 由 `supabase gen types` 產生）。
- `nutrition_config.phase_deficits` = `[805,655,455,150]`（aggressive/moderate/cruise/maintenance）。

### Health ingest（iOS Shortcut）

Shortcut 無法跑互動式 OAuth，所以走 Edge Function：

```
POST <project>.supabase.co/functions/v1/health-sync
  Header: X-Sync-Token: <共用 secret>
  Body:   [{ metric_date, weight_kg?, body_fat_pct?, active_energy_kcal? }, ...]
  行為:   service role 依 (user_id, metric_date) upsert，idempotent
```

## 自動 TDEE 引擎

```
TDEE = 平均攝取 − (體重變化_kg × 7700 / 天數)
slope = 體重對日期的線性回歸斜率（濾水分波動）
dailyDeficit = −slope × 7700
confidence = f(天數, 覆蓋率, 回歸 R²)
```

Postgres view 或前端計算皆可（個人 app 前端足夠）。"Update Targets" 用新 TDEE 當底重算各 phase target，寫回 `nutrition_config`。首頁顯示 7 天趨勢；TDEE 每 30 天才更新。

## 漸進路徑

- **P0 地基** ✅ Vite+TS shell、4 tab、design tokens、Supabase client、Supabase Auth gate（程式完成；Google provider 待 dashboard 設定）、schema 已上線、型別已產生。
- **P1 Nutrition** — `legacy/nutrition/app.js` 移植成 React + Supabase。
- **P2 Training** — Lift Log 搬入 + 接 Supabase。
- **P3 Health + health-sync** — body_metrics 頁 + Edge Function + iOS Shortcut。
- **P4 自動 TDEE + Overview** — 回歸算 TDEE、寫回方案、首頁聚合。
- **資料搬遷** — 一次性 Notion → Supabase 腳本（兩邊舊資料）。

## 環境變數

- 前端 `.env.local`（gitignored，public-safe）：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。
- 伺服器端（Edge Function / 搬遷腳本，**不進 chat / git**）：`SUPABASE_SERVICE_ROLE_KEY`、`HEALTH_SYNC_SECRET`、`NOTION_TOKEN`。

## 部署

前端 build 後 → GitHub Pages（`/LiftOS/`）。後端全在 Supabase（含 Edge Function）。Vercel/Notion 在搬遷完成後退場。
