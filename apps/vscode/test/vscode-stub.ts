/**
 * The slice of the VS Code API the extension actually touches, standing in for
 * the real thing so extension logic can be tested outside an editor.
 *
 * Deliberately small. A faithful reimplementation of VS Code would be its own
 * source of bugs; this exists so a file watcher's own behaviour -- what it
 * watches, when it fires, what it does when the call fails -- can be asserted,
 * and nothing more.
 */

type Listener<T> = (event: T) => void;

class Emitter<T> {
  private listeners: Listener<T>[] = [];

  event = (listener: Listener<T>) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };

  fire(value: T): void {
    for (const listener of this.listeners) listener(value);
  }
}

export class RelativePattern {
  constructor(
    readonly base: string,
    readonly pattern: string,
  ) {}
}

export class FileSystemWatcherStub {
  disposed = false;

  private readonly changed = new Emitter<void>();
  private readonly created = new Emitter<void>();

  constructor(readonly pattern: RelativePattern) {}

  onDidChange = this.changed.event;
  onDidCreate = this.created.event;
  onDidDelete = new Emitter<void>().event;

  /** Test-side trigger: stands in for git moving HEAD. */
  emitChange(): void {
    this.changed.fire();
  }

  emitCreate(): void {
    this.created.fire();
  }

  dispose(): void {
    this.disposed = true;
  }
}

/** Every watcher created during a test, so assertions can reach them. */
export const createdWatchers: FileSystemWatcherStub[] = [];

export const workspace = {
  workspaceFolders: undefined as { uri: { fsPath: string } }[] | undefined,
  createFileSystemWatcher(pattern: RelativePattern) {
    const watcher = new FileSystemWatcherStub(pattern);
    createdWatchers.push(watcher);
    return watcher;
  },
  onDidChangeWorkspaceFolders: new Emitter<void>().event,
  getConfiguration: () => ({ get: () => undefined }),
};

export const window = {
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  createOutputChannel: () => ({ appendLine: () => {}, dispose: () => {} }),
};

export const commands = { executeCommand: async () => undefined };

export function resetVsCodeStub(): void {
  createdWatchers.length = 0;
  workspace.workspaceFolders = undefined;
}
