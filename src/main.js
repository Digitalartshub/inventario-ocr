const state = {
  stream: null,
  facingMode: "environment",
  headers: [],
  rows: [],
  selectedColumn: "",
  serverMode: false,
  lastRead: "",
  lastSuggestions: [],
};

const els = {
  status: document.querySelector("#status-pill"),
  video: document.querySelector("#camera"),
  canvas: document.querySelector("#snapshot"),
  startCamera: document.querySelector("#start-camera"),
  switchCamera: document.querySelector("#switch-camera"),
  capture: document.querySelector("#capture"),
  imageInput: document.querySelector("#image-input"),
  excelInput: document.querySelector("#excel-input"),
  columnSelect: document.querySelector("#column-select"),
  inventoryInput: document.querySelector("#inventory-input"),
  search: document.querySelector("#search"),
  sheetInfo: document.querySelector("#sheet-info"),
  results: document.querySelector("#results"),
  ocrProgress: document.querySelector("#ocr-progress"),
  progressBar: document.querySelector("#progress-bar"),
  progressLabel: document.querySelector("#progress-label"),
};

function setStatus(text) {
  els.status.textContent = text;
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9._/-]/g, "");
}

function compactCode(value) {
  return normalize(value)
    .replace(/[._/-]/g, "")
    .replace(/[5$]/g, "S")
    .replace(/8/g, "B")
    .replace(/6/g, "G")
    .replace(/O/g, "0");
}

function correctionKey(value) {
  return `ocr-correction:${compactCode(value)}`;
}

function getStoredCorrection(value) {
  try {
    return localStorage.getItem(correctionKey(value)) || "";
  } catch (error) {
    return "";
  }
}

function storeCorrection(readValue, correctValue) {
  if (!readValue || !correctValue) return;

  try {
    localStorage.setItem(correctionKey(readValue), correctValue);
  } catch (error) {
    console.warn("Nao foi possivel guardar correcao local.", error);
  }
}

function likelyInventoryColumn(headers) {
  const preferred = ["inventario", "inventory", "numero", "num", "codigo", "id"];
  const found = headers.find((header) => {
    const normalized = String(header).toLowerCase();
    return preferred.some((term) => normalized.includes(term));
  });

  return found ?? headers[0] ?? "";
}

async function startCamera() {
  stopCamera();
  setStatus("A abrir camara");

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facingMode },
      audio: false,
    });
    els.video.srcObject = state.stream;
    els.capture.disabled = false;
    setStatus("Camara ativa");
  } catch (error) {
    setStatus("Sem acesso a camara");
    alert("Nao foi possivel abrir a camara. Confirma as permissoes do browser.");
  }
}

function stopCamera() {
  if (!state.stream) return;
  state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null;
}

function captureToCanvas() {
  const video = els.video;
  const canvas = els.canvas;
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 960;
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(video, 0, 0, width, height);
  return canvas;
}

async function runOcr(source) {
  setStatus("A ler texto");
  els.ocrProgress.hidden = false;
  els.progressBar.style.width = "0%";
  els.progressLabel.textContent = "A preparar OCR...";

  try {
    const preparedImages = await prepareOcrImages(source);
    let best = "";

    for (let index = 0; index < preparedImages.length; index += 1) {
      const result = await Tesseract.recognize(preparedImages[index], "eng", {
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_/.",
        tessedit_pageseg_mode: "7",
        logger: (message) => {
          if (message.status !== "recognizing text") return;
          const imageWeight = index / preparedImages.length;
          const percent = Math.round((imageWeight + (message.progress || 0) / preparedImages.length) * 100);
          els.progressBar.style.width = `${percent}%`;
          els.progressLabel.textContent = `A reconhecer texto... ${percent}%`;
        },
      });

      const candidate = chooseBestInventoryText(result.data.text);
      best = candidate.value;
      state.lastRead = candidate.read || best;
      state.lastSuggestions = candidate.suggestions || [];
      if (candidate.fromDatabase) break;
    }

    els.inventoryInput.value = best;
    setStatus(best ? "Texto reconhecido" : "Sem leitura");

    if (best && state.rows.length) {
      await searchInventory();
    }
  } catch (error) {
    console.error(error);
    setStatus("Erro no OCR");
    alert("O OCR falhou. Tenta uma fotografia com mais luz e contraste.");
  } finally {
    els.ocrProgress.hidden = true;
  }
}

async function prepareOcrImages(source) {
  const base = await sourceToCanvas(source);
  const crops = [
    { x: 0.07, y: 0.36, width: 0.86, height: 0.28 },
    { x: 0.03, y: 0.30, width: 0.94, height: 0.40 },
  ];

  return crops.map((crop) => preprocessCrop(base, crop));
}

function sourceToCanvas(source) {
  if (source instanceof HTMLCanvasElement) return Promise.resolve(source);

  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = source.naturalWidth || source.videoWidth || source.width;
    canvas.height = source.naturalHeight || source.videoHeight || source.height;
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    resolve(canvas);
  });
}

