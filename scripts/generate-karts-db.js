const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const SOURCE_HTML = path.join(PROJECT_ROOT, "mariowiki-hot-wheels.html");
const OUTPUT_JS = path.join(PROJECT_ROOT, "data", "karts-data.js");
const ASSET_ROOT = path.join(PROJECT_ROOT, "assets", "images");
const SOURCE_URL = "https://www.mariowiki.com/Hot_Wheels";
const INITIAL_RATING = 1500;

function decodeHtml(value) {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(value) {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, ", ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function ensureDirectory(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function ensureSourceHtml() {
  if (fs.existsSync(SOURCE_HTML)) {
    return fs.readFileSync(SOURCE_HTML, "utf8");
  }
  throw new Error("Missing source HTML. Please save mariowiki-hot-wheels.html first.");
}

function extractSectionTable(html, sectionId) {
  const afterSection = html.split(`<span class="mw-headline" id="${sectionId}">`)[1];
  if (!afterSection) {
    throw new Error(`Section not found: ${sectionId}`);
  }
  const sectionBody = afterSection.split('<h3><span class="mw-headline" id="')[0];
  const tableMatch = sectionBody.match(/<table class="wikitable sortable"[\s\S]*?<\/table>/i);
  if (!tableMatch) {
    throw new Error(`Table not found for section ${sectionId}`);
  }
  return tableMatch[0];
}

function extractLinks(cellHtml) {
  return [...cellHtml.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      href: decodeHtml(match[1]),
      text: stripTags(match[2]),
    }))
    .filter((entry) => entry.text && !entry.text.startsWith("File:"));
}

function extractName(cellHtml) {
  const links = extractLinks(cellHtml);
  return links.length ? links[links.length - 1].text : stripTags(cellHtml);
}

function extractWikiPath(cellHtml) {
  const links = extractLinks(cellHtml);
  return links.length ? decodeHtml(links[links.length - 1].href) : "";
}

function normalizeImageUrl(url) {
  if (!url) return "";
  const decoded = decodeHtml(url);
  const thumbMatch = decoded.match(/^(https:\/\/mario\.wiki\.gallery\/images)\/thumb\/(.+?)\/[^/]+$/i);
  if (thumbMatch) {
    return `${thumbMatch[1]}/${thumbMatch[2]}`;
  }
  return decoded;
}

function extractImageUrl(cellHtml) {
  const match = cellHtml.match(/<img[^>]+src="([^"]+)"/i);
  return match ? normalizeImageUrl(match[1]) : "";
}

function getFileExtension(url) {
  const clean = url.split("?")[0];
  const ext = path.extname(clean);
  return ext || ".png";
}

function buildLocalAssetPath(kind, name, remoteUrl) {
  const filename = `${slugify(name) || "image"}${getFileExtension(remoteUrl)}`;
  return path.join("assets", "images", kind, filename).replace(/\\/g, "/");
}

