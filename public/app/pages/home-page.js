import { renderComposer } from "../components/composer/composer.js";
import { renderHomeFolderGrid } from "../components/home-folder-grid/home-folder-grid.js";
import { renderHomeRecentList } from "../components/home-recent-list/home-recent-list.js";
import { renderTopbar } from "../components/topbar/topbar.js";
import {
  buildLocalFallbackNote,
  buildNoteTitle,
  conciseTechnicalError,
  filterAndRankMockNotes,
  inferCaptureType,
  normalizeCitation,
} from "../services/mappers.js";

const FOLDER_COLOR_TOKENS = ["sky", "mint", "sand", "rose", "violet", "slate"];
const FOLDER_SYMBOL_OPTIONS = ["DOC", "PLAN", "CODE", "LINK", "MEDIA", "NOTE"];

function renderFolderColorChoices() {
  return FOLDER_COLOR_TOKENS.map((color, index) => {
    const activeClass = index === 0 ? " is-selected" : "";
    const activePressed = index === 0 ? "true" : "false";
    return `
      <button class="folder-color-choice${activeClass}" type="button" data-color="${color}" aria-pressed="${activePressed}">
        <span class="folder-color-dot" data-color="${color}" aria-hidden="true"></span>
      </button>
    `;
  }).join("");
}

function renderFolderSymbolChoices() {
  return FOLDER_SYMBOL_OPTIONS.map((symbol, index) => {
    const activeClass = index === 0 ? " is-selected" : "";
    const activePressed = index === 0 ? "true" : "false";
    return `
      <button class="folder-symbol-choice${activeClass}" type="button" data-symbol="${symbol}" aria-pressed="${activePressed}">
        <span class="folder-symbol-badge">${symbol}</span>
      </button>
    `;
  }).join("");
}

function renderHomePageShell() {
  return `
    <section class="page page-home">
      ${renderTopbar({ showNewFolder: true })}

      <section class="home-layout">
        <div class="home-explorer-pane">
          ${renderHomeFolderGrid()}
        </div>

        ${renderHomeRecentList()}
      </section>

      ${renderComposer({ mode: "home" })}
    </section>

    <div id="item-modal" class="item-modal hidden" aria-hidden="true">
      <div id="item-modal-backdrop" class="item-modal-backdrop"></div>
      <article class="item-modal-panel" role="dialog" aria-modal="true" aria-labelledby="item-modal-title">
        <button id="item-modal-close" class="item-modal-close" type="button" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
        </button>
        <p id="item-modal-project" class="item-modal-project"></p>
        <h3 id="item-modal-title" class="item-modal-title"></h3>
        <p id="item-modal-content" class="item-modal-content"></p>
        <img id="item-modal-image" class="item-modal-image hidden" alt="Item preview" />
      </article>
    </div>

    <div id="folder-modal" class="folder-modal hidden" aria-hidden="true">
      <div id="folder-modal-backdrop" class="folder-modal-backdrop"></div>
      <article class="folder-modal-panel" role="dialog" aria-modal="true">
        <button id="folder-modal-close" class="folder-modal-close" type="button" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>
        </button>

        <h3 class="folder-modal-heading">New Folder</h3>

        <form id="folder-form" class="folder-form">
          <label class="folder-form-label" for="folder-name-input">Name</label>
          <input id="folder-name-input" class="folder-input" type="text" maxlength="64" placeholder="e.g. Launch Plan" autocomplete="off" />

          <label class="folder-form-label" for="folder-description-input">Description</label>
          <textarea id="folder-description-input" class="folder-textarea" rows="2" maxlength="180" placeholder="Short description"></textarea>

          <div class="folder-color-row" id="folder-color-row">
            ${renderFolderColorChoices()}
          </div>

          <div class="folder-symbol-row" id="folder-symbol-row">
            ${renderFolderSymbolChoices()}
          </div>

          <div class="folder-form-actions">
            <button id="folder-create-btn" class="folder-create-btn" type="submit">Create Folder</button>
          </div>
        </form>
      </article>
    </div>
  `;
}

