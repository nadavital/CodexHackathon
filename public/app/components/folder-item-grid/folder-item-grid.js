export function renderFolderItemGrid() {
  return `
    <article class="card folder-item-grid-card" data-component="folder-item-grid">
      <div class="card-header">
        <div>
          <h2>Folder Items</h2>
          <p class="stream-subtitle">Scaffold grid for folder-level cards.</p>
        </div>
      </div>
      <div id="folder-items-grid" class="folder-items-grid"></div>
    </article>
  `;
}
