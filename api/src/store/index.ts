import { config } from '../config.js';
import { MemoryStore } from './memoryStore.js';
import { OracleStore } from './oracleStore.js';
import type { DataStore } from './datastore.js';

export async function createDataStore(): Promise<DataStore> {
  const ds: DataStore =
    config.datastore === 'oracle' ? new OracleStore() : new MemoryStore();
  await ds.init();
  return ds;
}

export type { DataStore };
