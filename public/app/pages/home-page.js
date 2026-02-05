import { renderComposer } from "../components/composer/composer.js";
import { renderHomeFolderGrid } from "../components/home-folder-grid/home-folder-grid.js";
import { renderHomeRecentList } from "../components/home-recent-list/home-recent-list.js";
import { renderTopbar } from "../components/topbar/topbar.js";
import {
  buildContentPreview,
  buildLocalFallbackNote,
  buildMockChatAnswer,
  buildMockContext,
  buildNoteTitle,
  buildSummaryPreview,
  compactUrl,
  conciseTechnicalError,
  filterAndRankMockNotes,
  formatMeta,
  formatScore,
  formatSourceText,
  inferCaptureType,
  normalizeCitation,
  normalizeCitationLabel,
} from "../services/mappers.js";

function renderHomePageShell() {
  return `
    <section class="page page-home">
      ${renderTopbar()}

      <section class="home-grid">
        ${renderHomeFolderGrid()}
        ${renderHomeRecentList()}

        <article class="card chat-card">
          <h2>Grounded Chat</h2>
          <form id="chat-form">
            <label>
              Ask your memory
              <textarea id="question-input" rows="4" placeholder="What decisions did I make for launch onboarding?"></textarea>
            </label>
            <button class="btn" type="submit">Ask</button>
          </form>

          <div class="response-wrap">
            <p class="response-title">Answer</p>
            <div id="answer-output" class="answer-output">No question yet.</div>
            <p id="answer-meta" class="response-meta"></p>
          </div>

          <div class="response-wrap">
            <p class="response-title">Citations</p>
            <div id="citation-list" class="citation-list"></div>
          </div>

          <button id="context-btn" class="btn subtle" type="button">Generate Project Context Brief</button>
        </article>
      </section>

      ${renderComposer({ mode: "home" })}
    </section>

    <template id="note-template">
      <article class="note-item stream-mini-card" role="button" tabindex="0">
        <div class="mini-card-head">
          <p class="mini-title"></p>
          <span class="mini-score"></span>
        </div>
        <p class="mini-content"></p>
        <div class="mini-ai-block">
          <p class="mini-ai-label">AI Notes</p>
          <p class="mini-summary"></p>
        </div>
        <img class="mini-image hidden" alt="memory preview image" />
        <div class="note-tags"></div>
        <p class="mini-meta"></p>
      </article>
    </template>

    <div id="memory-modal" class="memory-modal hidden" aria-hidden="true">
      <div id="memory-modal-backdrop" class="memory-modal-backdrop"></div>
      <article class="memory-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="memory-modal-title">
        <button id="memory-modal-close" class="btn subtle modal-close-btn" type="button">Close</button>
        <p class="modal-kicker">Memory detail</p>
        <h3 id="memory-modal-title" class="modal-title"></h3>
        <p id="memory-modal-content" class="modal-content"></p>
        <section class="modal-section">
          <p class="modal-label">AI Notes</p>
          <p id="memory-modal-summary" class="modal-summary"></p>
        </section>
        <img id="memory-modal-image" class="modal-image hidden" alt="full memory image" />
        <a id="memory-modal-source" class="modal-link hidden" target="_blank" rel="noreferrer"></a>
        <div id="memory-modal-tags" class="note-tags"></div>
        <p id="memory-modal-meta" class="note-meta"></p>
      </article>
    </div>
  `;
}

