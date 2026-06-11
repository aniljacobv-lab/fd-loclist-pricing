import { config } from '../config.js';
import { MemoryStore } from './memoryStore.js';
import { OracleStore } from './oracleStore.js';
import { wrapWithCentauri } from './centauriEmitter.js';
import type { DataStore } from './datastore.js';

export async function createDataStore(): Promise<DataStore> {
  const ds: DataStore =
    config.datastore === 'oracle' ? new OracleStore() : new MemoryStore();
  await ds.init();
  // Mirrors price-change lifecycle into Centauri when CENTAURI_URL is set.
  // Fire-and-forget: never blocks or fails app operations.
  return wrapWithCentauri(ds);
}

export type { DataStore };
