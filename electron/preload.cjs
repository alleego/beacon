const { contextBridge, ipcRenderer } = require("electron");
const channels = [
  "bootstrap", "investigation-source",
  "module-access-check",
  "module-import-unlock", "module-import-cancel",
  "modules", "module-import", "module-configure", "investigation-resume", "investigation-stop", "investigation-evidence", "investigation-handoff",
  "save-settings",
  "import-credential",
  "remove-credential",
  "test-connection",
  "chat",
  "workspace",
  "workspace-action",
  "cancel",
  "library",
  "import-spec",
  "save-note",
  "export-chat",
  "open-link",
  "copy",
  "open-data",
];
contextBridge.exposeInMainWorld(
  "workTeam",
  Object.freeze(
    Object.fromEntries(
      channels.map((channel) => [
        channel,
        async (payload) => {
          const result = await ipcRenderer.invoke(
            `work-team:${channel}`,
            payload,
          );
          if (!result.ok) throw new Error(result.error);
          return result.value;
        },
      ]),
    ),
  ),
);
