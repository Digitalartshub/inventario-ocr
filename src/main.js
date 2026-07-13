import "./styles.css";

const state = {
  stream: null,
  facingMode: "environment",
  headers: [],
  rows: [],
  selectedColumn: "",
  serverMode: false,
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

function likelyInventoryColumn(headers) {
  const preferred = ["inventario", "inventario", "inventory", "numero", "numero", "num", "codigo", "codigo", "id"];
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
    const result = await Tesseract.recognize(source, "eng", {
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_/.",
      logger: (message) => {
        if (message.status !== "recognizing text") return;
        const percent = Math.round((message.progress || 0) * 100);
        els.progressBar.style.width = `${percent}%`;
        els.progressLabel.textContent = `A reconhecer texto... ${percent}%`;
      },
    });

    const candidates = result.data.text
      .split(/\s+/)
      .map(normalize)
      .filter((value) => value.length >= 2);

    const best = candidates.sort((a, b) => b.length - a.length)[0] ?? "";
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
    els.results.innerHTML = `
      <div class="not-found">
        <strong>Nao encontrado:</strong> ${escapeHtml(query)}
      </div>
    `;
    setStatus("Nao encontrado");
    return;
  }

  renderMatch(result.row, result.excelRowNumber, query);
  setStatus("Encontrado");
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

function renderMatch(row, excelRowNumber, query) {
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