function preprocessCrop(baseCanvas, crop) {
  const sourceX = Math.round(baseCanvas.width * crop.x);
  const sourceY = Math.round(baseCanvas.height * crop.y);
  const sourceWidth = Math.round(baseCanvas.width * crop.width);
  const sourceHeight = Math.round(baseCanvas.height * crop.height);
  const scale = 3;
  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth * scale;
  canvas.height = sourceHeight * scale;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.drawImage(baseCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const red = image.data[index];
    const green = image.data[index + 1];
    const blue = image.data[index + 2];
    const gray = red * 0.299 + green * 0.587 + blue * 0.114;
    const contrasted = gray < 178 ? 0 : 255;
    image.data[index] = contrasted;
    image.data[index + 1] = contrasted;
    image.data[index + 2] = contrasted;
  }
  context.putImageData(image, 0, 0);

  return canvas;
}

function chooseBestInventoryText(text) {
  const rawCandidates = text
    .split(/[\s\n\r]+/)
    .map(normalize)
    .filter((value) => value.length >= 2);

  const joined = normalize(text);
  const candidates = [...new Set([...rawCandidates, joined])];
  const read = candidates.sort((a, b) => b.length - a.length)[0] ?? "";
  const storedCorrection = getStoredCorrection(read);
  const suggestions = findInventorySuggestions(candidates, 10);
  const best = suggestions[0];

  if (storedCorrection) {
    return { value: storedCorrection, fromDatabase: true, suggestions, read };
  }

  if (best && (best.score >= 0.62 || (best.score >= 0.52 && candidates.some((candidate) => /\d/.test(candidate))))) {
    return { value: best.value, fromDatabase: true, suggestions, read };
  }

  return { value: read, fromDatabase: false, suggestions, read };
}

function findInventorySuggestions(candidates, limit = 10) {
  if (!state.rows.length || !state.selectedColumn) return [];

  const candidateValues = candidates.map(compactCode).filter((value) => value.length >= 2);
  if (!candidateValues.length) return [];

  const byValue = new Map();
  for (const row of state.rows) {
    const inventory = normalize(row[state.selectedColumn]);
    const inventoryCompact = compactCode(inventory);
    if (!inventoryCompact) continue;

    let bestScore = 0;
    for (const candidate of candidateValues) {
      const score = similarityScore(candidate, inventoryCompact);
      if (score > bestScore) bestScore = score;
    }

    const previous = byValue.get(inventory);
    if (!previous || bestScore > previous.score) {
      byValue.set(inventory, { value: inventory, score: bestScore, row });
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

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = URL.createObjectURL(file);
  });
}

function applyDatabase(database) {
  state.rows = database.rows ?? [];
  state.headers = database.headers ?? [];
  state.selectedColumn = database.selectedColumn || likelyInventoryColumn(state.headers);
  renderColumnOptions();

  if (!state.rows.length) {
    els.sheetInfo.textContent = "Ainda nao ha dados guardados no servidor.";
    setStatus("Sem Excel");
    return;
  }

  const uploaded = database.uploadedAt ? new Date(database.uploadedAt).toLocaleString("pt-PT") : "data desconhecida";
  const fileCount = database.files?.length ?? (database.fileName ? 1 : 0);
  els.sheetInfo.textContent = `${state.rows.length} registos carregados de ${fileCount} ficheiro(s). Ultimo upload: ${uploaded}.`;
  setStatus("Excel carregado");
}

async function loadSavedExcel() {
  setStatus("A carregar dados");
  const apiResponse = await fetch("/api/inventory").catch(() => null);
  if (apiResponse?.ok) {
    state.serverMode = true;
    applyDatabase(await apiResponse.json());
    return;
  }

  state.serverMode = false;
  const staticResponse = await fetch("./inventory.json");
  if (!staticResponse.ok) throw new Error("Falha ao carregar dados guardados.");
  applyDatabase(await staticResponse.json());
  disableServerOnlyControls();
}

async function uploadExcel(file) {
  if (!state.serverMode) {
    alert("Nesta versao publicada, o Excel e atualizado no projeto antes da publicacao.");
    return;
  }

  setStatus("A guardar Excel");
  const formData = new FormData();
  formData.append("excel", file);

  const response = await fetch("/api/inventory/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Falha ao guardar Excel.");
  }

  applyDatabase(await response.json());
}

function renderColumnOptions() {
  els.columnSelect.innerHTML = "";
  state.headers.forEach((header) => {
    const option = document.createElement("option");
    option.value = header;
    option.textContent = header;
    option.selected = header === state.selectedColumn;
    els.columnSelect.append(option);
  });

  els.columnSelect.disabled = state.headers.length === 0;
}

async function saveSelectedColumn() {
  if (!state.serverMode) return;

  const response = await fetch("/api/inventory/column", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selectedColumn: state.selectedColumn }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Falha ao guardar coluna.");
  }
}

