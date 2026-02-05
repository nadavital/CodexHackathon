export function renderHomeRecentList() {
  return `
    <article class="card stream-card" data-component="home-recent-list">
      <div class="card-header">
        <div>
          <h2>Recent Files</h2>
          <p class="stream-subtitle">Current memory stream with basic filter and sort plumbing.</p>
        </div>
        <div class="stream-actions">
          <button id="stream-controls-btn" class="btn subtle" type="button">Filters &amp; Sort</button>
          <button id="refresh-btn" class="btn subtle" type="button">Refresh</button>
        </div>
      </div>

      <div id="stream-controls" class="stream-controls hidden">
        <div class="row stream-fields">
          <input id="search-input" placeholder="Search memory..." />
          <input id="project-filter-input" placeholder="Project filter (optional)" />
        </div>
        <div class="row stream-selectors">
          <label class="compact-field">
            Sort
            <select id="sort-select">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="score">Best match</option>
            </select>
          </label>
          <label class="compact-field">
            Type
            <select id="type-filter-select">
              <option value="">All types</option>
              <option value="text">Text</option>
              <option value="link">Link</option>
              <option value="image">Image</option>
            </select>
          </label>
          <button id="search-btn" class="btn subtle" type="button">Apply</button>
        </div>
      </div>

      <div id="notes-list" class="notes-list"></div>
    </article>
  `;
}
