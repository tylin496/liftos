const FAT_KCAL_PER_KG = 7700;
const MAX_RANGE_DAYS = 370;

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

function toValidNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function getRangeDays(start, end) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  return Math.floor((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
}

function readTextProperty(property) {
  if (!property) return null;
  if (property.type === "select") return property.select?.name || null;
  return property.rich_text?.map((part) => part.plain_text || "").join("") || null;
}

function mapEntry(page) {
  const properties = page.properties;

  return {
    id: page.id,
    date: properties.Date?.date?.start || "",
    calories: properties.Calories?.number || 0,
    protein: properties.Protein?.number || 0,
    tdee: properties.TDEE?.number || 2705,
    calorieTarget: properties["Calorie Target"]?.number || null,
    proteinTarget: properties["Protein Target"]?.number || null,
    cutStartDate: properties["Cut Start Date"]?.date?.start || null,
    cutPhaseIndex: properties["Cut Phase"]?.number ?? null,
    cutPhaseName: readTextProperty(properties["Cut Phase Name"]),
    cutWeek: properties["Cut Week"]?.number ?? null,
    deficitTarget: properties["Deficit Target"]?.number ?? null
  };
}

async function getRangeEntries(start, end) {
  const results = [];
  let cursor = undefined;

  do {
    const response = await notionFetch(
      `/databases/${process.env.NOTION_DATABASE_ID}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            and: [
              {
                property: "Date",
                date: {
                  on_or_after: start
                }
              },
              {
                property: "Date",
                date: {
                  on_or_before: end
                }
              }
            ]
          },
          sorts: [
            {
              property: "Date",
              direction: "ascending"
            }
          ],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {})
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw {
        status: response.status,
        data
      };
    }

    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return results.map(mapEntry);
}

async function getLatestPhaseEntry(end) {
  let cursor = undefined;

  do {
    const response = await notionFetch(
      `/databases/${process.env.NOTION_DATABASE_ID}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            property: "Date",
            date: {
              on_or_before: end
            }
          },
          sorts: [
            {
              property: "Date",
              direction: "descending"
            }
          ],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {})
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw {
        status: response.status,
        data
      };
    }

    const entry = (data.results || [])
      .map(mapEntry)
      .find((item) => item.cutStartDate || item.cutPhaseName || item.cutPhaseIndex !== null);

    if (entry) return entry;

    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return null;
}

function summarizePhase(start, end, fallbackTdee, entries, latestEntry) {
  const count = entries.length;
  const totalCalories = entries.reduce((sum, entry) => sum + entry.calories, 0);
  const totalProtein = entries.reduce((sum, entry) => sum + entry.protein, 0);
  const totalDeficit = entries.reduce((sum, entry) => {
    const entryTdee = entry.tdee || fallbackTdee;
    return sum + (entryTdee - entry.calories);
  }, 0);

  return {
    start,
    end,
    days: getRangeDays(start, end),
    count,
    averageCalories: count ? Math.round(totalCalories / count) : 0,
    averageProtein: count ? Math.round(totalProtein / count) : 0,
    totalDeficit,
    fatLossKg: totalDeficit / FAT_KCAL_PER_KG,
    latestEntry,
    entries
  };
}

export default async function handler(req, res) {
  setCorsHeaders(req, res, "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  try {
    let start = req.query.start;
    const end = req.query.end;
    const tdee = toValidNumber(req.query.tdee) || 2705;

    if (!isValidDateString(end)) {
      return res.status(400).json({
        error: "Invalid date range"
      });
    }

    const latestEntry = await getLatestPhaseEntry(end);

    if (!start) {
      start = latestEntry?.cutStartDate || latestEntry?.date;
    }

    if (!isValidDateString(start) || start > end) {
      return res.status(400).json({
        error: "Invalid date range"
      });
    }

    if (getRangeDays(start, end) > MAX_RANGE_DAYS) {
      return res.status(400).json({
        error: "Date range too large"
      });
    }

    const entries = await getRangeEntries(start, end);
    const phase = summarizePhase(start, end, tdee, entries, latestEntry);

    return res.status(200).json({
      ok: true,
      phase
    });
  } catch (error) {
    console.error(error);

    const upstreamStatus = Number(error?.status);
    const safeStatus = upstreamStatus >= 500 ? upstreamStatus : 502;
    return res.status(safeStatus).json({
      error: "API error"
    });
  }
}
