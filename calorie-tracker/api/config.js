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

function toValidNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

const CUT_PHASE_DEFAULT_DEFICITS = [805, 655, 455, 150];

function toValidPhase(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 3 ? number : null;
}

function readDeficitAt(properties, name, index) {
  return toValidNumber(properties[name]?.number) ?? CUT_PHASE_DEFAULT_DEFICITS[index];
}

async function getDatabasePropertyNames() {
  const response = await notionFetch(`/databases/${process.env.NOTION_DATABASE_ID}`);
  const data = await response.json();

  if (!response.ok) {
    throw {
      status: response.status,
      data
    };
  }

  return new Set(Object.keys(data.properties || {}));
}

function filterKnownProperties(properties, propertyNames) {
  return Object.fromEntries(
    Object.entries(properties).filter(([name]) => propertyNames.has(name))
  );
}

function buildProperties(config, propertyNames) {
  const properties = {
    Name: {
      title: [
        {
          text: {
            content: "Settings"
          }
        }
      ]
    },
    TDEE: {
      number: config.tdee
    },
    Protein: {
      number: config.proteinTarget
    },
    Calories: {
      number: config.deficitTarget
    },
    "Cut Start Date": {
      date: config.cutStartDate ? { start: config.cutStartDate } : null
    },
    "Cut Phase": {
      number: config.activeCutPhase
    },
    "Aggressive Deficit": {
      number: config.cutPhaseDeficits[0]
    },
    "Moderate Deficit": {
      number: config.cutPhaseDeficits[1]
    },
    "Cruise Deficit": {
      number: config.cutPhaseDeficits[2]
    },
    "Maintenance Deficit": {
      number: config.cutPhaseDeficits[3]
    }
  };

  return filterKnownProperties(properties, propertyNames);
}

async function findSettingsPage() {
  const response = await notionFetch(
    `/databases/${process.env.NOTION_DATABASE_ID}/query`,
    {
      method: "POST",
      body: JSON.stringify({
        filter: {
          property: "Name",
          title: {
            equals: "Settings"
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

async function updateSettings(pageId, properties) {
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

async function createSettings(properties) {
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

function readConfig(page) {
  const properties = page?.properties || {};
  const hasCutPhaseSettings = Boolean(
    properties["Cut Start Date"] ||
    properties["Cut Phase"] ||
    properties["Aggressive Deficit"] ||
    properties["Moderate Deficit"] ||
    properties["Cruise Deficit"] ||
    properties["Maintenance Deficit"]
  );

  return {
    tdee: properties.TDEE?.number || 2705,
    proteinTarget: properties.Protein?.number || 180,
    deficitTarget: properties.Calories?.number || 500,
    hasCutPhaseSettings,
    cutStartDate: properties["Cut Start Date"]?.date?.start || null,
    activeCutPhase: toValidPhase(properties["Cut Phase"]?.number),
    cutPhaseDeficits: [
      readDeficitAt(properties, "Aggressive Deficit", 0),
      readDeficitAt(properties, "Moderate Deficit", 1),
      readDeficitAt(properties, "Cruise Deficit", 2),
      readDeficitAt(properties, "Maintenance Deficit", 3)
    ]
  };
}

export default async function handler(req, res) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    if (req.method === "GET") {
      const settingsPage = await findSettingsPage();

      return res.status(200).json({
        ok: true,
        config: readConfig(settingsPage)
      });
    }

    const settingsPage = await findSettingsPage();
    const currentConfig = readConfig(settingsPage);
    const tdee = toValidNumber(req.body.tdee) ?? currentConfig.tdee;
    const proteinTarget = toValidNumber(req.body.proteinTarget) ?? currentConfig.proteinTarget;
    const deficitTarget = toValidNumber(req.body.deficitTarget) ?? currentConfig.deficitTarget;
    const cutStartDate = typeof req.body.cutStartDate === "string" && req.body.cutStartDate
      ? req.body.cutStartDate
      : req.body.cutStartDate === null
        ? null
        : currentConfig.cutStartDate;
    const activeCutPhase = req.body.activeCutPhase === null
      ? null
      : toValidPhase(req.body.activeCutPhase) ?? currentConfig.activeCutPhase;
    const requestedDeficits = Array.isArray(req.body.cutPhaseDeficits)
      ? req.body.cutPhaseDeficits.map(toValidNumber)
      : [];
    const cutPhaseDeficits = currentConfig.cutPhaseDeficits.map((value, index) => (
      requestedDeficits[index] === null || requestedDeficits[index] === undefined
        ? value
        : Math.round(requestedDeficits[index])
    ));

    if (!tdee || !proteinTarget || deficitTarget === null) {
      return res.status(400).json({
        error: "Invalid targets"
      });
    }

    const propertyNames = await getDatabasePropertyNames();
    const properties = buildProperties({
      tdee: Math.round(tdee),
      proteinTarget: Math.round(proteinTarget),
      deficitTarget: Math.round(deficitTarget),
      cutStartDate,
      activeCutPhase,
      cutPhaseDeficits
    }, propertyNames);
    const data = settingsPage
      ? await updateSettings(settingsPage.id, properties)
      : await createSettings(properties);

    return res.status(200).json({
      ok: true,
      config: readConfig(data)
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
