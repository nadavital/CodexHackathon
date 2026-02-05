const state = {
  fileDataUrl: null,
  fileName: "",
  fileMimeType: "",
  notes: [],
  loading: false,
};

const els = {
  statusPill: document.getElementById("status-pill"),
  captureForm: document.getElementById("capture-form"),
  sourceType: document.getElementById("source-type"),
  sourceUrlWrap: document.getElementById("source-url-wrap"),
  sourceUrlInput: document.getElementById("source-url-input"),
  projectInput: document.getElementById("project-input"),
  contentInput: document.getElementById("content-input"),
  imageWrap: document.getElementById("image-wrap"),
  imageInput: document.getElementById("image-input"),
  imagePreview: document.getElementById("image-preview"),
  saveBtn: document.getElementById("save-btn"),
  notesList: document.getElementById("notes-list"),
  noteTemplate: document.getElementById("note-template"),
  refreshBtn: document.getElementById("refresh-btn"),
  searchInput: document.getElementById("search-input"),
  projectFilterInput: document.getElementById("project-filter-input"),
  searchBtn: document.getElementById("search-btn"),
  chatForm: document.getElementById("chat-form"),
  questionInput: document.getElementById("question-input"),
  answerOutput: document.getElementById("answer-output"),
  citationList: document.getElementById("citation-list"),
  contextBtn: document.getElementById("context-btn"),
};

function setStatus(text, tone = "neutral") {
  els.statusPill.textContent = text;
  if (tone === "warn") {
    els.statusPill.style.color = "#8d3d1f";
    els.statusPill.style.borderColor = "rgba(189, 91, 45, 0.35)";
  } else {
    els.statusPill.style.color = "";
    els.statusPill.style.borderColor = "";
  }
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return payload;
}

function formatScore(score) {
  if (typeof score !== "number") return "";
  return `score ${score.toFixed(3)}`;
}

function renderNotes(items) {
  els.notesList.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No memories yet.";
    empty.className = "note-content";
    els.notesList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const note = item.note || item;
    const fragment = els.noteTemplate.content.cloneNode(true);

    fragment.querySelector(".note-project").textContent = note.project || "general";
    fragment.querySelector(".note-score").textContent = formatScore(item.score);
    fragment.querySelector(".note-summary").textContent = note.summary || "(no summary)";
    fragment.querySelector(".note-content").textContent = note.content || "";

    const tagsWrap = fragment.querySelector(".note-tags");
    for (const tag of note.tags || []) {
      const tagEl = document.createElement("span");
      tagEl.className = "tag";
      tagEl.textContent = tag;
      tagsWrap.appendChild(tagEl);
    }

    const meta = [];
    if (note.sourceType) meta.push(note.sourceType);
    if (note.fileName) meta.push(note.fileName);
    if (note.sourceUrl) meta.push(note.sourceUrl);
    if (note.createdAt) meta.push(new Date(note.createdAt).toLocaleString());
    fragment.querySelector(".note-meta").textContent = meta.join(" • ");

    if (note.imagePath) {
      const img = document.createElement("img");
      img.src = note.imagePath;
      img.alt = "memory image";
      img.className = "image-preview";
      tagsWrap.after(img);
    }

    els.notesList.appendChild(fragment);
  }
}

function renderCitations(citations = []) {
  els.citationList.innerHTML = "";
  if (!citations.length) {
    const p = document.createElement("p");
    p.className = "note-content";
    p.textContent = "No citations.";
    els.citationList.appendChild(p);
    return;
  }

  citations.forEach((entry, idx) => {
    const note = entry.note;
    const card = document.createElement("article");
    card.className = "citation-item";
    card.innerHTML = `
      <div class="note-top">
        <span class="note-project">N${idx + 1} • ${note.project || "general"}</span>
        <span class="note-score">${formatScore(entry.score)}</span>
      </div>
      <p class="note-summary">${note.summary || ""}</p>
      <p class="note-content">${note.content || ""}</p>
    `;
    els.citationList.appendChild(card);
  });
}