async function searchInventory() {
  const query = normalize(els.inventoryInput.value);
  state.selectedColumn = els.columnSelect.value;

  if (!query) {
    alert("Escreve ou le um numero de inventario.");
    return;
  }

  if (!state.rows.length || !state.selectedColumn) {
    alert("Carrega primeiro o Excel e escolhe a coluna do inventario.");
    return;
  }

  let result;
  try {
    result = state.serverMode ? await searchOnServer(query) : searchLocally(query);
  } catch (error) {
    console.error(error);
    alert(error.message);
    return;
  }

  if (!result.found) {
    const suggestions = findInventorySuggestions([query]);
    els.results.innerHTML = `
      <div class="not-found">
        <strong>Nao encontrado:</strong> ${escapeHtml(query)}
      </div>
      ${renderSuggestions(query, suggestions)}
    `;
    setStatus("Nao encontrado");
    return;
  }

  renderMatch(result.row, result.excelRowNumber, query, state.lastSuggestions);
  setStatus("Encontrado");
}

function renderSuggestions(query, suggestions) {
  if (!suggestions.length) return "";

  const buttons = suggestions
    .map((suggestion) => {
      const label = suggestion.value;
      const detail = getRowDetail(suggestion.row);
      return `
        <button class="suggestion-button" type="button" data-inventory="${escapeHtml(label)}">
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(detail)}</span>
        </button>
      `;
    })
    .join("");

  return `
    <div class="suggestions">
      <h2>Sugestoes parecidas</h2>
      <p>Leitura usada: ${escapeHtml(query)}</p>
      <div class="suggestion-list">${buttons}</div>
    </div>
  `;
}

function getRowDetail(row) {
  if (!row) return "";
  const identificationKey = Object.keys(row).find((key) => key.toLowerCase().includes("identifica"));
  return row[identificationKey] || row.Folha || "";
}

async function searchOnServer(query) {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(`/api/inventory/search?${params}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Nao foi possivel pesquisar.");
  }

  return response.json();
}

function searchLocally(query) {
  const index = state.rows.findIndex((row) => normalize(row[state.selectedColumn]) === query);
  return {
    found: index !== -1,
    row: index === -1 ? null : state.rows[index],
    excelRowNumber: index === -1 ? null : state.rows[index]["Linha Excel"] ?? index + 2,
  };
}

function renderMatch(row, excelRowNumber, query, suggestions = []) {
  const cells = state.headers
    .map((header) => {
      const value = row[header] === "" ? "-" : row[header];
      return `
        <div class="result-cell">
          <strong>${escapeHtml(header)}</strong>
          <span>${escapeHtml(value)}</span>
        </div>
      `;
    })
    .join("");

  els.results.innerHTML = `
    <div class="result-head">
      <div>
        <h2>Registo encontrado</h2>
        <p class="hint">Linha aproximada no Excel: ${excelRowNumber}</p>
      </div>
      <div class="match-badge">${escapeHtml(query)}</div>
    </div>
    <div class="result-grid">${cells}</div>
    ${renderSuggestions(query, suggestions.filter((suggestion) => suggestion.value !== query).slice(0, 6))}
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function disableServerOnlyControls() {
  els.excelInput.disabled = true;
  const uploadLabel = els.excelInput.closest(".file-drop");
  if (uploadLabel) {
    uploadLabel.classList.add("disabled");
    uploadLabel.querySelector("span").textContent = "Excel incluido na versao publicada";
  }
}

els.startCamera.addEventListener("click", startCamera);
els.switchCamera.addEventListener("click", () => {
  state.facingMode = state.facingMode === "environment" ? "user" : "environment";
  startCamera();
});
els.capture.addEventListener("click", () => runOcr(captureToCanvas()));
els.search.addEventListener("click", () => searchInventory());
els.inventoryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") searchInventory();
});
els.columnSelect.addEventListener("change", async () => {
  state.selectedColumn = els.columnSelect.value;
  try {
    await saveSelectedColumn();
    setStatus("Coluna guardada");
  } catch (error) {
    console.error(error);
    setStatus("Erro na coluna");
    alert(error.message);
  }
});
els.excelInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await uploadExcel(file);
  } catch (error) {
    console.error(error);
    setStatus("Erro no Excel");
    alert(error.message);
  }
});
els.imageInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const image = await loadImageFile(file);
  await runOcr(image);
});
els.results.addEventListener("click", (event) => {
  const button = event.target.closest("[data-inventory]");
  if (!button) return;

  storeCorrection(state.lastRead || els.inventoryInput.value, button.dataset.inventory);
  els.inventoryInput.value = button.dataset.inventory;
  searchInventory();
});

if (!navigator.mediaDevices?.getUserMedia) {
  els.startCamera.disabled = true;
  els.capture.disabled = true;
  setStatus("Camara indisponivel");
}

loadSavedExcel().catch((error) => {
  console.error(error);
  setStatus("API indisponivel");
  els.sheetInfo.textContent = "Nao foi possivel ligar ao servidor de dados.";
});