function queryElements(mountNode) {
  return {
    statusPill: mountNode.querySelector("#status-pill"),
    adapterBadge: mountNode.querySelector("#adapter-badge"),
    adapterHelper: mountNode.querySelector("#adapter-helper"),
    captureForm: mountNode.querySelector("#capture-form"),
    contentInput: mountNode.querySelector("#content-input"),
    projectInput: mountNode.querySelector("#project-input"),
    captureHint: mountNode.querySelector("#capture-hint"),
    imageDropZone: mountNode.querySelector("#image-drop-zone"),
    imageInput: mountNode.querySelector("#image-input"),
    imagePickerBtn: mountNode.querySelector("#image-picker-btn"),
    composerFileLink: mountNode.querySelector("#composer-file-link"),
    removeImageBtn: mountNode.querySelector("#remove-image-btn"),
    imageName: mountNode.querySelector("#image-name"),
    imagePreview: mountNode.querySelector("#image-preview"),
    saveBtn: mountNode.querySelector("#save-btn"),
    notesList: mountNode.querySelector("#notes-list"),
    noteTemplate: mountNode.querySelector("#note-template"),
    streamControlsBtn: mountNode.querySelector("#stream-controls-btn"),
    streamControls: mountNode.querySelector("#stream-controls"),
    refreshBtn: mountNode.querySelector("#refresh-btn"),
    searchInput: mountNode.querySelector("#search-input"),
    projectFilterInput: mountNode.querySelector("#project-filter-input"),
    sortSelect: mountNode.querySelector("#sort-select"),
    typeFilterSelect: mountNode.querySelector("#type-filter-select"),
    searchBtn: mountNode.querySelector("#search-btn"),
    chatForm: mountNode.querySelector("#chat-form"),
    questionInput: mountNode.querySelector("#question-input"),
    answerOutput: mountNode.querySelector("#answer-output"),
    answerMeta: mountNode.querySelector("#answer-meta"),
    citationList: mountNode.querySelector("#citation-list"),
    contextBtn: mountNode.querySelector("#context-btn"),
    memoryModal: mountNode.querySelector("#memory-modal"),
    memoryModalBackdrop: mountNode.querySelector("#memory-modal-backdrop"),
    memoryModalClose: mountNode.querySelector("#memory-modal-close"),
    memoryModalTitle: mountNode.querySelector("#memory-modal-title"),
    memoryModalContent: mountNode.querySelector("#memory-modal-content"),
    memoryModalSummary: mountNode.querySelector("#memory-modal-summary"),
    memoryModalImage: mountNode.querySelector("#memory-modal-image"),
    memoryModalSource: mountNode.querySelector("#memory-modal-source"),
    memoryModalTags: mountNode.querySelector("#memory-modal-tags"),
    memoryModalMeta: mountNode.querySelector("#memory-modal-meta"),
    foldersList: mountNode.querySelector("#home-folders-list"),
    foldersEmpty: mountNode.querySelector("#home-folders-empty"),
    toast: document.getElementById("toast"),
  };
}

function noteForItem(item) {
  const citation = normalizeCitation(item, 0);
  return citation.note;
}

function renderTags(container, tags = []) {
  if (!container) return;
  container.innerHTML = "";
  (tags || []).forEach((tag) => {
    const tagEl = document.createElement("span");
    tagEl.className = "tag";
    tagEl.textContent = tag;
    container.appendChild(tagEl);
  });
}

