import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { MutationCommand } from '../domain/command';

const COMMAND_STORE_KEY = 'mypetnew.captain.commands.v1';

class CommandStore {
  private commands: Map<string, MutationCommand> = new Map();
  private initialized = false;

  private async load(): Promise<void> {
    if (this.initialized) return;
    try {
      let raw: string | null = null;
      if (Platform.OS === 'web') {
        raw = typeof localStorage !== 'undefined' ? localStorage.getItem(COMMAND_STORE_KEY) : null;
      } else {
        raw = await SecureStore.getItemAsync(COMMAND_STORE_KEY);
      }

      if (raw) {
        const parsed: MutationCommand[] = JSON.parse(raw);
        parsed.forEach((cmd) => this.commands.set(cmd.id, cmd));
      }
    } catch {
      // Degrade gracefully
    } finally {
      this.initialized = true;
    }
  }

  private async persist(): Promise<void> {
    try {
      const payload = JSON.stringify(Array.from(this.commands.values()));
      if (Platform.OS === 'web') {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(COMMAND_STORE_KEY, payload);
        }
      } else {
        await SecureStore.setItemAsync(COMMAND_STORE_KEY, payload);
      }
    } catch {
      // Ignore
    }
  }

  async save(command: MutationCommand): Promise<void> {
    await this.load();
    this.commands.set(command.id, command);
    await this.persist();
  }

  async get(id: string): Promise<MutationCommand | undefined> {
    await this.load();
    return this.commands.get(id);
  }

  async listPending(): Promise<MutationCommand[]> {
    await this.load();
    return Array.from(this.commands.values()).filter(
      (cmd) => cmd.state === 'PENDING' || cmd.state === 'UNKNOWN' || cmd.state === 'REQUIRES_RECONCILIATION',
    );
  }

  async clear(): Promise<void> {
    this.commands.clear();
    await this.persist();
  }
}

export const commandStore = new CommandStore();
