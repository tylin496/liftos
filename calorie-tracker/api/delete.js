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

async function findEntryByDate(date) {
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
        page_size: 1
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

  return data.results[0] || null;
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

    if (!isValidDateString(date)) {
      return res.status(400).json({
        error: "Invalid date"
      });
    }

    const existingEntry = await findEntryByDate(date);

    if (!existingEntry) {
      return res.status(404).json({
        error: "Entry not found"
      });
    }

    const data = await archiveEntry(existingEntry.id);

    return res.status(200).json({
      ok: true,
      id: existingEntry.id,
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
