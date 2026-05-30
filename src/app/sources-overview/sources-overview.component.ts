import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { UserService, User } from '../user.service';
import { APIService, UserInfo, Source } from '../api.service'
import { assertNever } from '../../utils';
import { Subscription, firstValueFrom } from 'rxjs';
import { Header } from '../smart-table/smart-table.component';
import { ToastrService } from 'ngx-toastr';
import * as localforage from 'localforage';
import { PageTitleService } from '../page-title.service';
import * as JSZip from 'jszip';
import * as Handlebars from 'handlebars';

export interface SourceColDef {
  key: keyof Source | string;
  label: string;
  visible: boolean;
}

const DEFAULT_SOURCE_COLS: SourceColDef[] = [
  { key: 'quellensigle',         label: 'Source Siglum',       visible: true  },
  { key: 'datierung',            label: 'Dating',              visible: true  },
  { key: 'herkunftsregion',      label: 'Region of Origin',    visible: false },
  { key: 'herkunftsort',         label: 'Place of Origin',     visible: true  },
  { key: 'herkunftsinstitution', label: 'Institution',         visible: true  },
  { key: 'ordenstradition',      label: 'Order Tradition',     visible: false },
  { key: 'quellentyp',           label: 'Source Type',         visible: true  },
  { key: 'bibliotheksort',       label: 'Library Location',    visible: false },
  { key: 'bibliothek',           label: 'Library',             visible: false },
  { key: 'bibliothekssignatur',  label: 'Library Signature',   visible: false },
  { key: 'kommentar',            label: 'Comment',             visible: false },
];

const STORAGE_KEY = 'monodi_source_cols';

@Component({
  selector: 'app-sources-overview',
  templateUrl: './sources-overview.component.html',
  styleUrls: ['./sources-overview.component.css']
})
export class SourcesOverviewComponent implements OnInit, OnDestroy {
  subs: Subscription[] = [];
  sources: Source[] = [];
  user: User | null = null;

  showColPicker = false;
  cols: SourceColDef[] = [];

  showHtmlExportDialog = false;
  isGeneratingHtml = false;
  exportSelection: {source: any, documents: any[], selected: boolean, expanded: boolean, visible: boolean}[] = [];
  exportFilterText = '';
  exportStatusMessage = '';
  renderingDocument: any = null;
  
  exportDocCols = [
    { key: 'textinitium', label: 'Text Initium', visible: true },
    { key: 'dokumenten_id', label: 'Document ID', visible: true },
    { key: 'gattung1', label: 'Genre', visible: true },
    { key: 'festtag1', label: 'Feast Day', visible: false },
    { key: 'liturgischer_status', label: 'Status', visible: false }
  ];

  get isOnline(): boolean {
    return navigator.onLine;
  }

  get headers(): Header<Source>[] {
    return this.cols
      .filter(c => c.visible)
      .map(c => ({
        name: c.label,
        makeCell: (x: Source) => ({ kind: 'text' as const, text: (x as any)[c.key] ?? '' })
      }));
  }

  constructor(
    private api: APIService,
    private router: Router,
    private userService: UserService,
    private toastr: ToastrService,
    private pageTitle: PageTitleService,
    private cdRef: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.pageTitle.set('Sources');
    this.loadCols();
    this.subs.push(this.userService.user.subscribe(u => {
      this.user = u;
      this.updateList();
    }));
  }

