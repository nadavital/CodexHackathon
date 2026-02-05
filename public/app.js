const state = {
  notes: [],
  tasks: [],
  activeTab: "memory",
  fileDataUrl: null,
  fileName: "",
  fileMimeType: "",
  loading: false,
};

const els = {
  statusPill: document.getElementById("status-pill"),
  memoryCount: document.getElementById("memory-count"),
  tabMemory: document.getElementById("tab-memory"),
  tabTasks: document.getElementById("tab-tasks"),
  memoryPage: document.getElementById("memory-page"),
  tasksPage: document.getElementById("tasks-page"),
  projectChips: document.getElementById("project-chips"),
  sourceBars: document.getElementById("source-bars"),
  freshMemory: document.getElementById("fresh-memory"),
  timeline: document.getElementById("timeline"),
  timelineTemplate: document.getElementById("timeline-item-template"),
  inspector: document.getElementById("inspector"),
  refreshBtn: document.getElementById("refresh-btn"),
  searchInput: document.getElementById("search-input"),
  projectFilterInput: document.getElementById("project-filter-input"),
  searchBtn: document.getElementById("search-btn"),
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
  chatForm: document.getElementById("chat-form"),
  questionInput: document.getElementById("question-input"),
  answerOutput: document.getElementById("answer-output"),
  citationList: document.getElementById("citation-list"),
  contextBtn: document.getElementById("context-btn"),
  taskForm: document.getElementById("task-form"),
  taskTitleInput: document.getElementById("task-title-input"),
  tasksRefreshBtn: document.getElementById("tasks-refresh-btn"),
  tasksList: document.getElementById("tasks-list"),
};

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return d.toLocaleString();
}