async function downloadFile(url, localPath) {
  const absolutePath = path.join(PROJECT_ROOT, localPath);
  ensureDirectory(path.dirname(absolutePath));
  if (fs.existsSync(absolutePath)) {
    return;
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(absolutePath, Buffer.from(arrayBuffer));
}

function parseTable(tableHtml, config) {
  const rows = [...tableHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].slice(1);
  return rows
    .map((rowMatch, index) => {
      const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
      if (cells.length !== config.columns.length) {
        return null;
      }

      const record = {};
      config.columns.forEach((column, columnIndex) => {
        record[column.key] = column.parse(cells[columnIndex]);
      });
      if (config.enrich) {
        Object.assign(record, config.enrich(cells, record, index));
      }

      const primaryId = record.code || `${record.character}-${record.vehicle}-${record.tires}-${record.glider || config.type}-${record.firstAppearance || "special"}`;

      return {
        id: `${slugify(primaryId)}-${config.type}-${index + 1}`,
        type: config.type,
        code: record.code || "",
        character: record.character,
        vehicle: record.vehicle,
        tires: record.tires,
        glider: record.glider || "",
        firstAppearance: record.firstAppearance || "",
        otherAppearances: record.otherAppearances || "",
        characterWikiPath: record.characterWikiPath || "",
        vehicleWikiPath: record.vehicleWikiPath || "",
        tireWikiPath: record.tireWikiPath || "",
        gliderWikiPath: record.gliderWikiPath || "",
        characterImageRemote: record.characterImageRemote || "",
        vehicleImageRemote: record.vehicleImageRemote || "",
        tireImageRemote: record.tireImageRemote || "",
        gliderImageRemote: record.gliderImageRemote || "",
        collected: false,
        collectedAt: "",
        collectionNote: "",
        rating: INITIAL_RATING,
      };
    })
    .filter(Boolean);
}

async function attachLocalAssets(entries) {
  const tasks = [];

  entries.forEach((entry) => {
    const assetSpecs = [
      ["character", entry.character, entry.characterImageRemote, "characterImage"],
      ["vehicles", `${entry.character}-${entry.vehicle}`, entry.vehicleImageRemote, "vehicleImage"],
      ["tires", entry.tires, entry.tireImageRemote, "tireImage"],
      ["gliders", entry.glider || `${entry.character}-glider`, entry.gliderImageRemote, "gliderImage"],
    ];

    assetSpecs.forEach(([kind, name, remoteUrl, field]) => {
      if (!remoteUrl) {
        entry[field] = "";
        return;
      }
      const localPath = buildLocalAssetPath(kind, name, remoteUrl);
      entry[field] = localPath;
      tasks.push(downloadFile(remoteUrl, localPath));
    });
  });

  for (const task of tasks) {
    await task;
  }
}

async function main() {
  const html = ensureSourceHtml();
  const kartTable = extractSectionTable(html, "Karts");
  const gliderTable = extractSectionTable(html, "Gliders");

  const sharedColumns = {
    code: { key: "code", parse: stripTags },
    character: { key: "character", parse: extractName },
    vehicle: { key: "vehicle", parse: extractName },
    tires: { key: "tires", parse: extractName },
    firstAppearance: { key: "firstAppearance", parse: stripTags },
    otherAppearances: { key: "otherAppearances", parse: stripTags },
    characterWikiPath: { key: "characterWikiPath", parse: extractWikiPath },
    vehicleWikiPath: { key: "vehicleWikiPath", parse: extractWikiPath },
    tireWikiPath: { key: "tireWikiPath", parse: extractWikiPath },
    characterImageRemote: { key: "characterImageRemote", parse: extractImageUrl },
    vehicleImageRemote: { key: "vehicleImageRemote", parse: extractImageUrl },
    tireImageRemote: { key: "tireImageRemote", parse: extractImageUrl },
  };

  const kartEntries = parseTable(kartTable, {
    type: "kart",
    columns: [
      sharedColumns.code,
      sharedColumns.character,
      sharedColumns.vehicle,
      sharedColumns.tires,
      sharedColumns.firstAppearance,
      sharedColumns.otherAppearances,
    ],
    enrich: (cells) => ({
      characterWikiPath: extractWikiPath(cells[1]),
      vehicleWikiPath: extractWikiPath(cells[2]),
      tireWikiPath: extractWikiPath(cells[3]),
      characterImageRemote: extractImageUrl(cells[1]),
      vehicleImageRemote: extractImageUrl(cells[2]),
      tireImageRemote: extractImageUrl(cells[3]),
    }),
  }).map((entry) => ({
    ...entry,
    glider: "",
    gliderWikiPath: "",
    gliderImageRemote: "",
  }));

  const gliderEntries = parseTable(gliderTable, {
    type: "glider",
    columns: [
      sharedColumns.code,
      sharedColumns.character,
      sharedColumns.vehicle,
      sharedColumns.tires,
      { key: "glider", parse: extractName },
      sharedColumns.firstAppearance,
      sharedColumns.otherAppearances,
    ],
    enrich: (cells) => ({
      characterWikiPath: extractWikiPath(cells[1]),
      vehicleWikiPath: extractWikiPath(cells[2]),
      tireWikiPath: extractWikiPath(cells[3]),
      gliderWikiPath: extractWikiPath(cells[4]),
      characterImageRemote: extractImageUrl(cells[1]),
      vehicleImageRemote: extractImageUrl(cells[2]),
      tireImageRemote: extractImageUrl(cells[3]),
      gliderImageRemote: extractImageUrl(cells[4]),
    }),
  });

  const manualEntry = {
    id: "custom-empty-standard-kart",
    type: "kart",
    code: "",
    character: "无",
    vehicle: "Standard Kart",
    tires: "Standard",
    glider: "",
    firstAppearance: "自定义补充条目",
    otherAppearances: "",
    characterWikiPath: "",
    vehicleWikiPath: "/Standard_Kart",
    tireWikiPath: "/Standard_(tire)",
    gliderWikiPath: "",
    characterImageRemote: "",
    vehicleImageRemote: "https://mario.wiki.gallery/images/6/6e/MKT_Icon_RedStandard8.png",
    tireImageRemote: "https://mario.wiki.gallery/images/5/53/MKT_Model_Std_Black.png",
    gliderImageRemote: "",
    collected: false,
    collectedAt: "",
    collectionNote: "",
    rating: INITIAL_RATING,
  };

  const entries = [manualEntry, ...kartEntries, ...gliderEntries];
  ensureDirectory(ASSET_ROOT);
  await attachLocalAssets(entries);

  const payload = {
    sourceUrl: SOURCE_URL,
    generatedAt: new Date().toISOString(),
    entries,
  };

  ensureDirectory(path.dirname(OUTPUT_JS));
  fs.writeFileSync(OUTPUT_JS, `window.HOT_WHEELS_COLLECTION = ${JSON.stringify(payload, null, 2)};\n`, "utf8");
  console.log(`Generated ${kartEntries.length} kart entries and ${gliderEntries.length} glider entries.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
