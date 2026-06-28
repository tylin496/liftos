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

function readTextProperty(property) {
  if (!property) return null;
  if (property.type === "select") return property.select?.name || null;
  return property.rich_text?.map((part) => part.plain_text || "").join("") || null;
}

function mapEntry(page) {
  const properties = page.properties;
  return {
    date: properties.Date?.date?.start || "",
    cutStartDate: properties["Cut Start Date"]?.date?.start || null,
    cutPhaseIndex: properties["Cut Phase"]?.number ?? null,
    cutPhaseName: readTextProperty(properties["Cut Phase Name"]),
  };
}

async function getAllPhaseEntries() {
  const results = [];
  let cursor = undefined;

  do {
    const response = await notionFetch(
      `/databases/${process.env.NOTION_DATABASE_ID}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            property: "Cut Start Date",
            date: { is_not_empty: true }
          },
          sorts: [{ property: "Date", direction: "ascending" }],
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {})
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw { status: response.status, data };
    }

    results.push(...(data.results || []).map(mapEntry));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return results;
}

const CUT_PHASE_NAMES = ["Aggressive Cut", "Moderate Cut", "Cruise", "Maintenance"];

function getCutPhaseNameFromIndex(index) {
  if (index === null || index === undefined) return null;
  return CUT_PHASE_NAMES[index] || null;
}

export default async function handler(req, res) {
  setCorsHeaders(req, res, "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!isAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });

  try {
    const entries = await getAllPhaseEntries();

    // Group entries by cutStartDate to identify distinct phases
    const phaseMap = new Map();

    for (const entry of entries) {
      if (!entry.cutStartDate) continue;
      const key = entry.cutStartDate;

      if (!phaseMap.has(key)) {
        phaseMap.set(key, {
          start: entry.cutStartDate,
          end: entry.date,
          name: entry.cutPhaseName || getCutPhaseNameFromIndex(entry.cutPhaseIndex) || "Cut Phase",
          index: entry.cutPhaseIndex,
        });
      } else {
        // Extend end date to the latest entry in this phase
        const existing = phaseMap.get(key);
        if (entry.date > existing.end) existing.end = entry.date;
        // Update name from a non-null entry if not yet set, or if current name is just the fallback
        if ((!existing.name || existing.name === "Cut Phase") && (entry.cutPhaseName || entry.cutPhaseIndex !== null)) {
          existing.name = entry.cutPhaseName || getCutPhaseNameFromIndex(entry.cutPhaseIndex) || "Cut Phase";
        }
      }
    }

    // Sort phases newest first
    const phases = Array.from(phaseMap.values()).sort((a, b) => b.start.localeCompare(a.start));

    return res.status(200).json({ ok: true, phases });
  } catch (error) {
    console.error(error);
    const upstreamStatus = Number(error?.status);
    const safeStatus = upstreamStatus >= 500 ? upstreamStatus : 502;
    return res.status(safeStatus).json({ error: "API error" });
  }
}
