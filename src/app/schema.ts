import * as localforage from 'localforage';

export const WORKSPACE_SCHEMA_VERSION = 1;

const migrations: { [from: number]: () => Promise<void> } = {};

export async function ensureSchemaVersion(): Promise<void> {
  let currentVersion = await localforage.getItem<number>('monodi_schema_version');
  if (currentVersion === null || currentVersion === undefined) {
    await localforage.setItem('monodi_schema_version', WORKSPACE_SCHEMA_VERSION);
    return;
  }

  if (currentVersion > WORKSPACE_SCHEMA_VERSION) {
    console.error(`Warning: The workspace schema version (${currentVersion}) is newer than the supported version (${WORKSPACE_SCHEMA_VERSION}).`);
    return;
  }

  while (currentVersion < WORKSPACE_SCHEMA_VERSION) {
    const migration = migrations[currentVersion];
    if (migration) {
      console.log(`Running database schema migration from version ${currentVersion}...`);
      await migration();
    }
    currentVersion++;
    await localforage.setItem('monodi_schema_version', currentVersion);
  }
}