function queryElements(mountNode) {
  return {
    topbarSearchWrap: mountNode.querySelector("#topbar-search-wrap"),
    topbarSearchToggle: mountNode.querySelector("#topbar-search-toggle"),
    topbarSearchInput: mountNode.querySelector("#topbar-search-input"),
    captureForm: mountNode.querySelector("#capture-form"),
    contentInput: mountNode.querySelector("#content-input"),
    projectInput: mountNode.querySelector("#project-input"),
    projectSelect: mountNode.querySelector("#project-select"),
    captureHint: mountNode.querySelector("#capture-hint"),
    attachmentToggle: mountNode.querySelector("#attachment-toggle"),
    fileInput: mountNode.querySelector("#file-input"),
    selectedFilePill: mountNode.querySelector("#selected-file-pill"),
    selectedFileName: mountNode.querySelector("#selected-file-name"),
    clearFileBtn: mountNode.querySelector("#clear-file-btn"),
    saveBtn: mountNode.querySelector("#save-btn"),
    notesList: mountNode.querySelector("#notes-list"),
    refreshBtn: mountNode.querySelector("#refresh-btn"),
    foldersList: mountNode.querySelector("#home-folders-list"),
    foldersEmpty: mountNode.querySelector("#home-folders-empty"),
    foldersError: mountNode.querySelector("#home-folders-error"),
    newFolderBtn: mountNode.querySelector("#topbar-new-folder-btn"),
    itemModal: mountNode.querySelector("#item-modal"),
    itemModalBackdrop: mountNode.querySelector("#item-modal-backdrop"),
    itemModalClose: mountNode.querySelector("#item-modal-close"),
    itemModalProject: mountNode.querySelector("#item-modal-project"),
    itemModalTitle: mountNode.querySelector("#item-modal-title"),
    itemModalContent: mountNode.querySelector("#item-modal-content"),
    itemModalImage: mountNode.querySelector("#item-modal-image"),
    folderModal: mountNode.querySelector("#folder-modal"),
    folderModalBackdrop: mountNode.querySelector("#folder-modal-backdrop"),
    folderModalClose: mountNode.querySelector("#folder-modal-close"),
    folderForm: mountNode.querySelector("#folder-form"),
    folderNameInput: mountNode.querySelector("#folder-name-input"),
    folderDescriptionInput: mountNode.querySelector("#folder-description-input"),
    folderColorRow: mountNode.querySelector("#folder-color-row"),
    folderSymbolRow: mountNode.querySelector("#folder-symbol-row"),
    toast: document.getElementById("toast"),
  };
}

