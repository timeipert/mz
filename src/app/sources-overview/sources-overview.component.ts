import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { UserService, User } from '../user.service';
import { APIService, UserInfo, Source } from '../api.service'
import { assertNever } from '../../utils';
import { Subscription } from 'rxjs';
import { Header } from '../smart-table/smart-table.component';
import { ToastrService } from 'ngx-toastr';
import * as localforage from 'localforage';

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
    private toastr: ToastrService
  ) {}

  ngOnInit() {
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

}
