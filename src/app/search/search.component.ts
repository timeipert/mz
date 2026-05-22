import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { APIService, SourceQuery, DocumentQuery, Source, Document, ProjectSettings } from '../api.service';
import { UserService, User } from '../user.service';
import { Subscription } from 'rxjs';

export interface ColDef<T> {
  key: keyof T | string;
  label: string;
  visible: boolean;
}

const DEFAULT_SRC_COLS: ColDef<Source>[] = [
  { key: 'quellensigle',         label: 'Source Siglum',     visible: true  },
  { key: 'datierung',            label: 'Dating',            visible: false },
  { key: 'herkunftsregion',      label: 'Region of Origin',  visible: false },
  { key: 'herkunftsort',         label: 'Place of Origin',   visible: true  },
  { key: 'herkunftsinstitution', label: 'Institution',       visible: true  },
  { key: 'ordenstradition',      label: 'Order Tradition',   visible: false },
  { key: 'quellentyp',           label: 'Source Type',       visible: true  },
  { key: 'bibliotheksort',       label: 'Library Location',  visible: false },
  { key: 'bibliothek',           label: 'Library',           visible: false },
  { key: 'bibliothekssignatur',  label: 'Library Signature', visible: false },
];

const DEFAULT_DOC_COLS: ColDef<Document>[] = [
  { key: 'dokumenten_id',            label: 'Document ID',       visible: true  },
  { key: 'textinitium',              label: 'Text Initium',      visible: true  },
  { key: 'gattung1',                 label: 'Genre 1',           visible: true  },
  { key: 'gattung2',                 label: 'Genre 2',           visible: false },
  { key: 'festtag',                  label: 'Feast Day',         visible: true  },
  { key: 'feier',                    label: 'Celebration',       visible: false },
  { key: 'foliostart',               label: 'Folio Start',       visible: false },
  { key: 'zeilenstart',              label: 'Line Start',        visible: false },
  { key: 'druckausgabe',             label: 'Print Edition',     visible: false },
  { key: 'bibliographischerverweis', label: 'Bibliographic Ref.',visible: false },
  { key: 'editionsstatus',           label: 'Edition Status',    visible: false },
];

const SRC_RES_KEY  = 'monodi_search_src_cols';
const DOC_RES_KEY  = 'monodi_search_doc_cols';

@Component({
  selector: 'app-search',
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.css']
})
export class SearchComponent implements OnInit, OnDestroy {
  activeTab: 'sources' | 'documents' = 'sources';
  user: User | null = null;
  subs: Subscription[] = [];
  
  settings: ProjectSettings | null = null;

  sourceQuery: SourceQuery = {};
  documentQuery: DocumentQuery = {
    dokumenten_id: undefined,
    gattung1: undefined,
    gattung2: undefined,
    festtag: undefined,
    feier: undefined,
    textinitium: undefined,
    bibliographischerverweis: undefined,
    druckausgabe: undefined,
    zeilenstart: undefined,
    foliostart: undefined,
    kommentar: undefined,
  };

  sourceResults: Source[] = [];
  documentResults: Document[] = [];

  // Column visibility
  showSrcColPicker = false;
  showDocColPicker = false;
  srcResultCols: ColDef<Source>[] = [];
  docResultCols: ColDef<Document>[] = [];

  get visibleSrcCols() { return this.srcResultCols.filter(c => c.visible); }
  get visibleDocCols() { return this.docResultCols.filter(c => c.visible); }

  constructor(
    private api: APIService,
    private router: Router,
    private userService: UserService
  ) {
    this.loadCols();
  }

  loadCols() {
    this.srcResultCols = this.loadFromStorage<Source>(SRC_RES_KEY, DEFAULT_SRC_COLS);
    this.docResultCols = this.loadFromStorage<Document>(DOC_RES_KEY, DEFAULT_DOC_COLS);
  }

  private loadFromStorage<T>(key: string, defaults: ColDef<T>[]): ColDef<T>[] {
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const parsed: ColDef<T>[] = JSON.parse(saved);
        return defaults.map(def => {
          const match = parsed.find(p => p.key === def.key);
          return match ? { ...def, visible: match.visible } : def;
        });
      }
    } catch {}
    return defaults.map(c => ({ ...c }));
  }

  saveSrcCols() { localStorage.setItem(SRC_RES_KEY, JSON.stringify(this.srcResultCols)); }
  saveDocCols() { localStorage.setItem(DOC_RES_KEY, JSON.stringify(this.docResultCols)); }

  ngOnInit() {
    this.subs.push(this.userService.user.subscribe(user => {
      this.user = user;
      if (this.user) {
        this.api.getSettings(this.user.token).subscribe(res => {
          if (res.kind === 'SettingsRetrieved') {
            this.settings = res.settings;
          }
        });
      }
    }));
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  searchSources() {
    if (!this.user) return;
    this.api.querySources(this.user.token, this.sourceQuery).subscribe(res => {
      if (res.kind === 'SourcesRetrieved') {
        this.sourceResults = res.sources;
      }
    });
  }

  searchDocuments() {
    if (!this.user) return;
    this.api.queryDocuments(this.user.token, this.documentQuery).subscribe(res => {
      if (res.kind === 'DocumentsRetrieved') {
        this.documentResults = res.documents;
      }
    });
  }

  goToSource(id: string) {
    this.router.navigate(['/source', id]);
  }

  goToDocument(sourceId: string, docId: string) {
    this.router.navigate(['/document', sourceId, docId]);
  }

  addToSettings(category: keyof ProjectSettings, value: string | undefined) {
    if (!value || !value.trim() || !this.settings || !this.user) return;
    const val = value.trim();
    const arr = this.settings[category] as any;
    if (Array.isArray(arr) && !arr.includes(val)) {
      arr.push(val);
      this.api.updateSettings(this.user.token, this.settings).subscribe(() => {
        alert('Erfolgreich zu den Einstellungen hinzugefügt!');
      });
    }
  }
}
