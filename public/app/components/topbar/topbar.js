function slugFromSegment(segment) {
  return encodeURIComponent(
    String(segment || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-"),
  );
}

function normalizeBrandTitle(title) {
  const rawTitle = String(title || "").trim();
  if (!rawTitle || rawTitle.toLowerCase() === "project memory") {
    return "Stash";
  }
  return rawTitle;
}

function buildBreadcrumbMarkup(breadcrumb, brandTitle) {
  const segments = String(breadcrumb || "")
    .split("/")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!segments.length) return "";

  const crumbs = segments
    .map((segment, index) => {
      const href = `#/folder/${slugFromSegment(segment)}`;
      const activeClass = index === segments.length - 1 ? " is-active" : "";
      return `
        <span class="topbar-breadcrumb-separator" aria-hidden="true">&rsaquo;</span>
        <a href="${href}" class="topbar-breadcrumb-link${activeClass}" data-segment="${index}">
          ${segment}
        </a>
      `;
    })
    .join("");

  return `
    <nav class="topbar-breadcrumb" aria-label="Folder path">
      <a href="#/" class="topbar-breadcrumb-link topbar-breadcrumb-root">${brandTitle}</a>
      ${crumbs}
    </nav>
  `;
}

function buildSearchPlaceholder(breadcrumb) {
  const segments = String(breadcrumb || "")
    .split("/")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!segments.length) return "Search files...";
  return `Search ${segments[segments.length - 1].toLowerCase()}...`;
}

export function renderTopbar({
  title = "Stash",
  showStatus = true,
  breadcrumb = "",
} = {}) {
  const brandTitle = normalizeBrandTitle(title);
  const breadcrumbMarkup = buildBreadcrumbMarkup(breadcrumb, brandTitle);
  const searchPlaceholder = buildSearchPlaceholder(breadcrumb);
  const statusMarkup = showStatus
    ? `
      <div class="status-wrap">
        <div class="status" id="status-pill">checking model status...</div>
        <div class="adapter-badge hidden" id="adapter-badge">Fallback Active</div>
        <p class="adapter-helper hidden" id="adapter-helper"></p>
      </div>
    `
    : "";

  return `
    <header class="topbar-shell" data-component="topbar">
      <div class="topbar-row">
        <div class="topbar-identity">
          <a href="#/" class="topbar-brand-link" aria-label="Go to home">
            <svg class="topbar-logo" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3.2c2.5-1.7 6.2-1.2 8 1.3 1.6 2.3 1.4 5.6-.3 7.7 1.8 2.2 1.9 5.4.3 7.7-1.8 2.5-5.5 3-8 1.3-2.5 1.7-6.2 1.2-8-1.3-1.6-2.3-1.4-5.5.3-7.7-1.8-2.2-1.9-5.4-.3-7.7 1.8-2.5 5.5-3 8-1.3Zm0 2.1c-1.3 1.1-3.2 1.2-4.6.3C5.8 4.8 3.6 5.2 2.5 6.9c-1.1 1.6-.8 3.8.7 5.1 1.3 1.2 1.8 3 .9 4.5-1 1.8-.5 4 1.1 5.2 1.6 1.1 3.8.8 5.1-.7 1.2-1.3 3-1.8 4.5-.9 1.8 1 4 .5 5.2-1.1 1.1-1.6.8-3.8-.7-5.1-1.3-1.2-1.8-3-.9-4.5 1-1.8.5-4-1.1-5.2-1.6-1.1-3.8-.8-5.1.7-1.2 1.3-3 1.8-4.5.9Z" />
            </svg>
            <span class="topbar-brand-text">${brandTitle}</span>
          </a>
          ${breadcrumbMarkup}
        </div>

        <div class="topbar-controls">
          <label class="topbar-search" for="topbar-search-input">
            <span class="topbar-visually-hidden">Search memory</span>
            <svg class="topbar-search-icon" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M8.4 2.4a6 6 0 1 1 0 12 6 6 0 0 1 0-12Zm0 1.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8Zm5.1 9.2 3.3 3.3a.8.8 0 0 1-1.1 1.1l-3.3-3.3a.8.8 0 0 1 1.1-1.1Z" />
            </svg>
            <input id="topbar-search-input" class="topbar-search-input" type="search" placeholder="${searchPlaceholder}" />
          </label>

          <button class="topbar-settings-btn" type="button" aria-label="Open settings">
            <svg class="topbar-settings-icon" viewBox="0 0 20 20" aria-hidden="true">
              <path d="m8.6 2.2.4 1.6c.3 0 .7-.1 1-.1.3 0 .7 0 1 .1l.4-1.6a1 1 0 0 1 1.2-.7l1.7.5a1 1 0 0 1 .7 1.2l-.4 1.6c.5.3 1 .6 1.4 1l1.5-.9a1 1 0 0 1 1.3.3l.9 1.5a1 1 0 0 1-.3 1.3l-1.5.9c.1.5.2 1 .2 1.5s-.1 1-.2 1.5l1.5.9a1 1 0 0 1 .3 1.3l-.9 1.5a1 1 0 0 1-1.3.3l-1.5-.9c-.4.4-.9.7-1.4 1l.4 1.6a1 1 0 0 1-.7 1.2l-1.7.5a1 1 0 0 1-1.2-.7l-.4-1.6c-.3 0-.7.1-1 .1-.3 0-.7 0-1-.1l-.4 1.6a1 1 0 0 1-1.2.7l-1.7-.5a1 1 0 0 1-.7-1.2l.4-1.6a6.5 6.5 0 0 1-1.4-1l-1.5.9a1 1 0 0 1-1.3-.3l-.9-1.5a1 1 0 0 1 .3-1.3l1.5-.9A6.3 6.3 0 0 1 2 10c0-.5.1-1 .2-1.5l-1.5-.9A1 1 0 0 1 .4 6.3l.9-1.5a1 1 0 0 1 1.3-.3l1.5.9c.4-.4.9-.7 1.4-1L5 2.8a1 1 0 0 1 .7-1.2l1.7-.5a1 1 0 0 1 1.2.7ZM10 6.7A3.3 3.3 0 1 0 10 13a3.3 3.3 0 0 0 0-6.6Z" />
            </svg>
          </button>
        </div>
      </div>
      ${statusMarkup}
    </header>
  `;
}
