// One serialized writer per archive, including background request completions.
export function createLocalArchive({ read, write, initial, validate, reduce }) {
  let state,
    storageError = "",
    queue = Promise.resolve();
  function transact(action) {
    const task = queue
      .catch(() => {})
      .then(async () => {
        if (!state) {
          const saved = await read();
          state = validate(saved ?? (await initial()));
          if (saved === null) {
            try {
              await write(state);
            } catch (e) {
              state = undefined;
              throw e;
            }
          }
        }
        if (action) {
          const next = validate(reduce(state, action));
          try {
            await write(next);
            storageError = "";
          } catch {
            storageError =
              "Recent changes are only in memory because saving failed. Keep Beacon open and retry saving.";
          }
          state = next;
        }
        return { ...structuredClone(state), storageError };
      });
    queue = task;
    return task;
  }
  return {
    snapshot: () => transact(),
    action: (a) => transact(a),
    idle: () => queue.catch(() => {}),
  };
}
