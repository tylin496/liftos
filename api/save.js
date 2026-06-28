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

async function findEntriesByDate(date) {
  const results = [];
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
              equals: date
            }
          },
          sorts: [
            {
              timestamp: "last_edited_time",
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

    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return results;
}

async function getDatabaseProperties() {
  const response = await notionFetch(`/databases/${process.env.NOTION_DATABASE_ID}`);
  const data = await response.json();

  if (!response.ok) {
    throw {
      status: response.status,
      data
    };
  }

  return data.properties || {};
}

function filterKnownProperties(properties, databaseProperties) {
  return Object.fromEntries(
    Object.entries(properties).filter(([name]) => Boolean(databaseProperties[name]))
  );
}

function buildTextProperty(databaseProperties, name, value) {
  if (!value || !databaseProperties[name]) return null;
  if (databaseProperties[name].type === "select") {
    return {
      select: {
        name: value
      }
    };
  }

  return {
    rich_text: [
      {
        text: {
          content: value
        }
      }
    ]
  };
}

function buildProperties(date, calories, protein, tdee, calorieTarget, proteinTarget, cutSnapshot, databaseProperties) {
  const cutPhaseNameProperty = buildTextProperty(databaseProperties, "Cut Phase Name", cutSnapshot.cutPhaseName);
  const properties = {
    Name: {
      title: [
        {
          text: {
            content: date
          }
        }
      ]
    },
    Date: {
      date: {
        start: date
      }
    },
    Calories: {
      number: calories
    },
    Protein: {
      number: protein
    },
    TDEE: {
      number: tdee || 2705
    },
    "Calorie Target": {
      number: calorieTarget
    },
    "Protein Target": {
      number: proteinTarget
    },
    "Cut Start Date": {
      date: cutSnapshot.cutStartDate ? { start: cutSnapshot.cutStartDate } : null
    },
    "Cut Phase": {
      number: cutSnapshot.cutPhaseIndex
    },
    "Cut Week": {
      number: cutSnapshot.cutWeek
    },
    "Deficit Target": {
      number: cutSnapshot.deficitTarget
    }
  };

  if (cutPhaseNameProperty) {
    properties["Cut Phase Name"] = cutPhaseNameProperty;
  }

  return filterKnownProperties(properties, databaseProperties);
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

function toValidPhase(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 3 ? number : null;
}

async function updateEntry(pageId, properties) {
  const response = await notionFetch(
    `/pages/${pageId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        properties
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

  return data;
}

async function archiveEntry(pageId) {
  const response = await notionFetch(
    `/pages/${pageId}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        archived: true
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

  return data;
}

async function archiveDuplicateEntries(date, keepPageId) {
  const entries = await findEntriesByDate(date);
  const duplicateEntries = entries.filter((entry) => entry.id !== keepPageId);

  await Promise.all(duplicateEntries.map((entry) => archiveEntry(entry.id)));

  return duplicateEntries.length;
}

async function createEntry(properties) {
  const response = await notionFetch(
    "/pages",
    {
      method: "POST",
      body: JSON.stringify({
        parent: {
          database_id: process.env.NOTION_DATABASE_ID
        },
        properties
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

  return data;
}

export default async function handler(req, res) {
  setCorsHeaders(req, res, "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
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
    const { date } = req.body;
    const calories = toValidNumber(req.body.calories);
    const protein = toValidNumber(req.body.protein);
    const tdee = toValidNumber(req.body.tdee) || 2705;
    const calorieTarget = toValidNumber(req.body.calorieTarget);
    const proteinTarget = toValidNumber(req.body.proteinTarget);
    const cutWeek = toValidNumber(req.body.cutWeek);
    const deficitTarget = toValidNumber(req.body.deficitTarget);
    const cutSnapshot = {
      cutStartDate: typeof req.body.cutStartDate === "string" && req.body.cutStartDate ? req.body.cutStartDate : null,
      cutPhaseIndex: req.body.cutPhaseIndex === null ? null : toValidPhase(req.body.cutPhaseIndex),
      cutPhaseName: typeof req.body.cutPhaseName === "string" && req.body.cutPhaseName ? req.body.cutPhaseName : null,
      cutWeek: cutWeek === null ? null : Math.round(cutWeek),
      deficitTarget: deficitTarget === null ? null : Math.round(deficitTarget)
    };

    if (!isValidDateString(date) || calories === null || protein === null || calorieTarget === null || proteinTarget === null) {
      return res.status(400).json({
        error: "Invalid date, calories, protein, or targets"
      });
    }

    // Clear phase data when the entry date is before the cut start date
    if (cutSnapshot.cutStartDate && isValidDateString(cutSnapshot.cutStartDate) && date < cutSnapshot.cutStartDate) {
      cutSnapshot.cutPhaseIndex = null;
      cutSnapshot.cutPhaseName = null;
      cutSnapshot.cutWeek = null;
      cutSnapshot.deficitTarget = null;
    }

    // Allow up to tomorrow UTC to handle clients in UTC+ timezones
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 1);
    if (new Date(`${date}T00:00:00Z`) > maxDate) {
      return res.status(400).json({ error: "Cannot log entries for future dates" });
    }

    const databaseProperties = await getDatabaseProperties();
    const properties = buildProperties(
      date,
      Math.round(calories),
      Math.round(protein),
      Math.round(tdee),
      Math.round(calorieTarget),
      Math.round(proteinTarget),
      cutSnapshot,
      databaseProperties
    );
    const existingEntries = await findEntriesByDate(date);
    const existingEntry = existingEntries[0] || null;

    if (existingEntry) {
      const data = await updateEntry(existingEntry.id, properties);
      const duplicatesArchived = await archiveDuplicateEntries(date, existingEntry.id);

      return res.status(200).json({
        ok: true,
        mode: "updated",
        id: existingEntry.id,
        duplicatesArchived,
        data
      });
    }

    const data = await createEntry(properties);
    const duplicatesArchived = await archiveDuplicateEntries(date, data.id);

    return res.status(200).json({
      ok: true,
      mode: "created",
      id: data.id,
      duplicatesArchived,
      data
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
