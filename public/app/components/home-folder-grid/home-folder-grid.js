export function renderHomeFolderGrid() {
  return `
    <article class="card home-folder-grid-card" data-component="home-folder-grid">
      <div class="card-header">
        <div>
          <h2>Projects</h2>
          <p class="stream-subtitle">Folder surface scaffold. Cards route into folder view.</p>
        </div>
      </div>
      <div id="home-folders-list" class="home-folders-list"></div>
      <p id="home-folders-empty" class="note-content hidden">No projects yet. Save a memory to seed a folder.</p>
    </article>
  `;
}