  loadCols() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed: SourceColDef[] = JSON.parse(saved);
        // Merge saved visibility into defaults (supports new columns added later)
        this.cols = DEFAULT_SOURCE_COLS.map(def => {
          const match = parsed.find(p => p.key === def.key);
          return match ? { ...def, visible: match.visible } : def;
        });
      } else {
        this.cols = DEFAULT_SOURCE_COLS.map(c => ({ ...c }));
      }
    } catch {
      this.cols = DEFAULT_SOURCE_COLS.map(c => ({ ...c }));
    }
  }

  saveCols() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.cols));
  }

  updateList(): void {
    if (this.user) {
      this.api.listSources(this.user.token).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'SourcesRetrieved': this.sources = res.sources; break;
          default: assertNever(res);
        }
      });
    }
  }

  ngOnDestroy(): void {
    for (const s of this.subs) {
      s.unsubscribe();
    }
  }

  goToSource(s: Source) {
    this.router.navigate(['/source', s.id]);
  }

  delete(s: Source): void {
    if (confirm(`Are you sure you want to permanently delete the source ${s.quellensigle}? \n\nWARNING: This will also delete all documents and annotations belonging to this source!`)) {
      if (this.user && s.id) {
        this.api.deleteSources(this.user.token, JSON.stringify([s.id])).subscribe(res => {
          if (res.kind === 'UploadFinished') {
            this.toastr.success("Source successfully deleted.");
            this.updateList();
          } else {
            this.toastr.error("Error deleting source.");
          }
        });
      }
    }
  }

  async exportWorkspace() {
    try {
      const sources = await localforage.getItem('monodi_sources');
      const documents = await localforage.getItem('monodi_documents');
      const notes = await localforage.getItem('monodi_notes');
      const settings = await localforage.getItem('monodi_settings');
      
      const data = {
        sources,
        documents,
        notes,
        settings
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workspace_export_${new Date().toISOString().split('T')[0]}.monodijson`;
      a.click();
      window.URL.revokeObjectURL(url);
      this.toastr.success("Workspace erfolgreich exportiert.");
    } catch (e) {
      this.toastr.error("Fehler beim Exportieren: " + e);
    }
  }

  triggerImport() {
    document.getElementById('importFile')?.click();
  }

  importWorkspace(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);
        
        if (data.sources) await localforage.setItem('monodi_sources', data.sources);
        if (data.documents) await localforage.setItem('monodi_documents', data.documents);
        if (data.notes) await localforage.setItem('monodi_notes', data.notes);
        if (data.settings) await localforage.setItem('monodi_settings', data.settings);
        
        this.toastr.success("Workspace erfolgreich importiert.");
        this.updateList();
      } catch (err) {
        this.toastr.error("Fehler beim Importieren: " + err);
      }
      
      event.target.value = '';
    };
    reader.readAsText(file);
  }

  triggerOmmrImport() {
    document.getElementById('importOmmrFile')?.click();
  }

  importOmmrZip(event: any) {
    const file = event.target.files[0];
    if (!file) return;

    this.toastr.info("Parsing OMMR zip file...");

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;
        const zip = await JSZip.loadAsync(arrayBuffer);

        let sources = (await localforage.getItem<Source[]>('monodi_sources')) || [];
        let documents = (await localforage.getItem<any[]>('monodi_documents')) || [];
        let notes = (await localforage.getItem<any>('monodi_notes')) || {};

        let newDocsCount = 0;
        let updatedSourcesCount = 0;

        // Collect all source and document directories
        const metaFiles: JSZip.JSZipObject[] = [];
        zip.forEach((relativePath, zipEntry) => {
          if (!zipEntry.dir && relativePath.endsWith('meta.json') && relativePath.startsWith('export/')) {
            metaFiles.push(zipEntry);
          }
        });

        // First handle sources
        for (const metaFile of metaFiles) {
          const parts = metaFile.name.split('/');
          // export/Source_ID/meta.json
          if (parts.length === 3 && parts[2] === 'meta.json') {
            const content = await metaFile.async('string');
            const ommrSource = JSON.parse(content);

            const existingSource = sources.find(s => s.id === ommrSource.id);
            if (!existingSource) {
              const newSource: Source = {
                id: ommrSource.id,
                quellensigle: ommrSource.quellensigle || ommrSource.id,
                herkunftsregion: ommrSource.herkunftsregion || '',
                herkunftsort: ommrSource.herkunftsort || '',
                herkunftsinstitution: ommrSource.herkunftsinstitution || '',
                ordenstradition: ommrSource.ordenstradition || '',
                quellentyp: ommrSource.quellentyp || '',
                bibliotheksort: ommrSource.bibliotheksort || '',
                bibliothek: ommrSource.bibliothek || '',
                bibliothekssignatur: ommrSource.bibliothekssignatur || '',
                kommentar: ommrSource.kommentar || '',
                datierung: ommrSource.datierung || ''
              };
              sources.push(newSource);
              updatedSourcesCount++;
            }
          }
        }

        // Then handle documents
        for (const metaFile of metaFiles) {
          const parts = metaFile.name.split('/');
          // export/Source_ID/Document_ID/meta.json
          if (parts.length === 4 && parts[3] === 'meta.json') {
            const content = await metaFile.async('string');
            const ommrDoc = JSON.parse(content);
            const sourceId = parts[1];
            const docId = parts[2];

            const dataFile = zip.file(`export/${sourceId}/${docId}/data.json`);
            if (dataFile) {
              const dataContent = await dataFile.async('string');
              const docData = JSON.parse(dataContent);

              const existingDocIndex = documents.findIndex(d => d.id === docId);
              const newDoc = {
                id: ommrDoc.id || docId,
                quelle_id: ommrDoc.source_id || sourceId,
                dokumenten_id: ommrDoc.document_id || docId,
                gattung1: ommrDoc.genre || '',
                gattung2: '',
                festtag: ommrDoc.festum || '',
                feier: ommrDoc.dies || '',
                textinitium: ommrDoc.textinitium || '',
                bibliographischerverweis: '',
                druckausgabe: '',
                zeilenstart: ommrDoc.rowstart || '',
                foliostart: ommrDoc.foliostart || '',
                kommentar: '',
                editionsstatus: '',
                custom: ommrDoc.additionalData || {}
              };

              if (existingDocIndex >= 0) {
                documents[existingDocIndex] = newDoc;
              } else {
                documents.push(newDoc);
              }
              notes[newDoc.id] = docData;
              newDocsCount++;
            }
          }
        }

        await localforage.setItem('monodi_sources', sources);
        await localforage.setItem('monodi_documents', documents);
        await localforage.setItem('monodi_notes', notes);

        this.toastr.success(`Imported ${newDocsCount} documents and ${updatedSourcesCount} new sources.`);
        this.updateList();
      } catch (err) {
        this.toastr.error("Error parsing OMMR zip: " + err);
      }

      event.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  }

  async openHtmlExportDialog() {
    this.exportSelection = [];
    this.exportFilterText = '';
    const allDocs = await localforage.getItem<any[]>('monodi_documents') || [];
    
    for (const source of this.sources) {
      const docsForSource = allDocs.filter((d: any) => d.quelle_id === source.id);
      this.exportSelection.push({
        source,
        selected: true,
        expanded: false,
        visible: true,
        documents: docsForSource.map((doc: any) => ({
          document: doc,
          selected: true,
          visible: true
        }))
      });
    }
    
    this.showHtmlExportDialog = true;
  }

  closeHtmlExportDialog() {
    this.showHtmlExportDialog = false;
  }

  selectAllExport() {
    this.exportSelection.forEach(src => {
      if (src.visible) {
        src.selected = true;
        src.documents.forEach((d: any) => { if (d.visible) d.selected = true; });
      }
    });
  }

  selectNoneExport() {
    this.exportSelection.forEach(src => {
      if (src.visible) {
        src.selected = false;
        src.documents.forEach((d: any) => { if (d.visible) d.selected = false; });
      }
    });
  }

  applyExportFilter() {
    const filter = this.exportFilterText.toLowerCase();
    this.exportSelection.forEach(src => {
      const srcMatches = (src.source.quellensigle || '').toLowerCase().includes(filter);
      let hasVisibleDocs = false;
      
      src.documents.forEach((d: any) => {
        const docMatches = (d.document.textinitium || d.document.dokumenten_id || '').toLowerCase().includes(filter) ||
                           (d.document.gattung1 || '').toLowerCase().includes(filter);
        d.visible = srcMatches || docMatches;
        if (d.visible) hasVisibleDocs = true;
      });
      
      src.visible = srcMatches || hasVisibleDocs;
    });
  }

  toggleSourceSelection(sourceNode: any) {
    sourceNode.documents.forEach((d: any) => {
      if (d.visible) d.selected = sourceNode.selected;
    });
  }

  checkSourceSelection(sourceNode: any) {
    const visibleDocs = sourceNode.documents.filter((d: any) => d.visible);
    if (visibleDocs.length === 0) return;
    
    const allSelected = visibleDocs.every((d: any) => d.selected);
    const noneSelected = visibleDocs.every((d: any) => !d.selected);
    
    if (allSelected) sourceNode.selected = true;
    else if (noneSelected) sourceNode.selected = false;
    else sourceNode.selected = false;
  }

  getMetadataLabel(key: string): string {
    if (key === 'quellensigle') return 'Source Siglum';
    if (key === 'herkunftsort') return 'Place of Origin';
    if (key === 'herkunftsregion') return 'Region of Origin';
    if (key === 'herkunftsinstitution') return 'Institution';
    if (key === 'ordenstradition') return 'Order Tradition';
    if (key === 'quellentyp') return 'Source Type';
    if (key === 'bibliotheksort') return 'Library Location';
    if (key === 'bibliothek') return 'Library';
    if (key === 'bibliothekssignatur') return 'Library Signature';
    if (key === 'datierung') return 'Dating';
    if (key === 'kommentar') return 'Comment';
    if (key === 'dokumenten_id') return 'ID';
    if (key === 'textinitium') return 'Initium';
    if (key === 'gattung1') return 'Genre 1';
    if (key === 'gattung2') return 'Genre 2';
    if (key === 'festtag') return 'Feast Day';
    if (key === 'feier') return 'Feast';
    return key;
  }

  async fetchTemplate(name: string): Promise<string> {
    try {
      const res = await fetch(`assets/export-templates/${name}.hbs`);
      return await res.text();
    } catch (e) {
      console.error(`Failed to fetch template ${name}`, e);
      return '';
    }
  }

  getGlobalCss(): string {
    let cssText = '';
    for (let i = 0; i < document.styleSheets.length; i++) {
      try {
        const sheet = document.styleSheets[i];
        if (sheet.href && sheet.href.includes('fonts.googleapis.com')) continue;
        const rules = sheet.cssRules || sheet.rules;
        for (let j = 0; j < rules.length; j++) {
          cssText += rules[j].cssText + '\n';
        }
      } catch (e) {
        // Ignore CORS errors from external stylesheets
      }
    }
    return cssText;
  }

  async generateHtmlEdition() {
    this.isGeneratingHtml = true;
    try {
      this.exportStatusMessage = "Loading templates and data...";
      const zip = new JSZip();
      const notes = await localforage.getItem<any>('monodi_notes') || {};
      
      const indexTpl = Handlebars.compile(await this.fetchTemplate('index'));
      const sourceTpl = Handlebars.compile(await this.fetchTemplate('source'));
      const docTpl = Handlebars.compile(await this.fetchTemplate('document'));
      const globalCss = this.getGlobalCss();
      
      let settings: any = {};
      try {
        if (this.user) {
          const settingsRes = await firstValueFrom(this.api.getSettings(this.user.token));
          if (settingsRes.kind === 'SettingsRetrieved') settings = settingsRes.settings;
        }
      } catch (e) {
        console.warn("Could not fetch settings for HTML export", e);
      }
      const customCss = settings.htmlExportCustomCss || '';
      const frontpageHtml = settings.htmlExportFrontpageHtml || '';
      const headerHtml = settings.htmlExportHeaderHtml || '';
      const footerHtml = settings.htmlExportFooterHtml || '';
      
      this.exportStatusMessage = "Bundling SVG Assets...";
      const GLYPHS = [
        'flat.svg', 'flat-focused.svg', 'natural.svg', 'natural-focused.svg', 'sharp.svg', 'sharp-focused.svg', 
        'note.svg', 'note-focused.svg', 'ascending.svg', 'ascending-focused.svg', 'descending.svg', 'descending-focused.svg', 
        'oriscus.svg', 'oriscus-focused.svg', 'strophicus.svg', 'strophicus-focused.svg', 'quilisma.svg', 'quilisma-focused.svg'
      ];
      for (const glyph of GLYPHS) {
        try {
          const res = await fetch(`assets/glyphs/${glyph}`);
          if (res.ok) {
            zip.file(`assets/glyphs/${glyph}`, await res.blob());
          }
        } catch(e) { console.warn('Could not fetch glyph', glyph); }
      }
      
      let allExportedDocs: any[] = [];
      let docsToProcess: {source: any, doc: any}[] = [];
      
      for (const srcNode of this.exportSelection) {
        for (const docNode of srcNode.documents) {
          if (docNode.selected) {
            docsToProcess.push({ source: srcNode.source, doc: docNode.document });
          }
        }
      }

      // Step 1: Headless Render loop
      const renderedHtmlMap = new Map<string, string>();
      let i = 0;
      for (const item of docsToProcess) {
        i++;
        this.exportStatusMessage = `Rendering SVGs for document ${i} of ${docsToProcess.length} (${item.doc.textinitium || item.doc.id})...`;
        const docData = notes[item.doc.id];
        if (!docData) continue;
        
        // Feed JSON to the hidden container
        this.renderingDocument = docData;
        this.cdRef.detectChanges(); // Force angular to detect changes
        
        // Give Angular time to construct the DOM
        await new Promise(r => setTimeout(r, 100));
        
        // Capture HTML
        const container = document.getElementById('export-render-container');
        if (container) {
          renderedHtmlMap.set(item.doc.id, container.innerHTML);
        }
      }
      
      this.renderingDocument = null; // Clean up
      
      this.exportStatusMessage = "Generating HTML pages...";
      // Step 2: Generate Source and Document files
      for (const srcNode of this.exportSelection) {
        const selectedDocs = srcNode.documents.filter((d: any) => d.selected).map((d: any) => d.document);
        if (selectedDocs.length > 0) {
          
          for (const doc of selectedDocs) {
            allExportedDocs.push({
              id: doc.id,
              quelle_id: doc.quelle_id,
              title: doc.textinitium || doc.dokumenten_id || 'Untitled',
              genre: doc.gattung1 || '',
              date: doc.festtag || '',
              sourceName: srcNode.source.quellensigle || srcNode.source.id
            });
            
            let docMetadata = Object.entries(doc)
              .filter(([k, v]) => v && k !== 'custom' && typeof v !== 'object')
              .filter(([k, _]) => !settings.htmlExportDocumentMetadata || settings.htmlExportDocumentMetadata.includes(k))
              .map(([k, v]) => ({ label: this.getMetadataLabel(k), value: v }));
              
            if (doc.custom && typeof doc.custom === 'object') {
              for (const [k, v] of Object.entries(doc.custom)) {
                if (v && typeof v !== 'object') {
                  docMetadata.push({ label: k, value: v });
                }
              }
            }
              
            let renderedHtml = renderedHtmlMap.get(doc.id) || '<div class="alert alert-warning">No visual data rendered.</div>';
            // Rewrite asset paths for the subdirectory
            renderedHtml = renderedHtml.replace(/assets\/glyphs\//g, '../assets/glyphs/');
            
            const docHtml = docTpl({
              document: { id: doc.id, title: doc.textinitium || doc.dokumenten_id || 'Untitled Document' },
              metadata: docMetadata,
              renderedHtml: renderedHtml,
              sourceId: srcNode.source.id,
              rawJsonData: JSON.stringify(notes[doc.id] || {}),
              globalCss,
              customCss,
              headerHtml,
              footerHtml
            });
            
            zip.file(`${srcNode.source.id}/${doc.id}.html`, docHtml);
          }
          
          let sourceMetadata = Object.entries(srcNode.source)
            .filter(([k, v]) => v && k !== 'id' && typeof v !== 'object')
            .filter(([k, _]) => !settings.htmlExportSourceMetadata || settings.htmlExportSourceMetadata.includes(k))
            .map(([k, v]) => ({ label: this.getMetadataLabel(k), value: v }));
            
          const sourceHtml = sourceTpl({
            source: srcNode.source,
            metadata: sourceMetadata,
            documents: selectedDocs.map((d: any) => ({
              id: d.id,
              title: d.textinitium || d.dokumenten_id || 'Untitled',
              genre: d.gattung1 || '',
              date: d.festtag || ''
            })),
            globalCss,
            customCss,
            headerHtml,
            footerHtml
          });
          
          zip.file(`source_${srcNode.source.id}.html`, sourceHtml);
        }
      }
      
      // Step 3: Generate Index
      this.exportStatusMessage = "Finalizing ZIP file...";
      
      const sourceList = this.exportSelection
        .filter(srcNode => srcNode.documents.some((d: any) => d.selected))
        .map(srcNode => {
          const metadata = Object.entries(srcNode.source)
            .filter(([k, v]) => v && k !== 'id')
            .filter(([k, _]) => !settings.htmlExportSourceMetadata || settings.htmlExportSourceMetadata.includes(k))
            .map(([k, v]) => ({ label: this.getMetadataLabel(k), value: v }));
          
          return {
            id: srcNode.source.id,
            title: srcNode.source.quellensigle || srcNode.source.id,
            metadata: metadata,
            documents: srcNode.documents
              .filter((d: any) => d.selected)
              .map((d: any) => ({
                id: d.document.id,
                title: d.document.textinitium || d.document.dokumenten_id || 'Untitled Document'
              }))
          };
      });

      const idxHtml = indexTpl({
        generationDate: new Date().toLocaleDateString(),
        totalDocuments: allExportedDocs.length,
        sources: sourceList,
        globalCss,
        customCss,
        frontpageHtml,
        footerHtml
      });
      zip.file(`index.html`, idxHtml);
      
      // Download
      const blob = await zip.generateAsync({ type: "blob" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `monodi_static_edition_${new Date().toISOString().split('T')[0]}.zip`;
      a.click();
      window.URL.revokeObjectURL(url);
      
      this.toastr.success("HTML Edition exported successfully!");
      this.closeHtmlExportDialog();
    } catch (e) {
      this.toastr.error("Error generating HTML export: " + e);
      console.error(e);
    } finally {
      this.isGeneratingHtml = false;
      this.renderingDocument = null;
    }
  }

}
