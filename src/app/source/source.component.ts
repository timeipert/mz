import { DoCheck, Component, OnInit, OnDestroy } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { UserService, User } from '../user.service';
import { APIService, UserInfo, Source, Document } from '../api.service'
import { ToastrService } from 'ngx-toastr';
import { ToolsService, Tool } from '../tools.service';
import { assertNever } from '../../utils';
import { Subscription, combineLatest } from 'rxjs';
import * as S from '../sselect/sselect.component';
import { ProjectSettings } from '../api.service';

export interface DocColDef {
  key: keyof Document | string;
  label: string;
  visible: boolean;
}

const DEFAULT_DOC_COLS: DocColDef[] = [
  { key: 'dokumenten_id',          label: 'Document ID',           visible: true  },
  { key: 'textinitium',            label: 'Text Initium',          visible: true  },
  { key: 'gattung1',               label: 'Genre 1',               visible: true  },
  { key: 'gattung2',               label: 'Genre 2',               visible: true  },
  { key: 'festtag',                label: 'Feast Day',             visible: false },
  { key: 'feier',                  label: 'Celebration',           visible: false },
  { key: 'foliostart',             label: 'Folio Start',           visible: false },
  { key: 'zeilenstart',            label: 'Line Start',            visible: false },
  { key: 'druckausgabe',           label: 'Print Edition',         visible: false },
  { key: 'bibliographischerverweis', label: 'Bibliographic Ref.',  visible: false },
  { key: 'editionsstatus',         label: 'Edition Status',        visible: false },
  { key: 'kommentar',              label: 'Comment',               visible: false },
];

const DOC_COLS_KEY = 'monodi_doc_cols';

@Component({
  selector: 'app-source',
  templateUrl: './source.component.html',
  styleUrls: ['./source.component.css']
})
export class SourceComponent implements OnInit {
  subs: Subscription[] = [];
  source: Source | undefined = undefined;
  documents: Document[] = [];
  user: User | null = null;
  settings: ProjectSettings | null = null;
  isSaving = false;

  showDocColPicker = false;
  docCols: DocColDef[] = [];

  get visibleDocCols(): DocColDef[] {
    return this.docCols.filter(c => c.visible);
  }

  loadDocCols() {
    try {
      const saved = localStorage.getItem(DOC_COLS_KEY);
      if (saved) {
        const parsed: DocColDef[] = JSON.parse(saved);
        this.docCols = DEFAULT_DOC_COLS.map(def => {
          const match = parsed.find(p => p.key === def.key);
          return match ? { ...def, visible: match.visible } : def;
        });
      } else {
        this.docCols = DEFAULT_DOC_COLS.map(c => ({ ...c }));
      }
    } catch {
      this.docCols = DEFAULT_DOC_COLS.map(c => ({ ...c }));
    }
  }

  saveDocCols() {
    localStorage.setItem(DOC_COLS_KEY, JSON.stringify(this.docCols));
  }

  constructor(
    private api: APIService,
    private router: Router,
    private userService: UserService,
    private route: ActivatedRoute,
    private toastr: ToastrService,
    private location: Location,
    private toolService: ToolsService) {
    this.loadDocCols();
  }

  ngOnInit() {
    this.subs.push(combineLatest(this.userService.user, this.route.paramMap, (user, params) => ({ user, params })).subscribe(pair => {
      this.user = pair.user;
      if (this.user) {
        this.api.getSettings(this.user.token).subscribe(res => {
          if (res.kind === 'SettingsRetrieved') {
            this.settings = res.settings;
          }
        });
      }
      const id = pair.params.get("id");
      if (id !== null) {
        this.retrieveForId(id);
      } else {
        this.source = {
          id: undefined,
          quellensigle: "",
          herkunftsregion: "",
          herkunftsort: "",
          herkunftsinstitution: "",
          ordenstradition: "",
          quellentyp: "",
          bibliotheksort: "",
          bibliothek: "",
          bibliothekssignatur: "",
          kommentar: "",
          datierung: "",
          custom: {}
        };
      }

    }));
  }

