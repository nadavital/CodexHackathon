export function renderComposer({ mode = "home" } = {}) {
  const placeholder = mode === "folder" ? "Add memory to this folder..." : "Paste a thought, URL, or update...";

  return `
    <article class="card composer-shell" data-component="composer">
      <form id="capture-form" class="composer-form">
        <div class="composer-row">
          <button id="image-picker-btn" class="btn subtle composer-plus" type="button" aria-label="Attach image">+</button>
          <input id="project-input" name="project" placeholder="project (optional)" />
          <input id="content-input" name="content" placeholder="${placeholder}" />
          <button class="btn" id="save-btn" type="submit">Save Memory</button>
        </div>

        <div id="image-drop-zone" class="image-drop-zone" role="button" tabindex="0" aria-label="Image upload zone">
          <input id="image-input" type="file" accept="image/*" class="visually-hidden" />
          <p class="image-drop-copy">
            Drag and drop an image, or
            <button id="composer-file-link" class="inline-btn" type="button">choose a file</button>
          </p>
          <p id="image-name" class="image-name hidden"></p>
          <img id="image-preview" alt="image preview" class="image-preview hidden" />
          <button id="remove-image-btn" class="btn subtle small hidden" type="button">Remove image</button>
        </div>

        <p id="capture-hint" class="capture-hint">Tip: keep it minimal. Paste text, a URL, or an image and we infer the rest.</p>
      </form>
    </article>
  `;
}
