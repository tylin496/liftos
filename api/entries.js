import { setCorsHeaders } from "./_cors.js";
import { isAuthorized } from "./_auth.js";

async function notionFetch(path, options = {}) {
  return fetch(`https://api.notion.com/v1${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${process.env.NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export default async function handler(req, res) {
  setCorsHeaders(req, res, "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  try {
    const since = req.query.since;
    const until = req.query.until;

    if (!isValidDateString(since)) {
      return res.status(400).json({ error: "Invalid since date" });
    }
    if (until !== undefined && !isValidDateString(until)) {
      return res.status(400).json({ error: "Invalid until date" });
    }

    const filter = until
      ? { and: [
          { property: "Date", date: { on_or_after: since } },
          { property: "Date", date: { on_or_before: until } }
        ] }
      : { property: "Date", date: { on_or_after: since } };

    const response = await notionFetch(
      `/databases/${process.env.NOTION_DATABASE_ID}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter,
          sorts: [{ property: "Date", direction: "ascending" }],
          page_size: 100
        })
      }
    );

    const data = await response.json();
    if (!response.ok) throw { status: response.status, data };

    const entries = data.results.map((page) => {
      const p = page.properties;
      return {
        date: p.Date?.date?.start || "",
        calories: p.Calories?.number || 0,
        protein: p.Protein?.number || 0,
        tdee: p.TDEE?.number || 2705,
        calorieTarget: p["Calorie Target"]?.number ?? null,
        proteinTarget: p["Protein Target"]?.number ?? null,
        deficitTarget: p["Deficit Target"]?.number ?? null
      };
    });

    return res.status(200).json({ ok: true, entries });
  } catch (error) {
    console.error(error);
    const upstreamStatus = Number(error?.status);
    const safeStatus = upstreamStatus >= 500 ? upstreamStatus : 502;
    return res.status(safeStatus).json({ error: "API error" });
  }
}
