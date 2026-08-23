import { Platform } from 'react-native';
import { CommandType, MutationCommand } from '../domain/command';
import { AppError } from '../domain/result';

export const COMMAND_STORE_KEY = 'mypetnew.captain.mutation_journal.v2';

export interface DurableStorageDriver {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class DefaultStorageDriver implements DurableStorageDriver {
  private memoryStore = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
    return this.memoryStore.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
    this.memoryStore.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
      return;
    }
    this.memoryStore.delete(key);
  }

  async clear(): Promise<void> {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(COMMAND_STORE_KEY);
      return;
    }
    this.memoryStore.clear();
  }
}

export class CommandStore {
  private commands: Map<string, MutationCommand> = new Map();
  private idempotencyIndex: Map<string, string> = new Map(); // idempotencyKey -> commandId
  private initialized = false;
  private storageDriver: DurableStorageDriver;

  constructor(driver?: DurableStorageDriver) {
    this.storageDriver = driver || new DefaultStorageDriver();
  }

  setStorageDriver(driver: DurableStorageDriver): void {
    this.storageDriver = driver;
    this.initialized = false;
    this.commands.clear();
    this.idempotencyIndex.clear();
  }

  async load(): Promise<void> {
    if (this.initialized) return;

    const raw = await this.storageDriver.getItem(COMMAND_STORE_KEY);
    if (raw !== null && raw !== undefined && raw.trim() !== '') {
      let parsed: any[];
      try {
        parsed = JSON.parse(raw);
      } catch (err: any) {
        // FAIL CLOSED on storage corruption: do NOT silently treat corrupt data as empty state
        throw new Error(`STORAGE_CORRUPTION_DETECTED: Failed to parse command store journal JSON: ${err.message}`);
      }

      if (!Array.isArray(parsed)) {
        throw new Error('STORAGE_CORRUPTION_DETECTED: Command store journal root is not an array');
      }

      this.commands.clear();
      this.idempotencyIndex.clear();

      for (const rawCmd of parsed) {
        const cmdId = rawCmd.commandId || rawCmd.id;
        const cmdType = rawCmd.commandType || rawCmd.type;

        if (!cmdId || !cmdType || !rawCmd.idempotencyKey) {
          throw new Error('STORAGE_CORRUPTION_DETECTED: Malformed command record in durable journal');
        }

        const resourceType =
          rawCmd.resourceType ||
          (cmdType === 'ACCEPT_OFFER' || cmdType === 'REJECT_OFFER'
            ? 'DISPATCH_OFFER'
            : cmdType === 'UPDATE_AVAILABILITY'
              ? 'CAPTAIN_AVAILABILITY'
              : cmdType === 'SUBMIT_ONBOARDING'
                ? 'ONBOARDING'
                : 'DELIVERY_JOB');

        const resourceId =
          rawCmd.resourceId ||
          rawCmd.jobId ||
          rawCmd.offerId ||
          rawCmd.captainId ||
          'global';

        const cmd: MutationCommand = {
          commandId: cmdId,
          id: cmdId,
          commandType: cmdType,
          type: cmdType,
          resourceType,
          resourceId,
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
        this.idempotencyIndex.set(cmd.idempotencyKey, cmdId);
      }
    }

    this.initialized = true;
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify(Array.from(this.commands.values()));
    // Storage errors MUST propagate and block execution; NEVER swallow storage failure
    await this.storageDriver.setItem(COMMAND_STORE_KEY, payload);
  }

  async save(command: MutationCommand): Promise<void> {
    await this.load();

    const cmdId = command.commandId || command.id;
    const cmdType = command.commandType || command.type;

    const resourceType =
      command.resourceType ||
      (cmdType === 'ACCEPT_OFFER' || cmdType === 'REJECT_OFFER'
        ? 'DISPATCH_OFFER'
        : cmdType === 'UPDATE_AVAILABILITY'
          ? 'CAPTAIN_AVAILABILITY'
          : cmdType === 'SUBMIT_ONBOARDING'
            ? 'ONBOARDING'
            : 'DELIVERY_JOB');

    const resourceId =
      command.resourceId ||
      command.jobId ||
      (command.payload as any)?.offerId ||
      (command.payload as any)?.jobId ||
      command.captainId ||
      'global';

    const normalized: MutationCommand = {
      ...command,
      commandId: cmdId,
      id: cmdId,
      commandType: cmdType,
      type: cmdType,
      resourceType,
      resourceId,
      updatedAt: new Date().toISOString(),
    };

    // Uniqueness constraint check on idempotencyKey
    const existingCmdIdForIdemp = this.idempotencyIndex.get(normalized.idempotencyKey);
    if (existingCmdIdForIdemp && existingCmdIdForIdemp !== cmdId) {
      const existingCmd = this.commands.get(existingCmdIdForIdemp);
      if (existingCmd && existingCmd.state !== 'SUPERSEDED') {
        throw new Error(`IDEMPOTENCY_KEY_CONFLICT: Key ${normalized.idempotencyKey} is already bound to command ${existingCmdIdForIdemp}`);
      }
    }

    // Keep snapshot for rollback if persistence fails
    const previousCommand = this.commands.get(cmdId);
    const previousIdempIndex = normalized.idempotencyKey ? this.idempotencyIndex.get(normalized.idempotencyKey) : undefined;

    this.commands.set(cmdId, normalized);
    this.idempotencyIndex.set(normalized.idempotencyKey, cmdId);

    try {
      await this.persist();
    } catch (err) {
      // Roll back in-memory state on persistence failure
      if (previousCommand) {
        this.commands.set(cmdId, previousCommand);
      } else {
        this.commands.delete(cmdId);
      }
      if (previousIdempIndex) {
        this.idempotencyIndex.set(normalized.idempotencyKey, previousIdempIndex);
      } else {
        this.idempotencyIndex.delete(normalized.idempotencyKey);
      }
      throw err;
    }
  }

  async get(commandId: string): Promise<MutationCommand | undefined> {
    await this.load();
    return this.commands.get(commandId);
  }

  async getByIdempotencyKey(idempotencyKey: string): Promise<MutationCommand | undefined> {
    await this.load();
    const cmdId = this.idempotencyIndex.get(idempotencyKey);
    if (cmdId) {
      return this.commands.get(cmdId);
    }
    return Array.from(this.commands.values()).find((cmd) => cmd.idempotencyKey === idempotencyKey);
  }

  /**
   * Finds an unresolved / active command for the given resource scope.
   * NEVER returns historical terminal commands (ACKNOWLEDGED / REJECTED / SUPERSEDED).
   */
  async findActiveCommand(
    commandType: CommandType,
    resourceType: string,
    resourceId: string,
  ): Promise<MutationCommand | undefined> {
    await this.load();
    const activeStates = new Set(['PENDING', 'SENDING', 'UNKNOWN']);

    return Array.from(this.commands.values()).find(
      (cmd) =>
        cmd.commandType === commandType &&
        cmd.resourceType === resourceType &&
        cmd.resourceId === resourceId &&
        activeStates.has(cmd.state),
    );
  }

  /**
   * Backwards-compatibility query for active commands by jobId and commandType.
   * Only returns active (PENDING / SENDING / UNKNOWN) commands.
   */
  async getByJobAndType(
    jobId: string | null | undefined,
    commandType: CommandType,
  ): Promise<MutationCommand | undefined> {
    await this.load();
    const activeStates = new Set(['PENDING', 'SENDING', 'UNKNOWN']);

    const matching = Array.from(this.commands.values()).filter(
      (cmd) =>
        (jobId ? cmd.jobId === jobId || cmd.resourceId === jobId : !cmd.jobId) &&
        (cmd.commandType === commandType || cmd.type === commandType) &&
        activeStates.has(cmd.state),
    );

    if (matching.length === 0) return undefined;
    return matching.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  }

  async listPending(): Promise<MutationCommand[]> {
    await this.load();
    const activeStates = new Set(['PENDING', 'SENDING', 'UNKNOWN']);
    return Array.from(this.commands.values()).filter((cmd) => activeStates.has(cmd.state));
  }

  async listAll(): Promise<MutationCommand[]> {
    await this.load();
    return Array.from(this.commands.values());
  }

  async remove(commandId: string): Promise<void> {
    await this.load();
    const cmd = this.commands.get(commandId);
    if (cmd) {
      this.idempotencyIndex.delete(cmd.idempotencyKey);
    }
    this.commands.delete(commandId);
    await this.persist();
  }

  async clear(): Promise<void> {
    this.commands.clear();
    this.idempotencyIndex.clear();
    this.initialized = true;
    await this.storageDriver.clear();
  }

  resetMemoryForTesting(): void {
    this.initialized = false;
    this.commands.clear();
    this.idempotencyIndex.clear();
  }

  resetStorageDriverForTesting(): void {
    this.storageDriver = new DefaultStorageDriver();
    this.initialized = false;
    this.commands.clear();
    this.idempotencyIndex.clear();
  }
}

export const commandStore = new CommandStore();
