import { renderComposer } from "../components/composer/composer.js";
import { renderFolderHeroToolbar } from "../components/folder-hero-toolbar/folder-hero-toolbar.js";
import { renderFolderItemGrid } from "../components/folder-item-grid/folder-item-grid.js";
import { renderTopbar } from "../components/topbar/topbar.js";
import { buildContentPreview, buildNoteTitle, normalizeCitation } from "../services/mappers.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderFolderPageShell(folderName) {
  return `
    <section class="page page-folder">
      ${renderTopbar({
        eyebrow: "Folder Workspace",
        breadcrumb: escapeHtml(folderName),
        title: "Project Memory",
        subtitle: "Scaffold route for folder-level composition and interactions.",
        showStatus: false,
      })}

      ${renderFolderHeroToolbar({ folderName: escapeHtml(folderName) })}
      ${renderFolderItemGrid()}
      ${renderComposer({ mode: "folder" })}

      <article class="card folder-shell-note">
        <p>
          This is the Phase 1 shell scaffold for folder view. Detailed visuals and interaction behavior are reserved for
          <code>codex/wt-ui-folder-hero-toolbar</code>, <code>codex/wt-ui-folder-item-grid</code>, and
          <code>codex/wt-ui-composer</code>.
        </p>
      </article>
    </section>
  `;
}

export function createFolderPage({ store }) {
  return {
    mount({ mountNode, route }) {
      const folderName = route.folderId || "general";
      mountNode.innerHTML = renderFolderPageShell(folderName);

      const grid = mountNode.querySelector("#folder-items-grid");
      if (grid) {
        const notes = store
          .getState()
          .notes.map((entry, index) => normalizeCitation(entry, index).note)
          .filter((note) => (note.project || "general").toLowerCase() === String(folderName).toLowerCase())
          .slice(0, 12);

        if (!notes.length) {
          const empty = document.createElement("p");
          empty.className = "note-content";
          empty.textContent = "No items loaded for this folder yet.";
          grid.appendChild(empty);
        } else {
          notes.forEach((note) => {
            const card = document.createElement("article");
            card.className = "folder-item-card";
            card.innerHTML = `
              <p class="mini-title">${escapeHtml(buildNoteTitle(note))}</p>
              <p class="mini-content">${escapeHtml(buildContentPreview(note))}</p>
            `;
            grid.appendChild(card);
          });
        }
      }

      return () => {};
    },
  };
}