async function refreshNotes() {
  const query = els.searchInput.value.trim();
  const project = els.projectFilterInput.value.trim();
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (project) params.set("project", project);
  params.set("limit", "40");

  const data = await jsonFetch(`/api/notes?${params.toString()}`);
  state.notes = data.items || [];
  renderNotes(state.notes);
}

async function initStatus() {
  try {
    const health = await jsonFetch("/api/health");
    if (health.openaiConfigured) {
      setStatus("OpenAI connected");
    } else {
      setStatus("OpenAI key missing • heuristic mode", "warn");
    }
  } catch {
    setStatus("Server status unavailable", "warn");
  }
}

function toggleCaptureFields() {
  const type = els.sourceType.value;
  els.sourceUrlWrap.classList.toggle("hidden", type !== "link");
  els.imageWrap.classList.toggle("hidden", !["image", "file"].includes(type));
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

els.sourceType.addEventListener("change", () => {
  toggleCaptureFields();
  if (!["image", "file"].includes(els.sourceType.value)) {
    state.fileDataUrl = null;
    state.fileName = "";
    state.fileMimeType = "";
    els.imagePreview.classList.add("hidden");
    els.imagePreview.removeAttribute("src");
    els.imageInput.value = "";
  }
});

els.imageInput.addEventListener("change", async () => {
  const file = els.imageInput.files?.[0];
  if (!file) return;
  state.fileDataUrl = await fileToDataUrl(file);
  state.fileName = file.name || "";
  state.fileMimeType = file.type || "";

  if ((file.type || "").startsWith("image/")) {
    els.imagePreview.src = state.fileDataUrl;
    els.imagePreview.classList.remove("hidden");
  } else {
    els.imagePreview.classList.add("hidden");
    els.imagePreview.removeAttribute("src");
  }
});

els.captureForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.loading) return;

  const payload = {
    sourceType: els.sourceType.value,
    content: els.contentInput.value,
    sourceUrl: els.sourceUrlInput.value,
    project: els.projectInput.value,
    imageDataUrl: els.sourceType.value === "image" ? state.fileDataUrl : null,
    fileDataUrl: state.fileDataUrl,
    fileName: state.fileName,
    fileMimeType: state.fileMimeType,
  };

  state.loading = true;
  els.saveBtn.disabled = true;
  els.saveBtn.textContent = "Saving...";

  try {
    await jsonFetch("/api/notes", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    els.contentInput.value = "";
    els.sourceUrlInput.value = "";
    els.imageInput.value = "";
    state.fileDataUrl = null;
    state.fileName = "";
    state.fileMimeType = "";
    els.imagePreview.classList.add("hidden");
    els.imagePreview.removeAttribute("src");

    await refreshNotes();
  } catch (error) {
    alert(error.message);
  } finally {
    state.loading = false;
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = "Save Memory";
  }
});

els.refreshBtn.addEventListener("click", async () => {
  await refreshNotes();
});

els.searchBtn.addEventListener("click", async () => {
  await refreshNotes();
});

els.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = els.questionInput.value.trim();
  if (!question) return;

  els.answerOutput.textContent = "Thinking...";

  try {
    const data = await jsonFetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        question,
        project: els.projectFilterInput.value.trim(),
      }),
    });

    els.answerOutput.textContent = data.answer || "No answer";
    renderCitations(data.citations || []);
  } catch (error) {
    els.answerOutput.textContent = error.message;
    renderCitations([]);
  }
});

els.contextBtn.addEventListener("click", async () => {
  const task = prompt("Task for context brief", "Summarize current project decisions and next steps");
  if (!task) return;

  els.answerOutput.textContent = "Generating context brief...";
  try {
    const data = await jsonFetch("/api/context", {
      method: "POST",
      body: JSON.stringify({
        task,
        project: els.projectFilterInput.value.trim(),
      }),
    });

    els.answerOutput.textContent = data.context || "No context generated";
    renderCitations(data.citations || []);
  } catch (error) {
    els.answerOutput.textContent = error.message;
    renderCitations([]);
  }
});

(async function init() {
  toggleCaptureFields();
  await initStatus();
  await refreshNotes();
})();
