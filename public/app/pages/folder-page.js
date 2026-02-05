import { renderComposer } from "../components/composer/composer.js";
import { renderFolderHeroToolbar } from "../components/folder-hero-toolbar/folder-hero-toolbar.js";
import { renderFolderItemGrid } from "../components/folder-item-grid/folder-item-grid.js";
import { renderHomeRecentList } from "../components/home-recent-list/home-recent-list.js";
import { renderTopbar } from "../components/topbar/topbar.js";
import {
  buildLocalFallbackNote,
  buildNoteTitle,
  conciseTechnicalError,
  filterAndRankMockNotes,
  inferCaptureType,
  normalizeCitation,
  snippet,
} from "../services/mappers.js";

const FOLDER_COLOR_TOKENS = ["sky", "mint", "sand", "rose", "violet", "slate"];
const FOLDER_SYMBOL_OPTIONS = ["DOC", "PLAN", "CODE", "LINK", "MEDIA", "NOTE"];

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

function resolveFolderMeta(folderName, draftFolders) {
  const normalizedName = String(folderName || "").trim() || "General";
  const drafts = normalizeFolderDrafts(draftFolders);
  const found = drafts.find((entry) => entry.name.toLowerCase() === normalizedName.toLowerCase());

  if (found) return found;

  return {
    name: normalizedName,
    description: "",
    color: fallbackColorForFolder(normalizedName),
    symbol: "DOC",
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

function renderFolderPageShell(folderMeta) {
  return `
    <section class="page page-folder">
      ${renderTopbar()}

      <section class="folder-layout">
        <div class="folder-explorer-pane">
          ${renderFolderHeroToolbar({
            folderName: folderMeta.name,
            folderDescription: folderMeta.description,
            folderColor: folderMeta.color,
            folderSymbol: folderMeta.symbol,
          })}
          ${renderFolderItemGrid()}
        </div>

        ${renderHomeRecentList()}
      </section>

      ${renderComposer({ mode: "folder" })}
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
    folderItemsGrid: mountNode.querySelector("#folder-items-grid"),
    itemModal: mountNode.querySelector("#item-modal"),
    itemModalBackdrop: mountNode.querySelector("#item-modal-backdrop"),
    itemModalClose: mountNode.querySelector("#item-modal-close"),
    itemModalProject: mountNode.querySelector("#item-modal-project"),
    itemModalTitle: mountNode.querySelector("#item-modal-title"),
    itemModalContent: mountNode.querySelector("#item-modal-content"),
    itemModalImage: mountNode.querySelector("#item-modal-image"),
    toast: document.getElementById("toast"),
  };
}

function openModalForItem(els, note) {
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

function closeModal(els) {
  if (!els.itemModal) return;
  els.itemModal.classList.add("hidden");
  els.itemModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

export function createFolderPage({ store, apiClient }) {
  return {
    async mount({ mountNode, route }) {
      const folderName = route.folderId || "general";
      const folderMeta = resolveFolderMeta(folderName, store.getState().draftFolders);

      mountNode.innerHTML = renderFolderPageShell(folderMeta);
      const els = queryElements(mountNode);
      const disposers = [];
      let isMounted = true;
      let attachment = {
        name: "",
        fileDataUrl: null,
        fileMimeType: "",
        isImage: false,
      };

      if (els.projectInput) {
        els.projectInput.value = folderMeta.name;
      }
      if (els.projectSelect) {
        els.projectSelect.innerHTML = `<option value="${folderMeta.name}">${folderMeta.name}</option>`;
        els.projectSelect.value = folderMeta.name;
      }

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

      function ensureDraftFolder(folder) {
        const normalizedName = String(folder || "").trim();
        if (!normalizedName) return;

        const drafts = normalizeFolderDrafts(getState().draftFolders);
        if (drafts.some((entry) => entry.name.toLowerCase() === normalizedName.toLowerCase())) {
          return;
        }

        drafts.push({
          name: normalizedName,
          description: folderMeta.description || "",
          color: normalizeFolderColor(folderMeta.color, fallbackColorForFolder(normalizedName)),
          symbol: normalizeFolderSymbol(folderMeta.symbol, "DOC"),
        });

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

      function renderFolderItems(items) {
        if (!els.folderItemsGrid) return;
        els.folderItemsGrid.innerHTML = "";

        const list = Array.isArray(items) ? items : [];
        if (!list.length) {
          const empty = document.createElement("p");
          empty.className = "ui-empty";
          empty.textContent = "No items.";
          els.folderItemsGrid.appendChild(empty);
          return;
        }

        const accessedSet = new Set(getState().accessedIds || []);

        list.slice(0, 60).forEach((entry, index) => {
          const note = normalizeCitation(entry, index).note;
          const tile = document.createElement("button");
          tile.type = "button";
          tile.className = "folder-file-tile";
          tile.dataset.type = iconTypeFor(note);

          const createdAt = note.createdAt ? new Date(note.createdAt) : null;
          const createdLabel = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleDateString() : "";

          const typeBadge = document.createElement("span");
          typeBadge.className = "folder-file-type";
          typeBadge.textContent = note.sourceType || "text";

          const titleEl = document.createElement("p");
          titleEl.className = "folder-file-title";
          titleEl.textContent = buildNoteTitle(note);

          const previewEl = document.createElement("p");
          previewEl.className = "folder-file-preview";
          previewEl.textContent = snippet(note.content || note.summary || "", 88) || "No preview";

          const metaEl = document.createElement("p");
          metaEl.className = "folder-file-meta";
          metaEl.textContent = createdLabel;

          const stateRow = document.createElement("p");
          stateRow.className = "folder-file-state";
          const processed = isProcessedNote(note);
          const accessed = accessedSet.has(String(note.id || ""));
          stateRow.textContent = `${processed ? "Processed" : "Pending"}${accessed ? " • Opened" : ""}`;

          tile.append(typeBadge, titleEl, previewEl, metaEl, stateRow);

          tile.addEventListener("click", () => {
            openModalForItem(els, note);
            markAccessed(note.id);
            renderFolderItems(getState().notes);
            renderRecent(getState().notes);
          });

          els.folderItemsGrid.appendChild(tile);
        });
      }

      function renderRecent(items) {
        if (!els.notesList) return;
        els.notesList.innerHTML = "";

        const list = Array.isArray(items) ? items.slice(0, 30) : [];
        if (!list.length) {
          const empty = document.createElement("p");
          empty.className = "ui-empty";
          empty.textContent = "No recent.";
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

          const accessed = accessedSet.has(String(note.id || ""));
          const accessedDot = document.createElement("span");
          accessedDot.className = `state-dot is-accessed${accessed ? "" : " hidden"}`;
          accessedDot.title = "Opened";

          states.append(processedDot, accessedDot);
          item.append(icon, label, states);

          item.addEventListener("click", () => {
            openModalForItem(els, note);
            markAccessed(note.id);
            renderFolderItems(getState().notes);
            renderRecent(getState().notes);
          });

          els.notesList.appendChild(item);
        });
      }

      function renderProjectOptions() {
        if (!els.projectSelect) return;

        const state = getState();
        const folderNames = new Set([folderMeta.name]);

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
        const currentValue = String(els.projectSelect.value || folderMeta.name).trim();

        els.projectSelect.innerHTML = '<option value="">Folder</option>';
        options.forEach((name) => {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          els.projectSelect.append(option);
        });

        if (currentValue && options.includes(currentValue)) {
          els.projectSelect.value = currentValue;
        } else if (folderMeta.name && options.includes(folderMeta.name)) {
          els.projectSelect.value = folderMeta.name;
        } else {
          els.projectSelect.value = "";
        }
      }

      function renderView() {
        const notes = getState().notes;
        renderFolderItems(notes);
        renderRecent(notes);
        renderProjectOptions();
      }

      async function refreshNotes() {
        const query = (els.topbarSearchInput?.value || "").trim();

        try {
          const data = await apiClient.fetchNotes({
            query,
            project: folderMeta.name,
            limit: 120,
          });

          if (!isMounted) return;
          setState({ notes: data.items });
          renderView();
        } catch (error) {
          if (!isMounted) return;
          const message = conciseTechnicalError(error, "Notes endpoint unavailable");
          const fallback = filterAndRankMockNotes(getState().mockNotes, {
            query,
            project: folderMeta.name,
            limit: 120,
          });
          setState({ notes: fallback });
          renderView();
          apiClient.adapterLog("folder_notes_fallback", message);
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
        const content = rawContent || (attachment.name ? `File: ${attachment.name}` : "");
        const selectedProject = String(els.projectSelect?.value || folderMeta.name || "").trim();

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
          project: selectedProject || folderMeta.name,
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

            const fallback = filterAndRankMockNotes(nextMock, {
              query: (els.topbarSearchInput?.value || "").trim(),
              project: folderMeta.name,
              limit: 120,
            });
            setState({ notes: fallback });
            renderView();
            apiClient.adapterLog("folder_save_fallback", message);
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

      on(els.itemModalClose, "click", () => {
        closeModal(els);
      });

      on(els.itemModalBackdrop, "click", () => {
        closeModal(els);
      });

      on(document, "keydown", (event) => {
        if (event.key === "Escape") {
          closeModal(els);
        }
      });

      ensureDraftFolder(folderMeta.name);
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
        closeModal(els);
        disposers.forEach((dispose) => {
          dispose();
        });
      };
    },
  };
}
