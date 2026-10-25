// @ts-expect-error — polyfill for WKWebView < 17.4
if (!Promise.withResolvers) Promise.withResolvers = function () {
  let resolve: any, reject: any;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { useNotesStore } from "./store/useNotesStore";
import { useUiStore } from "./store/useUiStore";
import { useAiStore } from "./store/aiStore";
import * as imageStore from "./store/imageStore";

declare global {
  interface Window {
    __inkwell?: {
      notesStore: typeof useNotesStore;
      uiStore: typeof useUiStore;
      aiStore: typeof useAiStore;
      imageStore: typeof imageStore;
    };
  }
}

if (import.meta.env.DEV) {
  window.__inkwell = {
    notesStore: useNotesStore,
    uiStore: useUiStore,
    aiStore: useAiStore,
    imageStore,
  };
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
