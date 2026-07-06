import { WORKSPACE_SCHEMA_VERSION } from './schema';

export interface WorkspaceImportResult {
  sources: any;
  documents: any;
  notesDict: any;
  settings: any;
  schemaVersion: number;
}

export function buildWorkspaceExport(
  sources: any,
  documents: any,
  notesDict: any,
  settings: any
): any {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    sources,
    documents,
    notes: notesDict,
    settings
  };
}

export function parseWorkspaceImport(json: any): WorkspaceImportResult {
  if (!json || typeof json !== 'object') {
    throw new Error('Ungültiges Workspace-Format: JSON ist kein Objekt.');
  }
  const schemaVersion = json.schemaVersion !== undefined ? json.schemaVersion : 1;
  return {
    sources: json.sources,
    documents: json.documents,
    notesDict: json.notes,
    settings: json.settings,
    schemaVersion
  };
}
