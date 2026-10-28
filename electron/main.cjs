const {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  dialog,
  shell,
  clipboard,
  session,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const net = require("node:net");

// Allow slower working IP routes to connect before trying another address family.
// The short Node default can abandon IPv4 when the alternative IPv6 route is down.
net.setDefaultAutoSelectFamilyAttemptTimeout(
  Math.max(net.getDefaultAutoSelectFamilyAttemptTimeout(), 1500),
);

// This parallel local edition has its own profile. Existing installations remain intact.
app.setPath("userData", path.join(app.getPath("appData"), "Beacon"));
if (process.env.WORK_TEAM_TEST_DATA && !app.isPackaged)
  app.setPath("userData", path.resolve(process.env.WORK_TEAM_TEST_DATA));
let mainWindow,
  activeRequest,
  credentialLoaded,
  settings,
  domain,
  libraryModule,
  provider,
  conversations,
  sendConversation,
  conversationRequest,
  investigations;
const backgroundRequests = new Set();
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});
const root = () => app.getPath("userData");
const file = (name) => path.join(root(), name);
const indexPath = path.join(__dirname, "../dist/index.html");
const indexUrl = pathToFileURL(indexPath).href;

async function readJSON(name, fallback) {
  try {
    return JSON.parse(await fs.readFile(file(name), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw new Error(
      "A local data file could not be read. The original has not been overwritten.",
    );
  }
}
async function writeJSON(name, data) {
  const temp = file(`${name}.${randomUUID()}.tmp`);
  await fs.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(temp, file(name));
}
async function decryptCredential() {
  if (credentialLoaded) return credentialLoaded;
  let bytes;
  try {
    bytes = await fs.readFile(file("credential.encrypted"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("OS credential storage is unavailable.");
  const { parseCredential } = await import("./credentials.mjs");
  credentialLoaded = parseCredential(safeStorage.decryptString(bytes));
  return credentialLoaded;
}
async function connectionStatus() {
  try {
    const c = await decryptCredential();
    return c ? { imported: true, project: c.project_id } : { imported: false };
  } catch {
    return {
      imported: false,
      error:
        "Stored credential could not be unlocked. Import your credential again.",
    };
  }
}
function register(name, handler) {
  ipcMain.handle(`work-team:${name}`, async (event, input) => {
    if (
      !mainWindow ||
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame ||
      event.senderFrame.url !== indexUrl
    )
      return { ok: false, error: "Untrusted app frame." };
    try {
      return { ok: true, value: await handler(input) };
    } catch (e) {
      return {
        ok: false,
        error:
          e.publicMessage ||
          (e.code
            ? "The local operation failed. Check file access and available disk space."
            : e.message || "The operation failed."),
      };
    }
  });
}
async function runProvider(messages, options = {}, backgroundSignal) {
  if (!backgroundSignal && activeRequest) throw new Error("A request is already running.");
  domain.validateMessages(messages);
  if (!settings.name) throw new Error("Set your name first.");
  const controller = new AbortController();
  if (backgroundSignal) backgroundRequests.add(controller);
  else activeRequest = controller;
  const cancelBackground = () => controller.abort();
  backgroundSignal?.addEventListener("abort", cancelBackground, {once:true});
  if (backgroundSignal?.aborted) controller.abort();
  try {
    const credential = await decryptCredential();
    if (!credential)
      throw new Error("Import your own Vertex credential first.");
    try {
      return await provider.requestClaude(
        credential,
        messages,
        controller.signal,
        options,
      );
    } catch (e) {
      if (controller.signal.aborted) throw new Error("Request cancelled. Nothing was retried.");
      throw new Error(provider.providerError(e));
    }
  } finally {
    if (activeRequest === controller) activeRequest = null;
    backgroundRequests.delete(controller);
    backgroundSignal?.removeEventListener("abort", cancelBackground);
  }
}

async function createWindow() {
  const bounds = settings.rememberWindow
    ? await readJSON("window.json", {})
    : {};
  mainWindow = new BrowserWindow({
    title: "Beacon",
    width: Math.max(900, Math.min(1800, bounds.width || 1280)),
    height: Math.max(640, Math.min(1400, bounds.height || 850)),
    minWidth: 640,
    minHeight: 560,
    show: false,
    backgroundColor: "#151515",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (url !== indexUrl) e.preventDefault();
  });
  let readyToClose = false;
  let closing = false;
  mainWindow.on("close", (event) => {
    if (readyToClose) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    if (conversationRequest) conversationRequest.cancelled = true;
    activeRequest?.abort();
    void (async () => {
      await investigations?.shutdown();
      for (const controller of backgroundRequests) controller.abort();
      await conversations.idle();
      const snapshot = await conversations.snapshot();
      if (snapshot.storageError) {
        const result = await dialog.showMessageBox(mainWindow, {
          type: "warning",
          title: "Unsaved response",
          message: snapshot.storageError,
          buttons: ["Keep Beacon open", "Close anyway"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response === 0) {
          closing = false;
          return;
        }
      }
      if (settings.rememberWindow && !mainWindow.isMaximized()) {
        const { width, height } = mainWindow.getBounds();
        await writeJSON("window.json", { width, height }).catch(() => {});
      }
      readyToClose = true;
      mainWindow.close();
    })().catch(() => {
      readyToClose = true;
      mainWindow?.close();
    });
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  await mainWindow.loadFile(indexPath);
  if (process.env.WORK_TEAM_TEST_HIDDEN !== "1") mainWindow.show();
}

if (primaryInstance)
  app
    .whenReady()
    .then(async () => {
      domain = await import("../shared/domain.mjs");
      libraryModule = await import("./library.mjs");
      provider = await import("./provider.mjs");
      const conversationModule = await import("./conversations.mjs");
      const { MAX_WORKSPACE_BYTES } =
        await import("../shared/conversations.mjs");
      sendConversation = conversationModule.sendConversation;
      conversations = conversationModule.createConversationStore({
        read: async () => {
          try {
            if (
              (await fs.stat(file("conversations.encrypted"))).size >
              MAX_WORKSPACE_BYTES + 1024 * 1024
            )
              throw new Error();
            if (!safeStorage.isEncryptionAvailable()) throw new Error();
            return JSON.parse(
              safeStorage.decryptString(
                await fs.readFile(file("conversations.encrypted")),
              ),
            );
          } catch (error) {
            if (error.code === "ENOENT") return null;
            throw new Error(
              "Saved chats could not be unlocked. The original file has not been overwritten.",
            );
          }
        },
        write: async (value) => {
          if (!safeStorage.isEncryptionAvailable())
            throw new Error(
              "OS encrypted storage is unavailable. Chats were not saved.",
            );
          const temp = file(`conversations.${randomUUID()}.tmp`);
          try {
            await fs.writeFile(
              temp,
              safeStorage.encryptString(JSON.stringify(value)),
              { mode: 0o600 },
            );
            await fs.rename(temp, file("conversations.encrypted"));
          } finally {
            await fs.rm(temp, { force: true }).catch(() => {});
          }
        },
      });
      await fs.mkdir(root(), { recursive: true });
      settings = domain.validateSettings(
        await readJSON("settings.json", domain.DEFAULT_SETTINGS),
      );
      const { createInvestigations } = await import("./investigations.mjs");
      investigations = createInvestigations({
        chats: conversations,
        ask: (messages, signal, options) => runProvider(messages, options, signal),
        read: async () => {
          try {
            const saved = await fs.readFile(file("modules.encrypted"));
            if (!safeStorage.isEncryptionAvailable()) throw new Error("OS encrypted storage unavailable.");
            return JSON.parse(safeStorage.decryptString(saved));
          } catch (e) { if (e.code === "ENOENT") return null; throw e; }
        },
        write: async (value) => {
          if (!safeStorage.isEncryptionAvailable()) throw new Error("OS encrypted storage unavailable.");
          const text = JSON.stringify(value);
          if (text.length > 32 * 1024 * 1024) throw new Error("Module storage is full.");
          const temp = file(`modules.${randomUUID()}.tmp`);
          await fs.writeFile(temp, safeStorage.encryptString(text), {mode: 0o600});
          await fs.rename(temp, file("modules.encrypted"));
        },
      });
      register("modules", () => investigations.snapshot());
      const {createCartridgeImporter} = await import("./cartridge-import.mjs");
      const {MAX_CARTRIDGE_FILE} = await import("./cartridge-crypto.mjs");
      const cartridgeImporter = createCartridgeImporter({
        install: bytes => investigations.install(bytes),
        approve: async m => {
          const approval = await dialog.showMessageBox(mainWindow, {type: "warning", title: "Trust this module?", message: `${m.name} ${m.version}`, detail: `${m.description}\n\nThis module can run its bundled Python worker through your configured SSH account and send collected evidence to your Vertex project. Import only from a trusted author. Modules are not sandboxed on the remote host.\n\nSHA-256: ${m.hash}`, buttons: ["Cancel", "Trust and import"], defaultId: 0, cancelId: 0});
          return approval.response === 1;
        },
      });
      app.on("before-quit", () => cartridgeImporter.cancel());
      register("module-import", async () => {
        const choice = await dialog.showOpenDialog(mainWindow, {title: "Import module", properties: ["openFile"], filters: [{name: "Beacon cartridge", extensions: ["beacon-module"]}]});
        if (choice.canceled) return null;
        if ((await fs.stat(choice.filePaths[0])).size > MAX_CARTRIDGE_FILE) throw new Error("Cartridge file exceeds 2 MB.");
        const bytes = await fs.readFile(choice.filePaths[0]);
        return cartridgeImporter.begin(bytes);
      });
      register("module-import-unlock", input => cartridgeImporter.unlock(input));
      register("module-import-cancel", ({token}) => cartridgeImporter.cancel(token));
      register("module-configure", input => investigations.configure(input));
      register("module-access-check", ({id}) => investigations.testAccess(id));
      register("investigation-resume", ({id, review, sourceId}) => investigations.resume(id, review === true, sourceId));
      register("investigation-source", ({id, sourceId}) => investigations.inspectSource(id, sourceId));
      register("investigation-stop", async ({id}) => { await investigations.stop(id); return investigations.snapshot(); });
      register("investigation-evidence", ({id}) => investigations.evidence(id));
      register("investigation-handoff", ({id}) => investigations.handoff(id));
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      // Renderer content is local only; the main-process provider has its own
      // exact endpoint allowlist. Imported specs and model output cannot call APIs.
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
        (_details, callback) => callback({ cancel: true }),
      );
      register("bootstrap", async () => ({
        settings,
        connection: await connectionStatus(),
        notes: await readJSON("notes.json", []),
        workspace: await conversations.snapshot(),
        provider: domain.PROVIDER,
        desktop: true,
      }));
      register("save-settings", async (input) => {
        const next = domain.validateSettings(input);
        await writeJSON("settings.json", next);
        settings = next;
        return settings;
      });
      register("import-credential", async () => {
        if (activeRequest || backgroundRequests.size)
          throw new Error(
            "Wait for the current request before replacing credentials.",
          );
        if (!safeStorage.isEncryptionAvailable())
          throw new Error(
            "OS encrypted storage is unavailable. No credential was saved.",
          );
        const choice = await dialog.showOpenDialog(mainWindow, {
          title: "Import your Google Vertex credential",
          properties: ["openFile"],
          filters: [{ name: "Credential JSON", extensions: ["json"] }],
        });
        if (choice.canceled) return null;
        if ((await fs.stat(choice.filePaths[0])).size > 256 * 1024)
          throw new Error("Credential file is too large.");
        const { parseCredential } = await import("./credentials.mjs");
        const key = parseCredential(
          await fs.readFile(choice.filePaths[0], "utf8"),
        );
        const encrypted = safeStorage.encryptString(JSON.stringify(key));
        const temp = file(`credential.${randomUUID()}.tmp`);
        await fs.writeFile(temp, encrypted, { mode: 0o600 });
        await fs.rename(temp, file("credential.encrypted"));
        credentialLoaded = key;
        return connectionStatus();
      });
      register("remove-credential", async () => {
        activeRequest?.abort();
        await investigations.shutdown();
        for (const controller of backgroundRequests) controller.abort();
        credentialLoaded = null;
        await fs.rm(file("credential.encrypted"), { force: true });
        return { imported: false };
      });
      register("test-connection", async () => {
        await runProvider([
          { role: "user", content: "Reply with only: Connection ready." },
        ]);
        return { tested: true, testedAt: new Date().toISOString() };
      });
      register("workspace", () => conversations.snapshot());
      register("workspace-action", (input) => conversations.action(input));
      register("chat", async (input) => {
        if (conversationRequest)
          throw new Error("A response is already running.");
        const request = { cancelled: false };
        conversationRequest = request;
        try {
          const starts = [];
          const next = await sendConversation(conversations, input, async (messages) => {
            if (request.cancelled) throw new Error("Request cancelled. Nothing was retried.");
            const modules = await investigations.enabled();
            const system = modules.map(m => m.package.system).join("\n") + "\n" + await investigations.context(input.chatId);
            const response = await runProvider(messages, {system, tools: await investigations.tools()});
            if (response.calls?.length) {
              if (response.calls.length !== 1 || response.calls[0].name !== "start_investigation") throw new Error("Unsupported workflow request.");
              const target = response.calls[0].input?.target;
              if (typeof target !== "string" || !input.content.includes(target))
                throw new Error("Include the exact target identifier in your message before starting an investigation.");
              const id = await investigations.start(input.chatId, response.calls[0].input);
              starts.push(id);
              response.text = "Investigation queued. Progress and specialist chats will appear here. You can continue chatting or stop the investigation at any time.";
            }
            return response;
          });
          await investigations.changed(input.chatId);
          if (!next.storageError) for (const id of starts) await investigations.resume(id);
          return next;
        } finally {
          if (conversationRequest === request) conversationRequest = null;
        }
      });
      register("cancel", () => {
        if (conversationRequest) conversationRequest.cancelled = true;
        activeRequest?.abort();
        return true;
      });
      register("library", () => libraryModule.loadLibrary(file("knowledge")));
      register("import-spec", async () => {
        const choice = await dialog.showOpenDialog(mainWindow, {
          title: "Import OpenAPI JSON",
          properties: ["openFile"],
          filters: [{ name: "OpenAPI JSON", extensions: ["json"] }],
        });
        if (choice.canceled) return null;
        if ((await fs.stat(choice.filePaths[0])).size > 16 * 1024 * 1024)
          throw new Error("Specification must be smaller than 16 MB.");
        await libraryModule.archiveSpec(
          file("knowledge"),
          await fs.readFile(choice.filePaths[0]),
          choice.filePaths[0],
        );
        return libraryModule.loadLibrary(file("knowledge"));
      });
      register("save-note", async (input) => {
        if (
          !input ||
          typeof input.title !== "string" ||
          !input.title.trim() ||
          input.title.length > 160 ||
          typeof input.body !== "string" ||
          input.body.length > 20000 ||
          typeof input.source !== "string" ||
          input.source.length > 2000
        )
          throw new Error(
            "Enter a title and keep the note under 20,000 characters.",
          );
        const notes = await readJSON("notes.json", []);
        const existing = input.id && notes.find((n) => n.id === input.id);
        if (input.id && !existing) throw new Error("The note was not found.");
        const note = {
          id: existing?.id || randomUUID(),
          title: input.title.trim(),
          body: input.body,
          source: input.source,
          status: ["observation", "hypothesis", "verified"].includes(
            input.status,
          )
            ? input.status
            : "observation",
          updatedAt: new Date().toISOString(),
        };
        const next = existing
          ? notes.map((n) => (n.id === note.id ? note : n))
          : [note, ...notes];
        await writeJSON("notes.json", next);
        return next;
      });
      register("export-chat", async (text) => {
        if (typeof text !== "string" || text.length > 100000)
          throw new Error("Export is too large.");
        const result = await dialog.showSaveDialog(mainWindow, {
          defaultPath: "beacon-conversation.md",
          filters: [{ name: "Markdown", extensions: ["md"] }],
        });
        if (result.canceled) return false;
        await fs.writeFile(result.filePath, text, { mode: 0o600 });
        return true;
      });
      register("copy", (text) => {
        if (typeof text !== "string" || text.length > 100000)
          throw new Error("Text is too large.");
        clipboard.writeText(text);
        return true;
      });
      register("open-link", async (url) => {
        if (!domain.safeLink(url))
          throw new Error(
            "Only HTTPS reference links without embedded credentials are allowed.",
          );
        await shell.openExternal(url);
        return true;
      });
      register("open-data", async () => {
        const error = await shell.openPath(root());
        if (error) throw new Error("Could not open the data directory.");
        return true;
      });
      await createWindow();
      app.on("activate", () => {
        if (!BrowserWindow.getAllWindows().length) void createWindow();
      });
    })
    .catch(() => {
      dialog.showErrorBox(
        "Beacon",
        "Startup failed. Check local file access and the installation. Existing data has not been reset.",
      );
      app.quit();
    });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
