function parseRouteFromHash(hash) {
  const normalized = String(hash || "")
    .replace(/^#/, "")
    .trim();

  if (!normalized || normalized === "/") {
    return { name: "home" };
  }

  const parts = normalized
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));

  if (parts[0] === "folder") {
    return {
      name: "folder",
      folderId: parts[1] || "general",
    };
  }

  return { name: "home" };
}

export function createRouter({ mountNode, pages }) {
  let activeCleanup = null;

  function navigate(nextHash) {
    const hash = String(nextHash || "#/home");
    if (window.location.hash === hash) {
      render();
      return;
    }
    window.location.hash = hash;
  }

  function render() {
    const route = parseRouteFromHash(window.location.hash);
    const page = pages[route.name] || pages.home;

    if (typeof activeCleanup === "function") {
      activeCleanup();
      activeCleanup = null;
    }

    const maybeCleanup = page.mount({
      mountNode,
      route,
      navigate,
    });

    if (typeof maybeCleanup === "function") {
      activeCleanup = maybeCleanup;
      return;
    }

    if (maybeCleanup && typeof maybeCleanup.then === "function") {
      maybeCleanup.then((cleanup) => {
        if (typeof cleanup === "function") {
          activeCleanup = cleanup;
        }
      });
    }
  }

  function start() {
    if (!window.location.hash) {
      window.location.hash = "#/";
    }
    window.addEventListener("hashchange", render);
    render();
  }

  return {
    start,
    navigate,
  };
}
