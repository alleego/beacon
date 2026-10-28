import {
  newWorkspace,
  validateWorkspace,
  changeWorkspace,
  beginTurn,
  finishTurn,
  recoverWorkspace,
  findChat,
} from "../shared/conversations.mjs";

// Serialize all edits, including provider completions, so a late response cannot
// replace a newer selection, project change, or another chat's draft.
export function createConversationStore({ read, write }) {
  let state;
  let storageError = "";
  let queue = Promise.resolve();
  async function load() {
    if (state) return;
    const saved = await read();
    const initial = saved === null ? newWorkspace() : validateWorkspace(saved);
    const recovered = recoverWorkspace(initial);
    if (saved === null || recovered !== initial) await write(recovered);
    state = recovered;
  }
  function transact(reducer, retainOnError = false) {
    const task = queue
      .catch(() => {})
      .then(async () => {
        await load();
        if (reducer) {
          const next = reducer(state);
          try {
            await write(next);
            state = next;
            storageError = "";
          } catch (error) {
            if (!retainOnError) throw error;
            state = next;
            storageError =
              "The latest response is only in memory because saving failed. Export it before closing; no request was retried.";
          }
        }
        return { ...structuredClone(state), storageError };
      });
    queue = task;
    return task;
  }
  return {
    internal: (reducer) => transact((state) => reducer(structuredClone(state))),
    snapshot: () => transact(),
    action: (action) => transact((state) => changeWorkspace(state, action)),
    begin: (input) => transact((state) => beginTurn(state, input)),
    finish: (id, response, error) =>
      transact((state) => finishTurn(state, id, response, error), true),
    idle: () => queue.catch(() => {}),
  };
}

export async function sendConversation(store, input, provider) {
  const started = await store.begin(input);
  const chat = findChat(started, input.chatId);
  let response;
  try {
    response = await provider([
      ...chat.messages.map(({ role, content }) => ({ role, content })),
      { role: "user", content: chat.pending.question },
    ]);
  } catch (error) {
    return store.finish(
      chat.id,
      null,
      error.message || "The response did not complete. Nothing was retried.",
    );
  }
  // A save failure must never cause an automatic repeat of a billable request.
  return store.finish(chat.id, response);
}
