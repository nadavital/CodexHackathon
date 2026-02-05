import { createMockSeedNotes } from "../services/mappers.js";

const DEFAULT_STATE = {
  imageDataUrl: null,
  imageName: "",
  notes: [],
  renderedItems: [],
  loading: false,
  fallbackActive: false,
  mockNotes: createMockSeedNotes(),
  streamControlsOpen: false,
  activeModalItem: null,
  toastTimer: null,
};

export function createStore() {
  let state = { ...DEFAULT_STATE };
  const listeners = new Set();

  function notify() {
    listeners.forEach((listener) => {
      listener(state);
    });
  }

  return {
    getState() {
      return state;
    },
    setState(patch) {
      state = {
        ...state,
        ...(typeof patch === "function" ? patch(state) : patch),
      };
      notify();
      return state;
    },
    reset() {
      state = { ...DEFAULT_STATE, mockNotes: createMockSeedNotes() };
      notify();
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
