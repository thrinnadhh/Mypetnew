import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { CommandType, MutationCommand } from '../domain/command';
import { AppError } from '../domain/result';
import { createNativeCommandStorage } from './durable-command-storage';

export const COMMAND_STORE_KEY = 'mypetnew.captain.mutation_journal.v2';
const SENSITIVE_COMMAND_KEY_PREFIX = 'mypetnew.captain.command_proof.v1.';
const SENSITIVE_COMMAND_INDEX_KEY = 'mypetnew.captain.command_proof_index.v1';
const webSensitiveValues = new Map<string, string>();

function isProofCommand(commandType: CommandType): boolean {
  return commandType === 'MARK_PICKED_UP' || commandType === 'MARK_DELIVERED';
}

function sensitiveKey(commandId: string): string {
  return `${SENSITIVE_COMMAND_KEY_PREFIX}${commandId}`;
}

async function readSensitiveIndex(): Promise<Set<string>> {
  if (Platform.OS === 'web') return new Set(webSensitiveValues.keys());
  try {
    const raw = await SecureStore.getItemAsync(SENSITIVE_COMMAND_INDEX_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((value): value is string => typeof value === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

async function writeSensitiveIndex(commandIds: Set<string>): Promise<void> {
  if (Platform.OS === 'web') return;
  if (commandIds.size === 0) {
    await SecureStore.deleteItemAsync(SENSITIVE_COMMAND_INDEX_KEY);
    return;
  }
  await SecureStore.setItemAsync(SENSITIVE_COMMAND_INDEX_KEY, JSON.stringify([...commandIds]));
}

async function setSensitiveValue(commandId: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    webSensitiveValues.set(commandId, value);
    return;
  }
  const commandIds = await readSensitiveIndex();
  commandIds.add(commandId);
  // Index first so a partial storage failure remains discoverable for logout cleanup.
  await writeSensitiveIndex(commandIds);
  try {
    await SecureStore.setItemAsync(sensitiveKey(commandId), value);
  } catch (error) {
    commandIds.delete(commandId);
    await writeSensitiveIndex(commandIds).catch(() => {});
    throw error;
  }
}

async function getSensitiveValue(commandId: string): Promise<string | null> {
  if (Platform.OS === 'web') return webSensitiveValues.get(commandId) ?? null;
  return SecureStore.getItemAsync(sensitiveKey(commandId));
}

async function deleteSensitiveValue(commandId: string): Promise<void> {
  if (Platform.OS === 'web') {
    webSensitiveValues.delete(commandId);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(sensitiveKey(commandId));
    const commandIds = await readSensitiveIndex();
    commandIds.delete(commandId);
    await writeSensitiveIndex(commandIds);
  } catch {
    // Best-effort removal during terminal transition/logout cleanup.
  }
}

async function clearSensitiveValues(knownCommandIds: Iterable<string>): Promise<void> {
  if (Platform.OS === 'web') {
    webSensitiveValues.clear();
    return;
  }
  const indexedCommandIds = await readSensitiveIndex();
  for (const commandId of knownCommandIds) indexedCommandIds.add(commandId);
  await Promise.all(
    [...indexedCommandIds].map((commandId) =>
      Promise.resolve(SecureStore.deleteItemAsync(sensitiveKey(commandId))).catch(() => {}),
    ),
  );
  await Promise.resolve(SecureStore.deleteItemAsync(SENSITIVE_COMMAND_INDEX_KEY)).catch(() => {});
}

function proofPayload(payload: unknown): Record<string, any> | null {
  if (!payload || typeof payload !== 'object') return null;
  const proof = (payload as Record<string, any>).proof;
  return proof && typeof proof === 'object' ? proof : null;
}

function redactProofPayload(payload: unknown, requiresPinReentry: boolean): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const current = payload as Record<string, any>;
  const proof = proofPayload(payload);
  if (!proof) return payload;
  const { pinCode: _pinCode, ...safeProof } = proof;
  return {
    ...current,
    proof: {
      ...safeProof,
      ...(requiresPinReentry ? { requiresPinReentry: true } : {}),
    },
  };
}

export function commandRequiresPinReentry(command: MutationCommand): boolean {
  return proofPayload(command.payload)?.requiresPinReentry === true;
}

export interface DurableStorageDriver {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class DefaultStorageDriver implements DurableStorageDriver {
  private memoryStore = new Map<string, string>();
  private nativeStore = Platform.OS === 'web' ? null : createNativeCommandStorage();

  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
    if (this.nativeStore) return this.nativeStore.getItem(key);
    return this.memoryStore.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      return;
    }
    if (this.nativeStore) {
      await this.nativeStore.setItem(key, value);
      return;
    }
    this.memoryStore.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
      return;
    }
    if (this.nativeStore) {
      await this.nativeStore.removeItem(key);
      return;
    }
    this.memoryStore.delete(key);
  }

  async clear(): Promise<void> {
    if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
      localStorage.removeItem(COMMAND_STORE_KEY);
      return;
    }
    if (this.nativeStore) {
      await this.nativeStore.removeItem(COMMAND_STORE_KEY);
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

        let payload = rawCmd.payload;
        if (isProofCommand(cmdType) && proofPayload(payload)?.requiresPinReentry === true) {
          const pinCode = await getSensitiveValue(cmdId).catch(() => null);
          if (pinCode) {
            const current = payload as Record<string, any>;
            const proof = proofPayload(payload) as Record<string, any>;
            const { requiresPinReentry: _requiresPinReentry, ...hydratedProof } = proof;
            payload = { ...current, proof: { ...hydratedProof, pinCode } };
          }
        }

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
          payload,
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
    const persistedCommands: MutationCommand[] = [];
    const sensitiveValuesToDelete: string[] = [];
    for (const command of this.commands.values()) {
      const proof = proofPayload(command.payload);
      const active = command.state === 'PENDING' || command.state === 'SENDING' || command.state === 'UNKNOWN';
      if (isProofCommand(command.commandType) && active && typeof proof?.pinCode === 'string') {
        await setSensitiveValue(command.commandId, proof.pinCode);
        persistedCommands.push({
          ...command,
          payload: redactProofPayload(command.payload, true),
        });
      } else {
        if (isProofCommand(command.commandType) && !active) {
          sensitiveValuesToDelete.push(command.commandId);
        }
        persistedCommands.push(command);
      }
    }
    const payload = JSON.stringify(persistedCommands);
    // Storage errors MUST propagate and block execution; NEVER swallow storage failure
    await this.storageDriver.setItem(COMMAND_STORE_KEY, payload);
    for (const commandId of sensitiveValuesToDelete) await deleteSensitiveValue(commandId);
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

    const terminal =
      command.state === 'ACKNOWLEDGED' ||
      command.state === 'REJECTED' ||
      command.state === 'SUPERSEDED';
    const normalized: MutationCommand = {
      ...command,
      commandId: cmdId,
      id: cmdId,
      commandType: cmdType,
      type: cmdType,
      resourceType,
      resourceId,
      payload: terminal && isProofCommand(cmdType)
        ? redactProofPayload(command.payload, false)
        : command.payload,
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

  async get(commandId: string, captainId?: string | null): Promise<MutationCommand | undefined> {
    await this.load();
    const command = this.commands.get(commandId);
    if (captainId && command?.captainId !== captainId) return undefined;
    return command;
  }

  async getByIdempotencyKey(
    idempotencyKey: string,
    captainId?: string | null,
  ): Promise<MutationCommand | undefined> {
    await this.load();
    const cmdId = this.idempotencyIndex.get(idempotencyKey);
    if (cmdId) {
      const command = this.commands.get(cmdId);
      if (!captainId || command?.captainId === captainId) return command;
      return undefined;
    }
    return Array.from(this.commands.values()).find(
      (cmd) => cmd.idempotencyKey === idempotencyKey && (!captainId || cmd.captainId === captainId),
    );
  }

  /**
   * Finds an unresolved / active command for the given resource scope.
   * NEVER returns historical terminal commands (ACKNOWLEDGED / REJECTED / SUPERSEDED).
   */
  async findActiveCommand(
    commandType: CommandType,
    resourceType: string,
    resourceId: string,
    captainId?: string | null,
  ): Promise<MutationCommand | undefined> {
    await this.load();
    const activeStates = new Set(['PENDING', 'SENDING', 'UNKNOWN']);

    return Array.from(this.commands.values()).find(
      (cmd) =>
        cmd.commandType === commandType &&
        cmd.resourceType === resourceType &&
        cmd.resourceId === resourceId &&
        (!captainId || cmd.captainId === captainId) &&
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
    captainId?: string | null,
  ): Promise<MutationCommand | undefined> {
    await this.load();
    const activeStates = new Set(['PENDING', 'SENDING', 'UNKNOWN']);

    const matching = Array.from(this.commands.values()).filter(
      (cmd) =>
        (jobId ? cmd.jobId === jobId || cmd.resourceId === jobId : !cmd.jobId) &&
        (cmd.commandType === commandType || cmd.type === commandType) &&
        (!captainId || cmd.captainId === captainId) &&
        activeStates.has(cmd.state),
    );

    if (matching.length === 0) return undefined;
    return matching.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  }

  async listPending(captainId?: string | null): Promise<MutationCommand[]> {
    await this.load();
    const activeStates = new Set(['PENDING', 'SENDING', 'UNKNOWN']);
    return Array.from(this.commands.values()).filter(
      (cmd) => activeStates.has(cmd.state) && (!captainId || cmd.captainId === captainId),
    );
  }

  async listAll(captainId?: string | null): Promise<MutationCommand[]> {
    await this.load();
    return Array.from(this.commands.values()).filter(
      (command) => !captainId || command.captainId === captainId,
    );
  }

  async remove(commandId: string): Promise<void> {
    await this.load();
    const cmd = this.commands.get(commandId);
    if (cmd) {
      this.idempotencyIndex.delete(cmd.idempotencyKey);
    }
    this.commands.delete(commandId);
    await deleteSensitiveValue(commandId);
    await this.persist();
  }

  async clear(): Promise<void> {
    try {
      await this.load();
    } catch {
      // Clearing a corrupted journal must still remain possible.
    }
    await clearSensitiveValues(this.commands.keys());
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