function short(text, max = 180) {
  const normalized = String(text || "").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdownPreview(markdown) {
  const src = String(markdown || "").trim();
  if (!src) {
    return "<p class='md-empty'>(no extracted markdown)</p>";
  }

  const lines = src.split(/\r?\n/);
  const out = [];
  let inList = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      continue;
    }

    if (line.startsWith("### ")) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      out.push(`<h4>${escapeHtml(line.slice(4))}</h4>`);
      continue;
    }

    if (line.startsWith("## ")) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      out.push(`<h3>${escapeHtml(line.slice(3))}</h3>`);
      continue;
    }

    if (line.startsWith("# ")) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      out.push(`<h2>${escapeHtml(line.slice(2))}</h2>`);
      continue;
    }

    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${escapeHtml(line.replace(/^([-*]|\d+\.)\s+/, ""))}</li>`);
      continue;
    }

    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    out.push(`<p>${escapeHtml(line)}</p>`);
  }

  if (inList) {
    out.push("</ul>");
  }

  return out.join("");
}

function setStatus(text, warn = false) {
  els.statusPill.textContent = text;
  els.statusPill.style.borderColor = warn ? "rgba(201, 83, 44, 0.45)" : "";
  els.statusPill.style.color = warn ? "#9e2b11" : "";
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

function switchTab(tab) {
  state.activeTab = tab;
  const isMemory = tab === "memory";
  els.tabMemory.classList.toggle("active", isMemory);
  els.tabTasks.classList.toggle("active", !isMemory);
  els.memoryPage.classList.toggle("hidden", !isMemory);
  els.tasksPage.classList.toggle("hidden", isMemory);
}

function aggregateBy(items, keyGetter) {
  const counts = new Map();
  for (const item of items) {
    const key = keyGetter(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function renderProjectChips(notes) {
  els.projectChips.innerHTML = "";
  const rows = aggregateBy(notes, (n) => n.project || "General").slice(0, 10);
  if (!rows.length) {
    els.projectChips.textContent = "No projects yet.";
    return;
  }

  for (const [project, count] of rows) {
    const chip = document.createElement("span");
    chip.className = "project-chip";
    chip.textContent = `${project} (${count})`;
    chip.addEventListener("click", () => {
      els.projectFilterInput.value = project === "General" ? "" : project;
      refreshMemory();
    });
    els.projectChips.appendChild(chip);
  }
}

function renderSourceBars(notes) {
  els.sourceBars.innerHTML = "";
  const rows = aggregateBy(notes, (n) => n.sourceType || "text");
  const max = rows[0]?.[1] || 1;

  if (!rows.length) {
    els.sourceBars.textContent = "No source data.";
    return;
  }

  for (const [name, count] of rows) {
    const row = document.createElement("div");
    row.className = "source-row";
    const width = Math.max(4, Math.round((count / max) * 100));
    row.innerHTML = `
      <span>${name}</span>
      <span class="bar-wrap"><span class="bar" style="width:${width}%"></span></span>
      <span>${count}</span>
    `;
    els.sourceBars.appendChild(row);
  }
}

function renderFreshMemory(notes) {
  const latest = notes.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  if (!latest) {
    els.freshMemory.textContent = "No memory captured yet.";
    return;
  }

  els.freshMemory.innerHTML = `
    <strong>${latest.project || "General"}</strong><br />
    ${short(latest.summary || latest.content, 120)}<br />
    <small>${formatDate(latest.createdAt)}</small>
  `;
}

function renderInspector(note) {
  if (!note) {
    els.inspector.className = "inspector-empty";
    els.inspector.textContent = "Select a memory from the stream.";
    return;
  }

  els.inspector.className = "inspector-body";
  const rawContent = String(note.rawContent || "");
  const markdownContent = String(note.markdownContent || "");
  els.inspector.innerHTML = `
    <div class="inspector-row"><strong>Project:</strong> ${escapeHtml(note.project || "General")}</div>
    <div class="inspector-row"><strong>Source:</strong> ${escapeHtml(note.sourceType || "text")}</div>
    <div class="inspector-row"><strong>Created:</strong> ${escapeHtml(formatDate(note.createdAt))}</div>
    <div class="inspector-row"><strong>Summary:</strong> ${escapeHtml(note.summary || "(none)")}</div>
    <div class="inspector-row"><strong>Content:</strong><pre class="plain-preview">${escapeHtml(short(note.content || "", 1800))}</pre></div>
    <div class="inspector-row"><strong>Raw (${rawContent.length} chars):</strong><pre class="plain-preview">${escapeHtml(short(rawContent || "(no extracted raw content)", 3000))}</pre></div>
    <div class="inspector-row">
      <strong>Markdown (${markdownContent.length} chars):</strong>
      <div class="markdown-preview">${renderMarkdownPreview(markdownContent)}</div>
    </div>
  `;
}

function renderTimeline(items) {
  els.timeline.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "inspector-empty";
    empty.textContent = "No memories found.";
    els.timeline.appendChild(empty);
    renderInspector(null);
    return;
  }

  for (const item of items) {
    const note = item.note || item;
    const fragment = els.timelineTemplate.content.cloneNode(true);

    fragment.querySelector(".memory-project").textContent = note.project || "General";
    fragment.querySelector(".memory-time").textContent = formatDate(note.createdAt);
    fragment.querySelector(".memory-summary").textContent = note.summary || "No summary";
    fragment.querySelector(".memory-content").textContent = short(note.content || "", 210);

    const tagsWrap = fragment.querySelector(".memory-tags");
    for (const tag of note.tags || []) {
      const el = document.createElement("span");
      el.className = "tag";
      el.textContent = tag;
      tagsWrap.appendChild(el);
    }

    const card = fragment.querySelector(".memory-card");
    card.addEventListener("click", () => renderInspector(note));
    els.timeline.appendChild(fragment);
  }

  renderInspector(items[0].note || items[0]);
}

function renderCitations(citations = []) {
  els.citationList.innerHTML = "";
  if (!citations.length) {
    els.citationList.innerHTML = "<div class='inspector-empty'>No citations yet.</div>";
    return;
  }

  citations.forEach((entry, idx) => {
    const note = entry.note;
    const card = document.createElement("article");
    card.className = "citation-item";
    card.innerHTML = `
      <strong>[N${idx + 1}] ${note.project || "General"}</strong>
      <p>${short(note.summary || note.content || "", 180)}</p>
    `;
    card.addEventListener("click", () => renderInspector(note));
    els.citationList.appendChild(card);
  });
}

function renderTasks(tasks) {
  els.tasksList.innerHTML = "";
  if (!tasks.length) {
    els.tasksList.innerHTML = "<div class='inspector-empty'>No open tasks yet.</div>";
    return;
  }

  for (const task of tasks) {
    const item = document.createElement("article");
    item.className = "task-item";
    item.innerHTML = `
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-meta">${escapeHtml(task.status)} • ${escapeHtml(formatDate(task.createdAt))}</div>
    `;
    els.tasksList.appendChild(item);
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

async function refreshMemory() {
  const query = els.searchInput.value.trim();
  const project = els.projectFilterInput.value.trim();

  const params = new URLSearchParams({ limit: "80" });
  if (query) params.set("query", query);
  if (project) params.set("project", project);

  const data = await jsonFetch(`/api/notes?${params.toString()}`);
  const items = Array.isArray(data.items) ? data.items : [];
  const notes = items.map((item) => item.note || item);

  state.notes = notes;
  els.memoryCount.textContent = `${notes.length} memories`;

  renderProjectChips(notes);
  renderSourceBars(notes);
  renderFreshMemory(notes);
  renderTimeline(items);
}

async function refreshTasks() {
  const data = await jsonFetch("/api/tasks?status=open");
  const tasks = Array.isArray(data.items) ? data.items : [];
  state.tasks = tasks;
  renderTasks(tasks);
}

async function initStatus() {
  try {
    const health = await jsonFetch("/api/health");
    if (health.openaiConfigured) {
      setStatus("OpenAI connected");
    } else {
      setStatus("Heuristic mode (OPENAI_API_KEY missing)", true);
    }
  } catch {
    setStatus("Backend unavailable", true);
  }
}

els.tabMemory.addEventListener("click", () => switchTab("memory"));
els.tabTasks.addEventListener("click", () => switchTab("tasks"));
els.refreshBtn.addEventListener("click", refreshMemory);
els.searchBtn.addEventListener("click", refreshMemory);
els.tasksRefreshBtn.addEventListener("click", refreshTasks);

els.sourceType.addEventListener("change", () => {
  toggleCaptureFields();
  if (!["image", "file"].includes(els.sourceType.value)) {
    els.imageInput.value = "";
    els.imagePreview.classList.add("hidden");
    els.imagePreview.removeAttribute("src");
    state.fileDataUrl = null;
    state.fileName = "";
    state.fileMimeType = "";
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
    fileDataUrl: state.fileDataUrl,
    imageDataUrl: els.sourceType.value === "image" ? state.fileDataUrl : null,
    fileName: state.fileName,
    fileMimeType: state.fileMimeType,
  };

  state.loading = true;
  els.saveBtn.disabled = true;
  els.saveBtn.textContent = "Saving...";

  try {
    await jsonFetch("/api/notes", { method: "POST", body: JSON.stringify(payload) });
    els.contentInput.value = "";
    els.sourceUrlInput.value = "";
    els.imageInput.value = "";
    els.imagePreview.classList.add("hidden");
    els.imagePreview.removeAttribute("src");
    state.fileDataUrl = null;
    state.fileName = "";
    state.fileMimeType = "";
    await refreshMemory();
  } catch (error) {
    alert(error.message);
  } finally {
    state.loading = false;
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = "Save Memory";
  }
});

els.taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = els.taskTitleInput.value.trim();
  if (!title) return;

  try {
    await jsonFetch("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title, status: "open" }),
    });
    els.taskTitleInput.value = "";
    await refreshTasks();
  } catch (error) {
    alert(error.message);
  }
});

els.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = els.questionInput.value.trim();
  if (!question) return;

  els.answerOutput.textContent = "Thinking...";

  try {
    const data = await jsonFetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question, project: els.projectFilterInput.value.trim() }),
    });
    els.answerOutput.textContent = data.answer || "No answer";
    renderCitations(data.citations || []);
  } catch (error) {
    els.answerOutput.textContent = error.message;
    renderCitations([]);
  }
});

els.contextBtn.addEventListener("click", async () => {
  const task = prompt("Task for context brief", "Summarize decisions and next actions from my notes");
  if (!task) return;

  els.answerOutput.textContent = "Building context...";

  try {
    const data = await jsonFetch("/api/context", {
      method: "POST",
      body: JSON.stringify({ task, project: els.projectFilterInput.value.trim() }),
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
  switchTab("memory");
  await initStatus();
  await refreshMemory();
  await refreshTasks();
})();
