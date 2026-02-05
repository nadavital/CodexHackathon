import { createFolderPage } from "./pages/folder-page.js";
import { createHomePage } from "./pages/home-page.js";
import { createRouter } from "./router.js";
import { createApiClient } from "./services/api-client.js";
import { createStore } from "./state/store.js";

const mountNode = document.getElementById("app-root");

if (!mountNode) {
  throw new Error("Missing #app-root mount node");
}

const store = createStore();
const apiClient = createApiClient({ adapterDebug: false });

const pages = {
  home: createHomePage({ store, apiClient }),
  folder: createFolderPage({ store, apiClient }),
};

const router = createRouter({
  mountNode,
  pages,
});

router.start();
