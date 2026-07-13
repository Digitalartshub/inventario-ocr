import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = JSON.parse(fs.readFileSync(path.join(root, "inventory.json"), "utf8"));
const selectedColumn =
  db.selectedColumn || db.headers?.find((header) => /invent/i.test(header)) || "N.º de Inventário";
const rows = db.rows || [];

const probes = [
  "832 MB",
  "832MB",
  "837 MB",
  "2374 MB",
  "2384 MB",
  "3878 MB",
  "387B MB",
  "3889MB",
  "3656MB",
  "72.CMB.SC",
  "72CMB5C",
  "CMBSC",
];

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9._/-]/g, "");
}

function compactCode(value) {
  const compact = normalize(value).replace(/[._/-]/g, "");

  return compact
    .replace(/M8/g, "MB")
    .replace(/CMB5C/g, "CMBSC")
    .replace(/([A-Z])5([A-Z])/g, "$1S$2")
    .replace(/O/g, "0");
}

function findInventorySuggestions(candidates, limit = 5) {
  const candidateValues = candidates.map(compactCode).filter((value) => value.length >= 2);
  if (!candidateValues.length) return [];

  const byValue = new Map();
  for (const row of rows) {
    const inventory = normalize(row[selectedColumn]);
    const inventoryCompact = compactCode(inventory);
    if (!inventoryCompact) continue;

    let bestScore = 0;
    for (const candidate of candidateValues) {
      const score = similarityScore(candidate, inventoryCompact);
      if (score > bestScore) bestScore = score;
    }

    const previous = byValue.get(inventory);
    if (!previous || bestScore > previous.score) {
      byValue.set(inventory, { value: inventory, score: bestScore });
    }
  }

  return [...byValue.values()]
    .filter((suggestion) => suggestion.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function similarityScore(candidate, inventory) {
  if (candidate === inventory) return 1;
  if (candidate.length >= 4 && inventory.includes(candidate)) return 0.86;
  if (candidate.length >= 5 && candidate.includes(inventory)) return 0.86;

  const distance = levenshtein(candidate, inventory);
  const maxLength = Math.max(candidate.length, inventory.length);
  const base = maxLength ? 1 - distance / maxLength : 0;
  const shared = [...candidate].filter((char) => inventory.includes(char)).length / Math.max(candidate.length, 1);
  const candidateNumbers = candidate.match(/\d+/g) ?? [];
  const numericBonus = candidateNumbers.some((number) => inventory.includes(number)) ? 0.12 : 0;
  const prefixBonus = candidateNumbers[0] && inventory.startsWith(candidateNumbers[0]) ? 0.12 : 0;
  const suffixBonus = candidate.endsWith("CMBSC") && inventory.endsWith("CMBSC") ? 0.16 : 0;
  const containsBonus = candidate.length >= 3 && inventory.includes(candidate.slice(0, 3)) ? 0.06 : 0;

  return Math.min(1, base * 0.68 + shared * 0.18 + numericBonus + prefixBonus + suffixBonus + containsBonus);
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[a.length][b.length];
}

console.log(`Base: ${rows.length} linhas | coluna: ${selectedColumn}`);
for (const probe of probes) {
  const exact = rows.find((row) => normalize(row[selectedColumn]) === normalize(probe));
  const suggestions = findInventorySuggestions([probe], 3);
  const top = suggestions.map((item) => `${item.value} (${item.score.toFixed(2)})`).join(", ");
  console.log(`${probe.padEnd(10)} -> ${exact ? `EXATO ${normalize(exact[selectedColumn])}` : `sugestoes: ${top || "nenhuma"}`}`);
}
