import { Injectable } from '@angular/core';
import * as VM from './types/model';
import { AnalyzedPattern, extractPattern, analyzeDocument, extractDocumentFolios } from './transcription-analyzer-core';

// Re-export so existing consumers of this service don't need to change their imports
export { AnalyzedPattern, extractDocumentFolios } from './transcription-analyzer-core';

@Injectable({ providedIn: 'root' })
export class TranscriptionAnalyzerService {
  constructor() {}

  extractPattern(nonSpaced: VM.NonSpaced): string {
    return extractPattern(nonSpaced);
  }

  analyzeDocument(
    root: VM.RootContainer,
    sourceId: string = 'Unknown',
    documentId: string = 'Unknown'
  ): AnalyzedPattern[] {
    return analyzeDocument(root, sourceId, documentId);
  }

  extractDocumentFolios(root: VM.RootContainer, foliostart?: string): string[] {
    return extractDocumentFolios(root, foliostart);
  }
}
