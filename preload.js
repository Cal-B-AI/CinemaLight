// Gives the page a small, safe bridge to the desktop: the list of connected screens, and which screen a projector's output should open on.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("cuelightDesktop", {
  displays: () => ipcRenderer.invoke("cl:displays"),
  assign: (outputId, displayId) => ipcRenderer.invoke("cl:assign", String(outputId), displayId == null ? null : Number(displayId)),
  identify: displayId => ipcRenderer.invoke("cl:identify", Number(displayId)),
  onDisplaysChanged: cb => { const h = () => cb(); ipcRenderer.on("cl:displays-changed", h); return () => ipcRenderer.removeListener("cl:displays-changed", h); }
});
