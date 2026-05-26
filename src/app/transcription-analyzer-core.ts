/**
 * Pure analysis logic — NO Angular imports.
 * Imported by both TranscriptionAnalyzerService (via DI) and transcription.worker.ts
 * so that the worker bundle stays free of @angular/core / zone.js.
 */

import * as VM from './types/model';

export interface AnalyzedPattern {
  patternId: string;
  sourceId: string;
  documentId: string;
  folio: string;
  line: string;
  syllable: string;
  notesCount: number;
  uuid: string;
}

function pitchToMidi(base: VM.BaseNote, octave: number): number {
  const offsets: { [key: string]: number } = {
    'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11
  };
  return octave * 12 + (offsets[base] || 0);
}

function getDirection(p1: number, p2: number): string {
  if (p2 > p1) return 'u';
  if (p2 < p1) return 'd';
  return 'e';
}

function getSuffix(noteType: VM.NoteType, isLiquescent: boolean): string {
  let s = '';
  if (noteType === VM.NoteType.Oriscus)      s += 'O';
  else if (noteType === VM.NoteType.Quilisma)    s += 'Q';
  else if (noteType === VM.NoteType.Strophicus)  s += 'S';
  else if (noteType === VM.NoteType.Ascending)   s += 'LA';
  else if (noteType === VM.NoteType.Descending)  s += 'LD';
  else if (noteType === VM.NoteType.Liquescent)  s += 'L';
  if (isLiquescent && !s.includes('L')) s += 'L';
  return s;
}

export function extractPattern(nonSpaced: VM.NonSpaced): string {
  if (!nonSpaced || !nonSpaced.nonSpaced || nonSpaced.nonSpaced.length === 0) return '';

  const parts: string[] = [];
  let prevLastNote: VM.Note | null = null;
  let prevLastPitch = 0;

  for (let i = 0; i < nonSpaced.nonSpaced.length; i++) {
    const group = nonSpaced.nonSpaced[i].grouped;
    if (group.length === 0) continue;

    const isGroup = group.length > 1;

    if (i === 0) {
      if (isGroup) parts.push('[');
      parts.push('*' + getSuffix(group[0].noteType, group[0].liquescent));
    } else {
      if (isGroup) parts.push('[');
      if (prevLastNote !== null) {
        const currentPitch = pitchToMidi(group[0].base, group[0].octave);
        const linkDir = getDirection(prevLastPitch, currentPitch);
        parts.push(linkDir + getSuffix(group[0].noteType, group[0].liquescent));
      }
    }

    if (group.length >= 2) {
      for (let k = 0; k < group.length - 1; k++) {
        const p1 = pitchToMidi(group[k].base, group[k].octave);
        const p2 = pitchToMidi(group[k + 1].base, group[k + 1].octave);
        const d = getDirection(p1, p2);
        parts.push(d + getSuffix(group[k + 1].noteType, group[k + 1].liquescent));
      }
    }

    if (isGroup) parts.push(']');

    prevLastNote = group[group.length - 1];
    prevLastPitch = pitchToMidi(prevLastNote.base, prevLastNote.octave);
  }

  return parts.join('');
}

export function extractFolioFromString(text: string): string | null {
  const regex = /(?:(?:fol\.?|f\.?)\s*(\d+(?:r|v|recto|verso)?)|(?:^|\s|\[|\()(\d+(?:r|v|recto|verso)))(?!\w)/i;
  const m = regex.exec(text);
  if (m) {
    return m[1] || m[2];
  }
  return null;
}

export function extractDocumentFolios(root: VM.RootContainer, foliostart?: string): string[] {
  const folios = new Set<string>();
  if (foliostart) folios.add(foliostart);

  const traverse = (node: any) => {
    if (!node || !node.kind) return;

    if (node.kind === VM.LinePartKind.FolioChange) {
      if (node.text) folios.add(node.text);
    } else if (node.kind === VM.ContainerKind.ParatextContainer) {
      const extracted = extractFolioFromString(node.text || '');
      if (extracted) folios.add(extracted);
    }

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child);
      }
    }
    // Also traverse parts for Zeile
    if (node.parts && Array.isArray(node.parts)) {
      for (const part of node.parts) {
        traverse(part);
      }
    }
  };

  traverse(root);
  return Array.from(folios);
}

export function analyzeDocument(
  root: VM.RootContainer,
  sourceId: string = 'Unknown',
  documentId: string = 'Unknown'
): AnalyzedPattern[] {
  const results: AnalyzedPattern[] = [];
  let currentFolio = 'Unknown';
  let currentLineCounter = 1;
  let currentSyllableText = '';

  const traverse = (node: any) => {
    if (!node || !node.kind) return;

    const oldFolio = currentFolio;

    if (node.kind === VM.LinePartKind.FolioChange) {
      currentFolio = node.text || currentFolio;
    }

    if (node.kind === VM.LinePartKind.FolioChange || currentFolio !== oldFolio) {
      currentLineCounter = 1;
    }

    if (node.kind === VM.LinePartKind.LineChange) {
      currentLineCounter++;
    }

    if (node.kind === VM.ContainerKind.ParatextContainer) {
      if (node.text && node.text.includes('|')) {
        currentLineCounter += (node.text.match(/\|/g) || []).length;
      }
      const extracted = extractFolioFromString(node.text || '');
      if (extracted) {
        currentFolio = extracted;
        currentLineCounter = 1;
      }
    }

    if (node.kind === VM.LinePartKind.Syllable) {
      if (node.syllableType !== VM.SyllableType.Normal) return;
      currentSyllableText = node.text || '';

      if (node.notes && node.notes.spaced) {
        for (const spacedItem of node.notes.spaced) {
          if (spacedItem.nonSpaced) {
            for (let idx = 0; idx < spacedItem.nonSpaced.length; idx++) {
              const ns = spacedItem.nonSpaced[idx];
              const patternStr = extractPattern({ nonSpaced: [ns] } as VM.NonSpaced);

              let firstNoteUuid = 'unknown-uuid';
              let noteCount = 0;
              if (ns.grouped && ns.grouped.length > 0) {
                for (const g of ns.grouped) {
                  if (g.uuid && firstNoteUuid === 'unknown-uuid') {
                    firstNoteUuid = g.uuid;
                  }
                  noteCount++;
                }
              }

              if (patternStr && noteCount > 0) {
                results.push({
                  patternId: patternStr,
                  sourceId,
                  documentId,
                  folio: currentFolio,
                  line: String(currentLineCounter),
                  syllable: currentSyllableText,
                  notesCount: noteCount,
                  uuid: firstNoteUuid
                });
              }
            }
          }
        }
      }
      return;
    }

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  };

  traverse(root);
  return results;
}
