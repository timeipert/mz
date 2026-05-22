import * as T from './model';

export function insert(r: T.RootContainer, at: number[], stripNotes: boolean, stripText: boolean): string | null {
  const old = getStore();

  if (old === null) {
    return "Es wurde nichts kopiert. Wählen Sie ein Element und dann 'Kopieren', um ein Element zu kopieren.";
  }
  T.unsafeGenerateNewUUIDs(old.data);
  if (stripNotes) {
    T.getSyllables(old.data).forEach(s => {s.notes = { spaced: [] } });
  }
  if (stripText) {
    T.getSyllables(old.data).forEach(s => {s.text = "" });
  }
  
  if (r.documentType !== old.partOf) {
    return "Teile von unterschiedlichen Dokumenttypen können nicht kombiniert werden, weil Sie unterschiedliche Hierarchien und Daten besitzen."
  } else if (old.data.kind === "RootContainer") {
    old.data.comments = [];
    if (at.length === 0) {
      for (let member in r) delete (r as any)[member];
      Object.assign(r, old.data);
      return null;
    } else {
      return "Ein Root-Container kann nur auf der obersten Ebene eingefügt werden.";
    }
  } else if (old.oldDepth === at.length + 1) {
    const parent = T.resolve(r, at)!;
    const children = T.getContainerChildren(parent);
    children.unshift(old.data);
    return null;
  } else if (old.oldDepth === at.length) {
    const parent = T.resolve(r, at.slice(0, at.length - 1))!;
    const children = T.getContainerChildren(parent);
    children.splice(at[at.length - 1] + 1, 0, old.data);
    return null;
  } 
  return "Dieses Element kann auf dieser Ebene nicht eingefügt werden.";
}

export function store(sdp: StoredDocumentPart): void {
  localStorage.setItem(lsKey, JSON.stringify(sdp));
}

export function getStore(): StoredDocumentPart | null {
  const old = localStorage.getItem(lsKey);
  if (old === null) {
    return null;
  } else {
    return JSON.parse(old);
  }
}

export interface StoredDocumentPart {
  data: T.Container;
  oldDepth: number;
  partOf: T.DocumentType;
}

const lsKey = "stored-document-part";
