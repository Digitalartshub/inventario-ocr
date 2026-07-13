import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "data");
const uploadDir = path.join(dataDir, "uploads");
const databasePath = path.join(dataDir, "inventory.json");
const port = Number(process.env.PORT || 3000);

const app = express();
const upload = multer({ dest: uploadDir });

app.use(express.json({ limit: "1mb" }));

await fs.mkdir(uploadDir, { recursive: true });

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9._/-]/g, "");
}

function likelyInventoryColumn(headers) {
  const preferred = ["inventario", "inventário", "inventory", "numero", "número", "num", "codigo", "código", "id"];
  const found = headers.find((header) => {
    const normalized = removeAccents(header).toLowerCase();
    return preferred.some((term) => normalized.includes(term));
  });

  return found ?? headers[0] ?? "";
}

function removeAccents(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function uniqueHeaders(values) {
  const counts = new Map();
  return values.map((value, index) => {
    const base = String(value ?? "").trim() || `Coluna ${index + 1}`;
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    return seen === 0 ? base : `${base} ${seen + 1}`;
  });
}

function isInventoryHeaderRow(row) {
  return row.some((cell) => {
    const value = removeAccents(cell).toLowerCase();
    return value.includes("inventario");
  });
}

function cleanFileName(fileName) {
  const value = String(fileName ?? "ficheiro.xlsx");
  if (!value.includes("Ã") && !value.includes("Â")) return value;
  return Buffer.from(value, "latin1").toString("utf8");
}

async function readDatabase() {
  try {
    const raw = await fs.readFile(databasePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        headers: [],
        rows: [],
        selectedColumn: "",
        sheetName: "",
        uploadedAt: null,
        fileName: "",
        files: [],
      };
    }
    throw error;
  }
}

async function writeDatabase(data) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(databasePath, JSON.stringify(data, null, 2), "utf8");
}

function workbookToDatabase(filePath, fileName) {
  const workbook = XLSX.readFile(filePath);
  const rows = [];
  const headerSet = new Set(["Ficheiro", "Folha", "Linha Excel"]);

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
    const headerIndex = table.findIndex(isInventoryHeaderRow);

    if (headerIndex === -1) continue;

    const headers = uniqueHeaders(table[headerIndex]);
    headers.forEach((header) => headerSet.add(header));

    table.slice(headerIndex + 1).forEach((row, index) => {
      const record = {
        Ficheiro: fileName,
        Folha: sheetName,
        "Linha Excel": headerIndex + index + 2,
      };

      headers.forEach((header, cellIndex) => {
        record[header] = row[cellIndex] ?? "";
      });

      if (Object.values(record).some((value) => String(value ?? "").trim() !== "")) {
        rows.push(record);
      }
    });
  }

  const headers = [...headerSet];

  return {
    headers,
    rows,
    selectedColumn: likelyInventoryColumn(headers),
    sheetName: workbook.SheetNames.join(", "),
    uploadedAt: new Date().toISOString(),
    fileName,
    files: [
      {
        fileName,
        uploadedAt: new Date().toISOString(),
        rows: rows.length,
        sheets: workbook.SheetNames,
      },
    ],
  };
}

function mergeDatabase(current, incoming) {
  const fileName = incoming.fileName;
  const currentRows = (current.rows ?? []).filter((row) => row.Ficheiro !== fileName);
  const rows = [...currentRows, ...incoming.rows];
  const headerSet = new Set([...(current.headers ?? []), ...(incoming.headers ?? [])]);
  const files = [
    ...(current.files ?? []).filter((file) => file.fileName !== fileName),
    ...(incoming.files ?? []),
  ];

  return {
    headers: [...headerSet],
    rows,
    selectedColumn: current.selectedColumn || incoming.selectedColumn || likelyInventoryColumn([...headerSet]),
    sheetName: files.map((file) => file.fileName).join(", "),
    uploadedAt: incoming.uploadedAt,
    fileName,
    files,
  };
}

app.get("/api/inventory", async (req, res, next) => {
  try {
    res.json(await readDatabase());
  } catch (error) {
    next(error);
  }
});

app.post("/api/inventory/upload", upload.single("excel"), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Ficheiro em falta." });
      return;
    }

    const current = await readDatabase();
    const incoming = workbookToDatabase(req.file.path, cleanFileName(req.file.originalname));
    const database = mergeDatabase(current, incoming);
    await writeDatabase(database);
    await fs.unlink(req.file.path).catch(() => {});
    res.json(database);
  } catch (error) {
    next(error);
  }
});

app.post("/api/inventory/column", async (req, res, next) => {
  try {
    const database = await readDatabase();
    const selectedColumn = String(req.body.selectedColumn ?? "");

    if (!database.headers.includes(selectedColumn)) {
      res.status(400).json({ error: "Coluna invalida." });
      return;
    }

    database.selectedColumn = selectedColumn;
    await writeDatabase(database);
    res.json(database);
  } catch (error) {
    next(error);
  }
});

app.get("/api/inventory/search", async (req, res, next) => {
  try {
    const database = await readDatabase();
    const query = normalize(req.query.q);
    const column = database.selectedColumn;

    if (!query || !column) {
      res.status(400).json({ error: "Pesquisa ou coluna em falta." });
      return;
    }

    const index = database.rows.findIndex((row) => normalize(row[column]) === query);
    res.json({
      found: index !== -1,
      row: index === -1 ? null : database.rows[index],
      excelRowNumber: index === -1 ? null : database.rows[index]["Linha Excel"],
      query,
      headers: database.headers,
      selectedColumn: database.selectedColumn,
    });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(path.join(__dirname, "dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ error: "Erro interno no servidor." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`API pronta em http://localhost:${port}`);
});
