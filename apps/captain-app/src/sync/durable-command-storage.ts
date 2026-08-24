import { SQLiteStorage } from 'expo-sqlite/kv-store';

export interface NativeCommandStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createNativeCommandStorage(): NativeCommandStorage {
  return new SQLiteStorage('mypetnew-captain-commands.db');
}