function iconTypeFor(note) {
  if (note.sourceType === "image") return "image";
  if (note.sourceType === "link") return "link";
  if ((note.sourceType || "").toLowerCase() === "file") return "file";
  return "text";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isProcessedNote(note) {
  return Boolean(String(note.summary || "").trim()) && String(note.summary || "").trim() !== "(no summary)";
}

function normalizeFolderColor(value, fallback = "sky") {
  const normalized = String(value || "").toLowerCase().trim();
  return FOLDER_COLOR_TOKENS.includes(normalized) ? normalized : fallback;
}

function normalizeFolderSymbol(value, fallback = "DOC") {
  const normalized = String(value || "")
    .toUpperCase()
    .trim();
  return FOLDER_SYMBOL_OPTIONS.includes(normalized) ? normalized : fallback;
}

function fallbackColorForFolder(name = "") {
  const total = String(name)
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return FOLDER_COLOR_TOKENS[total % FOLDER_COLOR_TOKENS.length] || "sky";
}

function normalizeFolderDrafts(rawDrafts = []) {
  const map = new Map();

  (Array.isArray(rawDrafts) ? rawDrafts : []).forEach((entry) => {
    const draft =
      typeof entry === "string"
        ? { name: entry, description: "", color: fallbackColorForFolder(entry), symbol: "DOC" }
        : {
            name: entry?.name || "",
            description: entry?.description || "",
            color: normalizeFolderColor(entry?.color, fallbackColorForFolder(entry?.name || "")),
            symbol: normalizeFolderSymbol(entry?.symbol, "DOC"),
          };

    const name = String(draft.name || "").trim();
    if (!name) return;

    map.set(name.toLowerCase(), {
      name,
      description: String(draft.description || "").trim(),
      color: normalizeFolderColor(draft.color, fallbackColorForFolder(name)),
      symbol: normalizeFolderSymbol(draft.symbol, "DOC"),
    });
  });

  return [...map.values()];
}

function openItemModal(els, note) {
  if (!els.itemModal || !note) return;

  els.itemModalTitle.textContent = buildNoteTitle(note);
  els.itemModalProject.textContent = note.project || "General";
  els.itemModalContent.textContent = note.content || "";

  if (note.imagePath) {
    els.itemModalImage.src = note.imagePath;
    els.itemModalImage.classList.remove("hidden");
  } else {
    els.itemModalImage.src = "";
    els.itemModalImage.classList.add("hidden");
  }

  els.itemModal.classList.remove("hidden");
  els.itemModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeItemModal(els) {
  if (!els.itemModal) return;
  els.itemModal.classList.add("hidden");
  els.itemModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function openFolderModal(els, selectedColor = "sky", selectedSymbol = "DOC") {
  if (!els.folderModal) return;

  els.folderNameInput.value = "";
  els.folderDescriptionInput.value = "";

  els.folderColorRow?.querySelectorAll(".folder-color-choice").forEach((button) => {
    const isSelected = button.dataset.color === selectedColor;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
  });

  els.folderSymbolRow?.querySelectorAll(".folder-symbol-choice").forEach((button) => {
    const isSelected = button.dataset.symbol === selectedSymbol;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
  });

  els.folderModal.classList.remove("hidden");
  els.folderModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  els.folderNameInput?.focus();
}

function closeFolderModal(els) {
  if (!els.folderModal) return;
  els.folderModal.classList.add("hidden");
  els.folderModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

export function createHomePage({ store, apiClient }) {
  return {
    async mount({ mountNode, navigate }) {
      mountNode.innerHTML = renderHomePageShell();
      const els = queryElements(mountNode);
      const disposers = [];
      let isMounted = true;
      let attachment = {
        name: "",
        fileDataUrl: null,
        fileMimeType: "",
        isImage: false,
      };

      function on(target, eventName, handler, options) {
        if (!target) return;
        target.addEventListener(eventName, handler, options);
        disposers.push(() => target.removeEventListener(eventName, handler, options));
      }

      function getState() {
        return store.getState();
      }

      function setState(patch) {
        return store.setState(patch);
      }

      function markAccessed(noteId) {
        if (!noteId) return;
        const state = getState();
        const set = new Set(state.accessedIds || []);
        set.add(String(noteId));
        setState({ accessedIds: [...set] });
      }

      function upsertDraftFolder({ name, description = "", color = "sky", symbol = "DOC" }) {
        const normalizedName = String(name || "").trim();
        if (!normalizedName) return;

        const normalizedDescription = String(description || "").trim();
        const normalizedColor = normalizeFolderColor(color, fallbackColorForFolder(normalizedName));
        const normalizedSymbol = normalizeFolderSymbol(symbol, "DOC");
        const drafts = normalizeFolderDrafts(getState().draftFolders);
        const key = normalizedName.toLowerCase();
        const index = drafts.findIndex((entry) => entry.name.toLowerCase() === key);

        if (index >= 0) {
          drafts[index] = {
            ...drafts[index],
            name: normalizedName,
            description: normalizedDescription || drafts[index].description || "",
            color: normalizedColor,
            symbol: normalizedSymbol,
          };
        } else {
          drafts.push({
            name: normalizedName,
            description: normalizedDescription,
            color: normalizedColor,
            symbol: normalizedSymbol,
          });
        }

        setState({ draftFolders: drafts });
      }

      function setCaptureHint(text, tone = "neutral") {
        if (!els.captureHint) return;
        els.captureHint.textContent = text;
        els.captureHint.classList.toggle("warn", tone === "warn");
      }

      function showToast(message, tone = "success") {
        if (!els.toast) return;
        const state = getState();
        els.toast.textContent = message;
        els.toast.classList.remove("hidden", "show", "error");
        if (tone === "error") {
          els.toast.classList.add("error");
        }

        requestAnimationFrame(() => {
          els.toast.classList.add("show");
        });

        if (state.toastTimer) {
          clearTimeout(state.toastTimer);
        }

        const toastTimer = window.setTimeout(() => {
          els.toast.classList.remove("show");
          window.setTimeout(() => {
            els.toast.classList.add("hidden");
          }, 180);
        }, 2200);

        setState({ toastTimer });
      }

      function setSearchExpanded(expanded) {
        const isExpanded = Boolean(expanded);
        els.topbarSearchWrap?.classList.toggle("is-open", isExpanded);
        els.topbarSearchWrap?.setAttribute("data-expanded", isExpanded ? "true" : "false");
        els.topbarSearchToggle?.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      }

      function setFallbackHint(active) {
        if (!els.foldersError) return;
        els.foldersError.classList.toggle("hidden", !active);
      }

      function renderFolders() {
        if (!els.foldersList || !els.foldersEmpty) return;
        const state = getState();
        const folderMap = new Map();

        normalizeFolderDrafts(state.draftFolders).forEach((folder) => {
          folderMap.set(folder.name.toLowerCase(), {
            ...folder,
            count: 0,
          });
        });

        state.notes.forEach((entry, index) => {
          const note = normalizeCitation(entry, index).note;
          const projectName = note.project || "General";
          const key = String(projectName).toLowerCase();

          if (!folderMap.has(key)) {
            folderMap.set(key, {
              name: projectName,
              description: "",
              color: fallbackColorForFolder(projectName),
              symbol: "DOC",
              count: 0,
            });
          }

          const current = folderMap.get(key);
          current.count += 1;
          folderMap.set(key, current);
        });

        const folders = [...folderMap.values()].sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return a.name.localeCompare(b.name);
        });

        els.foldersList.innerHTML = "";
        if (!folders.length) {
          els.foldersEmpty.classList.remove("hidden");
          return;
        }

        els.foldersEmpty.classList.add("hidden");

        folders.slice(0, 40).forEach((folder) => {
          const card = document.createElement("a");
          card.className = "folder-pill";
          card.href = `#/folder/${encodeURIComponent(folder.name)}`;
          card.dataset.color = folder.color;
          card.dataset.symbol = folder.symbol;

          const top = document.createElement("div");
          top.className = "folder-pill-top";

          const symbolEl = document.createElement("span");
          symbolEl.className = "folder-symbol-badge";
          symbolEl.textContent = normalizeFolderSymbol(folder.symbol, "DOC");

          const nameEl = document.createElement("span");
          nameEl.className = "folder-pill-name";
          nameEl.textContent = folder.name;

          const countEl = document.createElement("span");
          countEl.className = "folder-pill-count";
          countEl.textContent = `${folder.count}`;

          top.append(symbolEl, nameEl, countEl);

          const descriptionEl = document.createElement("p");
          descriptionEl.className = "folder-pill-desc";
          descriptionEl.textContent = folder.description || "No description";

          card.append(top, descriptionEl);

          card.addEventListener("click", (event) => {
            event.preventDefault();
            navigate(`#/folder/${encodeURIComponent(folder.name)}`);
          });

          els.foldersList.appendChild(card);
        });
      }

      function renderRecent(items) {
        if (!els.notesList) return;
        els.notesList.innerHTML = "";

        const list = Array.isArray(items) ? items.slice(0, 32) : [];
        if (!list.length) {
          const empty = document.createElement("p");
          empty.className = "ui-empty";
          empty.textContent = "No items yet.";
          els.notesList.appendChild(empty);
          return;
        }

        const accessedSet = new Set(getState().accessedIds || []);

        list.forEach((entry, index) => {
          const note = normalizeCitation(entry, index).note;
          const item = document.createElement("button");
          item.type = "button";
          item.className = "recent-item";
          item.title = buildNoteTitle(note);

          const icon = document.createElement("span");
          icon.className = "recent-item-icon";
          icon.dataset.type = iconTypeFor(note);

          const label = document.createElement("span");
          label.className = "recent-item-label";
          label.textContent = buildNoteTitle(note);

          const states = document.createElement("span");
          states.className = "recent-item-states";

          const processedDot = document.createElement("span");
          processedDot.className = `state-dot ${isProcessedNote(note) ? "is-processed" : "is-pending"}`;
          processedDot.title = isProcessedNote(note) ? "Processed" : "Pending processing";

          const accessedDot = document.createElement("span");
          const accessed = accessedSet.has(String(note.id || ""));
          accessedDot.className = `state-dot is-accessed${accessed ? "" : " hidden"}`;
          accessedDot.title = "Opened";

          states.append(processedDot, accessedDot);
          item.append(icon, label, states);

          item.addEventListener("click", () => {
            openItemModal(els, note);
            markAccessed(note.id);
            renderRecent(getState().notes);
          });

          els.notesList.appendChild(item);
        });
      }

      function renderProjectOptions() {
        if (!els.projectSelect) return;

        const state = getState();
        const folderNames = new Set();

        normalizeFolderDrafts(state.draftFolders).forEach((folder) => {
          folderNames.add(folder.name);
        });

        state.notes.forEach((entry, index) => {
          const note = normalizeCitation(entry, index).note;
          const projectName = String(note.project || "").trim();
          if (projectName) {
            folderNames.add(projectName);
          }
        });

        const options = [...folderNames].sort((a, b) => a.localeCompare(b));
        const currentValue = String(els.projectSelect.value || els.projectInput?.value || "").trim();

        els.projectSelect.innerHTML = '<option value="">Folder</option>';
        options.forEach((name) => {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          els.projectSelect.append(option);
        });

        if (currentValue && options.includes(currentValue)) {
          els.projectSelect.value = currentValue;
        } else if (currentValue) {
          const option = document.createElement("option");
          option.value = currentValue;
          option.textContent = currentValue;
          els.projectSelect.append(option);
          els.projectSelect.value = currentValue;
        } else {
          els.projectSelect.value = "";
        }
      }

      function renderView() {
        const items = getState().notes;
        renderFolders();
        renderRecent(items);
        renderProjectOptions();
      }

      async function refreshNotes() {
        const query = (els.topbarSearchInput?.value || "").trim();

        try {
          const data = await apiClient.fetchNotes({ query, limit: 120 });
          if (!isMounted) return;
          setState({ notes: data.items });
          setFallbackHint(false);
          renderView();
        } catch (error) {
          if (!isMounted) return;
          const message = conciseTechnicalError(error, "Notes endpoint unavailable");
          const fallback = filterAndRankMockNotes(getState().mockNotes, { query, limit: 120 });
          setState({ notes: fallback });
          setFallbackHint(true);
          renderView();
          apiClient.adapterLog("notes_fallback", message);
        }
      }

      function clearAttachment() {
        attachment = {
          name: "",
          fileDataUrl: null,
          fileMimeType: "",
          isImage: false,
        };

        if (els.fileInput) {
          els.fileInput.value = "";
        }

        if (els.selectedFileName) {
          els.selectedFileName.textContent = "";
        }

        els.selectedFilePill?.classList.add("hidden");
      }

      function setAttachment(fileName, fileDataUrl = null, fileMimeType = "") {
        const normalizedMime = String(fileMimeType || "").toLowerCase();
        attachment = {
          name: fileName,
          fileDataUrl,
          fileMimeType: normalizedMime,
          isImage: normalizedMime.startsWith("image/"),
        };

        if (els.selectedFileName) {
          els.selectedFileName.textContent = fileName;
        }

        els.selectedFilePill?.classList.remove("hidden");
      }

      function getSelectedFolderColor() {
        const selected = els.folderColorRow?.querySelector(".folder-color-choice.is-selected");
        return normalizeFolderColor(selected?.dataset.color, "sky");
      }

      function getSelectedFolderSymbol() {
        const selected = els.folderSymbolRow?.querySelector(".folder-symbol-choice.is-selected");
        return normalizeFolderSymbol(selected?.dataset.symbol, "DOC");
      }

      on(els.topbarSearchToggle, "click", () => {
        const expanded = els.topbarSearchWrap?.classList.contains("is-open");
        setSearchExpanded(!expanded);
        if (!expanded) {
          els.topbarSearchInput?.focus();
        }
      });

      on(els.topbarSearchInput, "keydown", async (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        await refreshNotes();
      });

      on(mountNode, "click", (event) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        const insideSearch = els.topbarSearchWrap?.contains(target);
        if (!insideSearch && !(els.topbarSearchInput?.value || "").trim()) {
          setSearchExpanded(false);
        }
      });

      on(els.attachmentToggle, "click", () => {
        els.fileInput?.click();
      });

      on(els.fileInput, "change", async () => {
        const file = els.fileInput?.files?.[0];
        if (!file) return;

        try {
          const fileDataUrl = await fileToDataUrl(file);
          setAttachment(file.name || "file", fileDataUrl, file.type || "");
        } catch (error) {
          setCaptureHint(conciseTechnicalError(error, "File read failed"), "warn");
          showToast("File read failed", "error");
        }
      });

      on(els.clearFileBtn, "click", () => {
        clearAttachment();
      });

      on(els.projectSelect, "change", () => {
        if (!els.projectInput) return;
        els.projectInput.value = String(els.projectSelect?.value || "").trim();
      });

      on(els.captureForm, "submit", async (event) => {
        event.preventDefault();
        if (getState().loading) return;

        const rawContent = (els.contentInput?.value || "").trim();
        const project = String(els.projectSelect?.value || els.projectInput?.value || "").trim();
        const content = rawContent || (attachment.name ? `File: ${attachment.name}` : "");

        if (!content && !attachment.fileDataUrl) {
          setCaptureHint("Add text, link, image, or file.", "warn");
          showToast("Add content first", "error");
          els.contentInput?.focus();
          return;
        }

        const inferred = attachment.fileDataUrl
          ? { sourceType: attachment.isImage ? "image" : "file", sourceUrl: "" }
          : inferCaptureType(content, null);
        const payload = {
          sourceType: inferred.sourceType,
          content,
          sourceUrl: inferred.sourceUrl,
          project,
          imageDataUrl: attachment.isImage ? attachment.fileDataUrl : null,
          fileDataUrl: attachment.fileDataUrl,
          fileName: attachment.name || "",
          fileMimeType: attachment.fileMimeType || "",
        };

        setState({ loading: true });
        if (els.saveBtn) {
          els.saveBtn.disabled = true;
        }

        try {
          await apiClient.saveNote(payload);
          if (!isMounted) return;

          if (els.contentInput) {
            els.contentInput.value = "";
          }
          clearAttachment();
          setCaptureHint("Saved.");
          showToast("Item saved");
          await refreshNotes();
        } catch (error) {
          if (!isMounted) return;

          const message = conciseTechnicalError(error, "Save endpoint unavailable");
          const validationLike = /missing content|invalid image|invalid file|invalid json|request failed \(4\d\d\)/i.test(message);

          if (validationLike) {
            setCaptureHint(message, "warn");
            showToast("Save failed", "error");
          } else {
            const nextMock = [buildLocalFallbackNote(payload), ...getState().mockNotes];
            setState({ mockNotes: nextMock });

            if (els.contentInput) {
              els.contentInput.value = "";
            }
            clearAttachment();
            setCaptureHint("Saved locally.", "warn");
            showToast("Saved locally");
            setFallbackHint(true);

            const fallback = filterAndRankMockNotes(nextMock, {
              query: (els.topbarSearchInput?.value || "").trim(),
              limit: 120,
            });
            setState({ notes: fallback });
            renderView();
            apiClient.adapterLog("save_fallback", message);
          }
        } finally {
          if (!isMounted) return;
          setState({ loading: false });
          if (els.saveBtn) {
            els.saveBtn.disabled = false;
          }
        }
      });

      on(els.refreshBtn, "click", async () => {
        await refreshNotes();
      });

      on(els.newFolderBtn, "click", () => {
        openFolderModal(els, "sky", "DOC");
      });

      on(els.folderColorRow, "click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest(".folder-color-choice");
        if (!(button instanceof HTMLButtonElement)) return;

        els.folderColorRow?.querySelectorAll(".folder-color-choice").forEach((entry) => {
          const active = entry === button;
          entry.classList.toggle("is-selected", active);
          entry.setAttribute("aria-pressed", active ? "true" : "false");
        });
      });

      on(els.folderSymbolRow, "click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest(".folder-symbol-choice");
        if (!(button instanceof HTMLButtonElement)) return;

        els.folderSymbolRow?.querySelectorAll(".folder-symbol-choice").forEach((entry) => {
          const active = entry === button;
          entry.classList.toggle("is-selected", active);
          entry.setAttribute("aria-pressed", active ? "true" : "false");
        });
      });

      on(els.folderForm, "submit", (event) => {
        event.preventDefault();

        const name = String(els.folderNameInput?.value || "").trim();
        if (!name) {
          els.folderNameInput?.focus();
          return;
        }

        const description = String(els.folderDescriptionInput?.value || "").trim();
        const color = getSelectedFolderColor();
        const symbol = getSelectedFolderSymbol();

        upsertDraftFolder({ name, description, color, symbol });
        renderFolders();
        renderProjectOptions();
        closeFolderModal(els);
        navigate(`#/folder/${encodeURIComponent(name)}`);
      });

      on(els.folderModalClose, "click", () => {
        closeFolderModal(els);
      });

      on(els.folderModalBackdrop, "click", () => {
        closeFolderModal(els);
      });

      on(els.itemModalClose, "click", () => {
        closeItemModal(els);
      });

      on(els.itemModalBackdrop, "click", () => {
        closeItemModal(els);
      });

      on(document, "keydown", (event) => {
        if (event.key !== "Escape") return;
        closeItemModal(els);
        closeFolderModal(els);
      });

      setSearchExpanded(false);
      clearAttachment();
      setCaptureHint("");
      await refreshNotes();

      return () => {
        isMounted = false;
        const state = getState();
        if (state.toastTimer) {
          clearTimeout(state.toastTimer);
          setState({ toastTimer: null });
        }
        closeItemModal(els);
        closeFolderModal(els);
        disposers.forEach((dispose) => {
          dispose();
        });
      };
    },
  };
}
