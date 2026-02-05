export function renderFolderHeroToolbar({ folderName = "Project Folder" } = {}) {
  return `
    <article class="card folder-hero-toolbar-card" data-component="folder-hero-toolbar">
      <div class="folder-hero-row">
        <div>
          <p class="eyebrow">Folder View</p>
          <h2>${folderName}</h2>
          <p class="stream-subtitle">Scaffold for heading, tabs, and create actions.</p>
        </div>
        <button class="btn" type="button" disabled>New</button>
      </div>
      <div class="folder-tab-row">
        <button class="btn subtle" type="button" disabled>All</button>
        <button class="btn subtle" type="button" disabled>Images</button>
        <button class="btn subtle" type="button" disabled>Videos</button>
        <button class="btn subtle" type="button" disabled>Favorites</button>
      </div>
    </article>
  `;
}
