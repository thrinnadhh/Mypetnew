import type { NativeCommandStorage } from './durable-command-storage';

// Metro resolves this platform file on web, keeping the native SQLite/WASM
// implementation out of the browser bundle. CommandStore uses localStorage on web.
export function createNativeCommandStorage(): NativeCommandStorage {
  throw new Error('Native command storage is unavailable on web');
}