export function createHomePage({ store, apiClient }) {
  return {
    async mount({ mountNode, navigate }) {
      mountNode.innerHTML = renderHomePageShell();
      const els = queryElements(mountNode);
      const disposers = [];
      let isMounted = true;

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

      function setStatus(text, tone = "neutral") {
        if (!els.statusPill) return;
        els.statusPill.textContent = text;
        if (tone === "warn") {
          els.statusPill.style.color = "#8d3d1f";
          els.statusPill.style.borderColor = "rgba(189, 91, 45, 0.35)";
        } else {
          els.statusPill.style.color = "";
          els.statusPill.style.borderColor = "";
        }
      }

      function setAdapterFallback(active, helperText = "") {
        setState({ fallbackActive: active });
        els.adapterBadge?.classList.toggle("hidden", !active);
        els.adapterHelper?.classList.toggle("hidden", !active);
        if (els.adapterHelper) {
          els.adapterHelper.textContent = active ? helperText : "";
        }
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

      function renderAnswer(text, citations = [], usedCitationLabels = []) {
        if (!els.answerOutput) return;
        const normalized = String(text || "").trim() || "No answer.";
        const knownLabels = new Set(citations.map((entry, index) => normalizeCitation(entry, index).label));
        const usedLabels = new Set(usedCitationLabels.map((label) => normalizeCitationLabel(label)).filter(Boolean));

        els.answerOutput.innerHTML = "";
        const tokenPattern = /\[(N?\d+)\]/gi;
        const fragment = document.createDocumentFragment();
        let cursor = 0;

        for (const match of normalized.matchAll(tokenPattern)) {
          const index = match.index ?? 0;
          if (index > cursor) {
            fragment.append(document.createTextNode(normalized.slice(cursor, index)));
          }

          const raw = String(match[1] || "").toUpperCase();
          const label = raw.startsWith("N") ? normalizeCitationLabel(raw) : normalizeCitationLabel(`N${raw}`);

          if (label && knownLabels.has(label)) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "citation-chip";
            if (usedLabels.has(label)) {
              chip.classList.add("is-active");
            }
            chip.textContent = `[${label}]`;
            chip.addEventListener("click", () => {
              focusCitationCard(label);
            });
            fragment.append(chip);
          } else {
            fragment.append(document.createTextNode(match[0]));
          }

          cursor = index + match[0].length;
        }

        if (cursor < normalized.length) {
          fragment.append(document.createTextNode(normalized.slice(cursor)));
        }

        els.answerOutput.append(fragment);
      }

      function renderAnswerMeta({ mode = "", citations = [], usedCitationLabels = [] } = {}) {
        if (!els.answerMeta) return;
        if (!mode) {
          els.answerMeta.textContent = "";
          return;
        }

        const usedCount = usedCitationLabels.length || citations.length;
        const citationCount = citations.length;
        const usedLabel = usedCount === 1 ? "source" : "sources";
        const citationLabel = citationCount === 1 ? "card" : "cards";
        els.answerMeta.textContent = `${mode} mode • ${usedCount} referenced ${usedLabel} • ${citationCount} citation ${citationLabel}`;
      }

      function focusCitationCard(label) {
        if (!els.citationList) return;
        const target = els.citationList.querySelector(`.citation-item[data-label="${label}"]`);
        if (!target) return;

        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.remove("flash-highlight");
        void target.offsetWidth;
        target.classList.add("flash-highlight");
      }

      function renderCitations(citations = [], usedCitationLabels = []) {
        if (!els.citationList) return;
        els.citationList.innerHTML = "";

        if (!citations.length) {
          const empty = document.createElement("p");
          empty.className = "note-content";
          empty.textContent = "No citations.";
          els.citationList.appendChild(empty);
          return;
        }

        const usedLabels = new Set(usedCitationLabels.map((label) => normalizeCitationLabel(label)).filter(Boolean));

        citations.forEach((entry, index) => {
          const citation = normalizeCitation(entry, index);
          const note = citation.note;

          const card = document.createElement("article");
          card.className = "citation-item";
          card.dataset.label = citation.label;
          if (usedLabels.has(citation.label)) {
            card.classList.add("is-referenced");
          }

          const top = document.createElement("div");
          top.className = "note-top";

          const project = document.createElement("span");
          project.className = "note-project";
          project.textContent = `${citation.label} • ${note.project || "general"}`;

          const score = document.createElement("span");
          score.className = "note-score";
          score.textContent = formatScore(citation.score);

          top.append(project, score);
          card.append(top);

          if (note.summary) {
            const summary = document.createElement("p");
            summary.className = "note-summary";
            summary.textContent = note.summary;
            card.append(summary);
          }

          if (note.content) {
            const content = document.createElement("p");
            content.className = "note-content";
            content.textContent = note.content;
            card.append(content);
          }

          const meta = [];
          if (note.sourceType) meta.push(note.sourceType);
          if (note.createdAt) {
            const created = new Date(note.createdAt);
            if (!Number.isNaN(created.getTime())) {
              meta.push(created.toLocaleString());
            }
          }

          if (meta.length) {
            const metaEl = document.createElement("p");
            metaEl.className = "note-meta";
            metaEl.textContent = meta.join(" • ");
            card.append(metaEl);
          }

          if (note.sourceUrl) {
            const sourceLink = document.createElement("a");
            sourceLink.href = note.sourceUrl;
            sourceLink.target = "_blank";
            sourceLink.rel = "noreferrer noopener";
            sourceLink.className = "note-meta";
            sourceLink.textContent = compactUrl(note.sourceUrl, 52);
            card.append(sourceLink);
          }

          if (note.imagePath) {
            const img = document.createElement("img");
            img.src = note.imagePath;
            img.alt = "citation image";
            img.className = "image-preview";
            card.append(img);
          }

          els.citationList.appendChild(card);
        });
      }

      function renderFolders() {
        if (!els.foldersList || !els.foldersEmpty) return;
        const state = getState();
        const projectCounts = new Map();

        state.notes.forEach((entry, index) => {
          const note = normalizeCitation(entry, index).note;
          const project = note.project || "general";
          projectCounts.set(project, (projectCounts.get(project) || 0) + 1);
        });

        els.foldersList.innerHTML = "";
        if (!projectCounts.size) {
          els.foldersEmpty.classList.remove("hidden");
          return;
        }

        els.foldersEmpty.classList.add("hidden");

        [...projectCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .forEach(([projectName, count]) => {
            const card = document.createElement("a");
            card.className = "folder-pill";
            card.href = `#/folder/${encodeURIComponent(projectName)}`;
            card.innerHTML = `<span class="folder-pill-name">${projectName}</span><span class="folder-pill-count">${count}</span>`;
            card.addEventListener("click", (event) => {
              event.preventDefault();
              navigate(`#/folder/${encodeURIComponent(projectName)}`);
            });
            els.foldersList.appendChild(card);
          });
      }

      function setStreamControlsOpen(isOpen) {
        setState({ streamControlsOpen: Boolean(isOpen) });
        if (!els.streamControls || !els.streamControlsBtn) return;
        els.streamControls.classList.toggle("hidden", !isOpen);
        els.streamControlsBtn.textContent = isOpen ? "Hide Controls" : "Filters & Sort";
      }

      function sortAndFilterItems(items) {
        const filtered = [...(Array.isArray(items) ? items : [])].filter((item) => {
          const note = noteForItem(item);
          const requiredType = els.typeFilterSelect?.value || "";
          return !requiredType || note.sourceType === requiredType;
        });

        const getTime = (item) => {
          const note = noteForItem(item);
          const time = note.createdAt ? new Date(note.createdAt).getTime() : 0;
          return Number.isFinite(time) ? time : 0;
        };

        switch (els.sortSelect?.value) {
          case "oldest":
            filtered.sort((a, b) => getTime(a) - getTime(b));
            break;
          case "score":
            filtered.sort((a, b) => {
              const scoreDelta = (normalizeCitation(b, 0).score || 0) - (normalizeCitation(a, 0).score || 0);
              if (scoreDelta !== 0) return scoreDelta;
              return getTime(b) - getTime(a);
            });
            break;
          case "newest":
          default:
            filtered.sort((a, b) => getTime(b) - getTime(a));
            break;
        }

        return filtered;
      }

      function renderNotes(items) {
        if (!els.notesList || !els.noteTemplate) return;
        els.notesList.innerHTML = "";
        setState({ renderedItems: items });

        if (!Array.isArray(items) || items.length === 0) {
          const empty = document.createElement("p");
          empty.className = "note-content";
          empty.textContent = getState().notes.length ? "No memories match these filters." : "No memories yet.";
          els.notesList.appendChild(empty);
          return;
        }

        const showScores = (els.sortSelect?.value || "") === "score" || Boolean((els.searchInput?.value || "").trim());

        items.forEach((entry, index) => {
          const citation = normalizeCitation(entry, index);
          const note = citation.note;
          const fragment = els.noteTemplate.content.cloneNode(true);
          const card = fragment.querySelector(".stream-mini-card");
          card.dataset.noteIndex = String(index);

          fragment.querySelector(".mini-title").textContent = buildNoteTitle(note);
          fragment.querySelector(".mini-content").textContent = buildContentPreview(note);
          fragment.querySelector(".mini-summary").textContent = buildSummaryPreview(note);

          const scoreEl = fragment.querySelector(".mini-score");
          const scoreLabel = showScores ? formatScore(citation.score) : "";
          scoreEl.textContent = scoreLabel;
          scoreEl.classList.toggle("hidden", !scoreLabel);

          renderTags(fragment.querySelector(".note-tags"), note.tags || []);
          fragment.querySelector(".mini-meta").textContent = formatMeta(note);

          const image = fragment.querySelector(".mini-image");
          if (note.imagePath) {
            image.src = note.imagePath;
            image.classList.remove("hidden");
          } else {
            image.classList.add("hidden");
          }

          els.notesList.appendChild(fragment);
        });
      }

      function renderStream() {
        renderNotes(sortAndFilterItems(getState().notes));
        renderFolders();
      }

      function openMemoryModal(item) {
        if (!item || !els.memoryModal) return;
        setState({ activeModalItem: item });
        const citation = normalizeCitation(item, 0);
        const note = citation.note;

        els.memoryModalTitle.textContent = buildNoteTitle(note);
        els.memoryModalContent.textContent = note.content || "No raw content saved for this memory.";
        els.memoryModalSummary.textContent = buildSummaryPreview(note, 520);
        renderTags(els.memoryModalTags, note.tags || []);
        els.memoryModalMeta.textContent = formatMeta(note, true);

        if (note.imagePath) {
          els.memoryModalImage.src = note.imagePath;
          els.memoryModalImage.classList.remove("hidden");
        } else {
          els.memoryModalImage.classList.add("hidden");
        }

        if (note.sourceUrl) {
          els.memoryModalSource.href = note.sourceUrl;
          els.memoryModalSource.textContent = `Source: ${formatSourceText(note.sourceUrl)}`;
          els.memoryModalSource.classList.remove("hidden");
        } else {
          els.memoryModalSource.classList.add("hidden");
        }

        els.memoryModal.classList.remove("hidden");
        els.memoryModal.setAttribute("aria-hidden", "false");
        document.body.classList.add("modal-open");
        els.memoryModalClose.focus();
      }

      function closeMemoryModal() {
        if (!els.memoryModal || els.memoryModal.classList.contains("hidden")) return;
        setState({ activeModalItem: null });
        els.memoryModal.classList.add("hidden");
        els.memoryModal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("modal-open");
      }

      function openNoteFromCardTarget(target) {
        if (!(target instanceof Element)) return;
        const card = target.closest(".stream-mini-card");
        if (!card) return;
        const index = Number(card.dataset.noteIndex);
        if (!Number.isFinite(index)) return;
        openMemoryModal(getState().renderedItems[index]);
      }

      async function initStatus() {
        try {
          const health = await apiClient.health();
          if (!isMounted) return;

          if (health.openaiConfigured === true) {
            setStatus("OpenAI connected");
          } else if (health.openaiConfigured === false) {
            setStatus("OpenAI key missing • heuristic mode", "warn");
          } else {
            setStatus("Server connected • model status unknown", "warn");
          }
        } catch {
          if (!isMounted) return;
          setStatus("Server status unavailable", "warn");
        }
      }

      async function refreshNotes() {
        const query = (els.searchInput?.value || "").trim();
        const project = (els.projectFilterInput?.value || "").trim();

        try {
          const data = await apiClient.fetchNotes({ query, project, limit: 80 });
          if (!isMounted) return;
          setState({ notes: data.items });
          renderStream();
          setAdapterFallback(false);
        } catch (error) {
          if (!isMounted) return;
          const message = conciseTechnicalError(error, "Notes endpoint unavailable");
          setAdapterFallback(true, `${message}. Showing local demo data.`);
          const fallback = filterAndRankMockNotes(getState().mockNotes, { query, project, limit: 80 });
          setState({ notes: fallback });
          renderStream();
          apiClient.adapterLog("notes_fallback", message);
        }
      }

      async function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      function clearImageSelection() {
        setState({ imageDataUrl: null, imageName: "" });
        if (els.imageInput) els.imageInput.value = "";
        if (els.imageName) {
          els.imageName.textContent = "";
          els.imageName.classList.add("hidden");
        }
        if (els.imagePreview) {
          els.imagePreview.src = "";
          els.imagePreview.classList.add("hidden");
        }
        els.removeImageBtn?.classList.add("hidden");
      }

      function clearCaptureForm() {
        if (els.contentInput) els.contentInput.value = "";
        clearImageSelection();
      }

      async function setImageFromFile(file) {
        if (!file) return;
        if (!String(file.type || "").startsWith("image/")) {
          setCaptureHint("That file is not an image yet. Try PNG, JPG, WEBP, or GIF.", "warn");
          return;
        }

        const imageDataUrl = await fileToDataUrl(file);
        setState({
          imageDataUrl,
          imageName: file.name || "image",
        });

        if (els.imagePreview) {
          els.imagePreview.src = imageDataUrl;
          els.imagePreview.classList.remove("hidden");
        }
        if (els.imageName) {
          els.imageName.textContent = file.name || "image";
          els.imageName.classList.remove("hidden");
        }
        els.removeImageBtn?.classList.remove("hidden");
        setCaptureHint("Image attached. Add optional text, then save.");
      }

      on(els.imagePickerBtn, "click", () => {
        els.imageInput?.click();
      });

      on(els.composerFileLink, "click", () => {
        els.imageInput?.click();
      });

      on(els.removeImageBtn, "click", () => {
        clearImageSelection();
        setCaptureHint("Image removed. Paste text, a URL, or drop another image.");
      });

      on(els.imageInput, "change", async () => {
        const file = els.imageInput?.files?.[0];
        if (!file) return;
        try {
          await setImageFromFile(file);
        } catch (error) {
          setCaptureHint(conciseTechnicalError(error, "Image read failed"), "warn");
          showToast("Image read failed", "error");
        }
      });

      ["dragenter", "dragover"].forEach((eventName) => {
        on(els.imageDropZone, eventName, (event) => {
          event.preventDefault();
          event.stopPropagation();
          els.imageDropZone?.classList.add("is-dragging");
        });
      });

      ["dragleave", "dragend", "drop"].forEach((eventName) => {
        on(els.imageDropZone, eventName, (event) => {
          event.preventDefault();
          event.stopPropagation();
          els.imageDropZone?.classList.remove("is-dragging");
        });
      });

      on(els.imageDropZone, "drop", async (event) => {
        const file = event.dataTransfer?.files?.[0];
        if (!file) return;
        try {
          await setImageFromFile(file);
        } catch (error) {
          setCaptureHint(conciseTechnicalError(error, "Image read failed"), "warn");
          showToast("Image read failed", "error");
        }
      });

      on(els.imageDropZone, "click", (event) => {
        if (event.target.closest("button")) return;
        els.imageInput?.click();
      });

      on(els.imageDropZone, "keydown", (event) => {
        if (event.target !== els.imageDropZone) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        els.imageInput?.click();
      });

      on(els.captureForm, "submit", async (event) => {
        event.preventDefault();
        if (getState().loading) return;

        const content = (els.contentInput?.value || "").trim();
        const project = (els.projectInput?.value || "").trim();
        if (!content && !getState().imageDataUrl) {
          setCaptureHint("Add a note, paste a link, or drop an image first.", "warn");
          showToast("Add a note, link, or image first");
          els.contentInput?.focus();
          return;
        }

        const inferred = inferCaptureType(content, getState().imageDataUrl);
        const payload = {
          sourceType: inferred.sourceType,
          content,
          sourceUrl: inferred.sourceUrl,
          project,
          imageDataUrl: getState().imageDataUrl,
        };

        setState({ loading: true });
        if (els.saveBtn) {
          els.saveBtn.disabled = true;
          els.saveBtn.textContent = "Saving...";
        }

        try {
          await apiClient.saveNote(payload);
          if (!isMounted) return;

          clearCaptureForm();
          setCaptureHint("Saved. Add another memory whenever you are ready.");
          showToast("Memory saved");
          await refreshNotes();
        } catch (error) {
          if (!isMounted) return;

          const message = conciseTechnicalError(error, "Save endpoint unavailable");
          const validationLike = /missing content|invalid image|invalid json|request failed \(4\d\d\)/i.test(message);

          if (validationLike) {
            setCaptureHint(message, "warn");
            showToast("Save failed", "error");
          } else {
            const nextMock = [buildLocalFallbackNote(payload), ...getState().mockNotes];
            setState({ mockNotes: nextMock });
            clearCaptureForm();
            setCaptureHint("Saved locally. Backend write is unavailable right now.", "warn");
            showToast("Saved locally");
            setAdapterFallback(true, `${message}. Saved locally for demo.`);

            const fallback = filterAndRankMockNotes(nextMock, {
              query: (els.searchInput?.value || "").trim(),
              project: (els.projectFilterInput?.value || "").trim(),
              limit: 80,
            });
            setState({ notes: fallback });
            renderStream();
            apiClient.adapterLog("save_fallback", message);
          }
        } finally {
          if (!isMounted) return;
          setState({ loading: false });
          if (els.saveBtn) {
            els.saveBtn.disabled = false;
            els.saveBtn.textContent = "Save Memory";
          }
        }
      });

      on(els.streamControlsBtn, "click", () => {
        setStreamControlsOpen(!getState().streamControlsOpen);
      });

      on(els.refreshBtn, "click", async () => {
        await refreshNotes();
      });

      on(els.searchBtn, "click", async () => {
        await refreshNotes();
      });

      on(els.sortSelect, "change", () => {
        renderStream();
      });

      on(els.typeFilterSelect, "change", () => {
        renderStream();
      });

      on(els.searchInput, "keydown", async (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        await refreshNotes();
      });

      on(els.projectFilterInput, "keydown", async (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        await refreshNotes();
      });

      on(els.notesList, "click", (event) => {
        openNoteFromCardTarget(event.target);
      });

      on(els.notesList, "keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openNoteFromCardTarget(event.target);
      });

      on(els.memoryModalClose, "click", () => {
        closeMemoryModal();
      });

      on(els.memoryModalBackdrop, "click", () => {
        closeMemoryModal();
      });

      on(document, "keydown", (event) => {
        if (event.key === "Escape") {
          closeMemoryModal();
        }
      });

      on(els.chatForm, "submit", async (event) => {
        event.preventDefault();
        const question = (els.questionInput?.value || "").trim();
        if (!question) return;

        renderAnswer("Thinking...");
        renderAnswerMeta({ mode: "loading", citations: [], usedCitationLabels: [] });

        try {
          const data = await apiClient.ask({
            question,
            project: (els.projectFilterInput?.value || "").trim(),
          });
          if (!isMounted) return;

          renderCitations(data.citations, data.usedCitationLabels);
          renderAnswer(data.text || "No answer", data.citations, data.usedCitationLabels);
          renderAnswerMeta({ mode: data.mode || "unknown", citations: data.citations, usedCitationLabels: data.usedCitationLabels });
        } catch (error) {
          if (!isMounted) return;

          const message = conciseTechnicalError(error, "Chat endpoint unavailable");
          const fallback = buildMockChatAnswer(getState().mockNotes, question, (els.projectFilterInput?.value || "").trim());
          renderCitations(fallback.citations, fallback.usedCitationLabels);
          renderAnswer(`${fallback.text}\n\n(${message})`, fallback.citations, fallback.usedCitationLabels);
          renderAnswerMeta({ mode: "fallback", citations: fallback.citations, usedCitationLabels: fallback.usedCitationLabels });
          setAdapterFallback(true, `${message}. Using local answer fallback.`);
          apiClient.adapterLog("chat_fallback", message);
        }
      });

      on(els.contextBtn, "click", async () => {
        const task = window.prompt("Task for context brief", "Summarize current project decisions and next steps");
        if (!task) return;

        renderAnswer("Generating context brief...");
        renderAnswerMeta({ mode: "loading", citations: [], usedCitationLabels: [] });

        try {
          const data = await apiClient.context({
            task,
            project: (els.projectFilterInput?.value || "").trim(),
          });
          if (!isMounted) return;

          renderCitations(data.citations, data.usedCitationLabels);
          renderAnswer(data.text || "No context generated", data.citations, data.usedCitationLabels);
          renderAnswerMeta({ mode: data.mode || "unknown", citations: data.citations, usedCitationLabels: data.usedCitationLabels });
        } catch (error) {
          if (!isMounted) return;

          const message = conciseTechnicalError(error, "Context endpoint unavailable");
          const fallback = buildMockContext(getState().mockNotes, task, (els.projectFilterInput?.value || "").trim());
          renderCitations(fallback.citations, fallback.usedCitationLabels);
          renderAnswer(`${fallback.text}\n\n(${message})`, fallback.citations, fallback.usedCitationLabels);
          renderAnswerMeta({ mode: "fallback", citations: fallback.citations, usedCitationLabels: fallback.usedCitationLabels });
          setAdapterFallback(true, `${message}. Using local context fallback.`);
          apiClient.adapterLog("context_fallback", message);
        }
      });

      setStreamControlsOpen(false);
      setCaptureHint("Tip: keep it minimal. Paste text, a URL, or an image and we infer the rest.");
      clearImageSelection();
      renderAnswer("No question yet.");
      renderAnswerMeta({ mode: "", citations: [], usedCitationLabels: [] });
      await initStatus();
      await refreshNotes();

      return () => {
        isMounted = false;
        const state = getState();
        if (state.toastTimer) {
          clearTimeout(state.toastTimer);
          setState({ toastTimer: null });
        }
        closeMemoryModal();
        disposers.forEach((dispose) => {
          dispose();
        });
      };
    },
  };
}
