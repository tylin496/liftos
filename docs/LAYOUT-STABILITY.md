# LiftOS Layout Stability — governing law

一張卡在 loading / empty / loaded 三個狀態下必須是**同一個高度**。資料到達不可以讓頁面跳動。Loading 不是獨立的 markup，是同一份 DOM 套上 `loading-card` class。

## 1. Loaded layout === Skeleton layout

Skeleton 不是另外畫一份卡片。是真正的元素結構 + 佔位文字，由 `loading-card` class 讓數值透明並套 shimmer。差別只在「內容可見 vs 內容 loading」，不是兩棵不同的 JSX 樹。

```tsx
// ✗ 錯 — 獨立 skeleton 分支，會跟真實版面逐漸走鐘
if (!entries) return <section className="page-card loading-card">…假 markup…</section>;
return <section className="page-card">…真 markup…</section>;

// ✓ 對 — 同一棵樹，class 決定要不要 shimmer
const loading = !entries;
return <section className={`page-card${loading ? " loading-card" : ""}`}>…</section>;
```

## 2. 條件渲染一定要保留高度

loaded 狀態才出現的區塊（狀態 pill、balance row、attention list）在 loading 時**不能整段消失**，要 render 出來、用 `visibility: hidden` 藏起來。`display: none` 或整段不 render 都會讓卡片在資料到達時長高/縮矮。

```css
.nutri-pill-row--empty { visibility: hidden; }
```

同理套用在無法簡單 shimmer 的區塊（例如百分比 legend）：寧可 `visibility: hidden` 保留高度，也不要讓文字裸露出 0 / — 這種假數值。

## 3. 圖片 / 圖表區塊保留版位

沒有內容時也要 render 一個同尺寸的空 div（例如 `ex-ident-wrap`），不能整塊省略。複雜視覺化（chart、canvas）例外：可以用單一 `.skel` 佔位塊取代真實圖表 DOM，但佔位塊的高度必須等於載入後的圖表高度。

## 4. Skeleton 樹要跟著 loaded 樹一起維護

只要 loaded 版面新增一個會影響高度的區塊，第一個要問的問題就是「skeleton 有沒有對應的佔位？」沒有就補。這條規則在資料流程改變、卡片改版時最容易被忘記，是層架構漂移的最大來源。

---

## 附則

- Shimmer 統一走 `--motion-shimmer` token（見 `tokens.css`），任何卡片不可自訂秒數。
- Shimmer 視覺權重要比 loaded 內容安靜——太搶眼代表漸層 opacity 開太高，調低或拉長動畫時間。
- Progress / distribution bar 類的佔位維持固定寬度（如 35%）+ `opacity: 0.3`，不套 shimmer。
- 詳細 class 對照與逐段範例見 `.claude/skills/skeleton-design/`。
