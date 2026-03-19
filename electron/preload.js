"use strict";

const { contextBridge, ipcRenderer } = require("electron");

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

contextBridge.exposeInMainWorld("kurukshetraSettings", {
  loadSignalNames: () => ipcRenderer.invoke("signal-names:load"),
  saveSignalNames: (map) => ipcRenderer.invoke("signal-names:save", map)
});
