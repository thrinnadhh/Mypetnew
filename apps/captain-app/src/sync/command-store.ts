import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { CommandType, MutationCommand } from '../domain/command';

const COMMAND_STORE_KEY = 'mypetnew.captain.commands.v1';

export class CommandStore {
  private commands: Map<string, MutationCommand> = new Map();
  private initialized = false;
  private writeTail: Promise<void> = Promise.resolve();

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
        const parsed: any[] = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((rawCmd) => {
            const cmdId = rawCmd.commandId || rawCmd.id;
            const cmdType = rawCmd.commandType || rawCmd.type;
            if (cmdId && cmdType) {
              const cmd: MutationCommand = {
                commandId: cmdId,
                id: cmdId,
                commandType: cmdType,
                type: cmdType,
                captainId: rawCmd.captainId ?? null,
                jobId: rawCmd.jobId ?? null,
                idempotencyKey: rawCmd.idempotencyKey,
                payload: rawCmd.payload,
                payloadFingerprint: rawCmd.payloadFingerprint || '',
                createdAt: rawCmd.createdAt || new Date().toISOString(),
                lastAttemptAt: rawCmd.lastAttemptAt ?? null,
                attemptCount: rawCmd.attemptCount ?? 0,
                state: rawCmd.state || 'UNKNOWN',
                lastErrorCode: rawCmd.lastErrorCode ?? null,
                lastError: rawCmd.lastError ?? null,
                updatedAt: rawCmd.updatedAt || new Date().toISOString(),
              };
              this.commands.set(cmdId, cmd);
            }
          });
        }
      }
    } catch {
      // Degrade gracefully
    } finally {
      this.initialized = true;
    }
  }

  private async persist(): Promise<void> {
    const operation = async () => {
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
        // Storage failure fallback
      }
    };

    const next = this.writeTail.then(operation, operation);
    this.writeTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async save(command: MutationCommand): Promise<void> {
    await this.load();
    const cmdId = command.commandId || command.id;
    const cmdType = command.commandType || command.type;
    const normalized: MutationCommand = {
      ...command,
      commandId: cmdId,
      id: cmdId,
      commandType: cmdType,
      type: cmdType,
      updatedAt: new Date().toISOString(),
    };

    this.commands.set(cmdId, normalized);
    await this.persist();
  }

  async get(commandId: string): Promise<MutationCommand | undefined> {
    await this.load();
    return this.commands.get(commandId);
  }

  async getByJobAndType(jobId: string, commandType: CommandType): Promise<MutationCommand | undefined> {
    await this.load();
    const all = Array.from(this.commands.values()).filter(
      (cmd) => cmd.jobId === jobId && (cmd.commandType === commandType || cmd.type === commandType),
    );

    // Prefer active / unresolved command (PENDING, SENDING, UNKNOWN)
    const active = all.find((cmd) => cmd.state === 'PENDING' || cmd.state === 'SENDING' || cmd.state === 'UNKNOWN');
    if (active) return active;

    // Return latest if any
    return all.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<MutationCommand | undefined> {
    await this.load();
    return Array.from(this.commands.values()).find((cmd) => cmd.idempotencyKey === idempotencyKey);
  }

  async listPending(): Promise<MutationCommand[]> {
    await this.load();
    return Array.from(this.commands.values()).filter(
      (cmd) => cmd.state === 'PENDING' || cmd.state === 'SENDING' || cmd.state === 'UNKNOWN',
    );
  }

  async listAll(): Promise<MutationCommand[]> {
    await this.load();
    return Array.from(this.commands.values());
  }

  async remove(commandId: string): Promise<void> {
    await this.load();
    this.commands.delete(commandId);
    await this.persist();
  }

  async clear(): Promise<void> {
    await this.load();
    this.commands.clear();
    await this.persist();
  }
}

export const commandStore = new CommandStore();