  updateQuellensigle(quellensigle: string) {
    this.toolService.remove(this);
    this.toolService.addStack({
      source: this,
      tools: [
        {
          title: 'Quellensigle: ' + quellensigle
        },
      ]
    });
  }

  retrieveForId(id: string): void {
    if (this.user) {
      this.api.getSource(this.user.token, id).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'SourceNotFound': this.source = undefined; break;
          case 'SourceRetrieved':
            this.source = res.source;
            if (!this.source.custom) this.source.custom = {};
            this.updateQuellensigle(this.source.quellensigle);
            break;
          case 'InsufficientPermissions': this.userService.logout(); break;
          default: assertNever(res);
        }
      });

      this.api.listDocuments(this.user.token).subscribe(res => {
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'DocumentsRetrieved': this.documents = res.documents.filter(d => d.quelle_id === id); break;
          default: assertNever(res);
        }
      });
    }
  }

  save(): void {
    if (this.source) {
      if (this.source.id) {
        this.update();
      } else {
        this.create();
      }
    }
  }

  create(): void {
    if (this.user && this.source && !this.isSaving) {
      this.isSaving = true;
      this.api.createSource(this.user.token, this.source).subscribe(res => {
        this.isSaving = false;
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'SourceCreated': 
            this.toastr.success("Erfolgreich gespeichert.");
            if (this.source) this.source.id = res.id;
            this.location.replaceState('/source/' + res.id);
            break;
          default: assertNever(res);
        }
      });
    }
  }

  update(): void {
    if (this.user && this.source && this.source.id && !this.isSaving) {
      this.isSaving = true;
      this.api.updateSource(this.user.token, this.source).subscribe(res => {
        this.isSaving = false;
        switch (res.kind) {
          case 'LoginRequired': this.userService.logout(); break;
          case 'Ok':
            // Removed toast to prevent spamming on autosave
            if (this.source && this.source.quellensigle) {
              this.updateQuellensigle(this.source.quellensigle);
            }
            break;
          case 'SourceNotFound': this.toastr.error("Es sieht so aus, als wäre die Quelle zwischenzeitlich gelöscht worden"); break;
          default: assertNever(res);
        }
      });
    }
  }

  deleteDocument(d: Document): void {
    if (confirm(`Möchten Sie das Dokument ${d.dokumenten_id} wirklich löschen?`)) {
      if (this.user) {
        this.api.removeDocument(this.user.token, d.id).subscribe(res => {
          if (res.kind === 'Ok') {
            this.toastr.success("Dokument gelöscht.");
            if (this.source?.id) {
              this.retrieveForId(this.source.id);
            }
          }
        });
      }
    }
  }

  addToSettings(category: keyof ProjectSettings, value: string | undefined) {
    if (!value || !value.trim() || !this.settings || !this.user) return;
    const val = value.trim();
    const arr = this.settings[category] as any;
    if (Array.isArray(arr) && !arr.includes(val)) {
      arr.push(val);
      this.api.updateSettings(this.user.token, this.settings).subscribe(() => {
        this.toastr.success(`${val} zu ${category} hinzugefügt`);
      });
    }
  }

  addToSettingsCustom(category: string, value: string | undefined) {
    if (!value || !value.trim() || !this.settings || !this.user) return;
    const val = value.trim();
    if (!this.settings.customLists) this.settings.customLists = {};
    if (!this.settings.customLists[category]) this.settings.customLists[category] = [];
    if (!this.settings.customLists[category].includes(val)) {
      this.settings.customLists[category].push(val);
      this.api.updateSettings(this.user.token, this.settings).subscribe(() => {
        this.toastr.success(`${val} zu ${category} hinzugefügt`);
      });
    }
  }

  ngOnDestroy(): void {
    for (const s of this.subs) {
      s.unsubscribe();
    }
    this.toolService.remove(this);
  }

}

