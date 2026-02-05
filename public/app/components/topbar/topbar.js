export function renderTopbar({
  eyebrow = "Hackathon Build",
  title = "Project Memory",
  subtitle = "AI-powered personal knowledge vault with MCP + OpenClaw-ready tools.",
  showStatus = true,
  breadcrumb = "",
} = {}) {
  const breadcrumbMarkup = breadcrumb
    ? `<p class="topbar-breadcrumb"><a href="#/">Home</a> / <span>${breadcrumb}</span></p>`
    : "";

  const statusMarkup = showStatus
    ? `
      <div class="status-wrap">
        <div class="status" id="status-pill">checking model status...</div>
        <div class="adapter-badge hidden" id="adapter-badge">Fallback Active</div>
        <p class="adapter-helper hidden" id="adapter-helper"></p>
      </div>
    `
    : `
      <div class="status-wrap">
        <a href="#/" class="btn subtle topbar-home-link">Back to Home</a>
      </div>
    `;

  return `
    <header class="hero topbar-shell" data-component="topbar">
      <div>
        <p class="eyebrow">${eyebrow}</p>
        ${breadcrumbMarkup}
        <h1>${title}</h1>
        <p class="subtitle">${subtitle}</p>
      </div>
      ${statusMarkup}
    </header>
  `;
}
