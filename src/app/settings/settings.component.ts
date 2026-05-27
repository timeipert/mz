import { Component, OnInit, OnDestroy } from '@angular/core';
import { APIService, ProjectSettings, sanitizeSettings } from '../api.service';
import { UserService, User } from '../user.service';
import { GithubService, GithubConfig } from '../github.service';
import { Subscription } from 'rxjs';
import { PageTitleService } from '../page-title.service';

export interface FieldDef { key: string, label: string, isCustom: boolean }

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.css']
})
export class SettingsComponent implements OnInit, OnDestroy {
  activeTab: 'metadata' | 'github' | 'pdf' | 'containers' | 'editor' = 'metadata';
  previewScale = 0.6;
  user: User | null = null;
  subs: Subscription[] = [];
  settings: ProjectSettings | null = null;

  onSettingsChange() {
    if (this.settings) {
      sanitizeSettings(this.settings);
    }
    this.saveSettings();
  }

  sourceFields: FieldDef[] = [
    { key: 'quellensigle', label: 'Source Siglum', isCustom: false },
    { key: 'herkunftsregion', label: 'Region of Origin', isCustom: false },
    { key: 'herkunftsort', label: 'Place of Origin', isCustom: false },
    { key: 'herkunftsinstitution', label: 'Institution of Origin', isCustom: false },
    { key: 'ordenstradition', label: 'Order Tradition', isCustom: false },
    { key: 'quellentyp', label: 'Source Type', isCustom: false },
    { key: 'bibliotheksort', label: 'Library Location', isCustom: false },
    { key: 'bibliothek', label: 'Library', isCustom: false },
    { key: 'bibliothekssignatur', label: 'Library Signature', isCustom: false }
  ];

  documentFields: FieldDef[] = [
    { key: 'gattung1', label: 'Genre 1', isCustom: false },
    { key: 'gattung2', label: 'Genre 2', isCustom: false },
    { key: 'festtag', label: 'Feast Day', isCustom: false },
    { key: 'feier', label: 'Feast', isCustom: false }
  ];

  selectedField: FieldDef | null = null;
  newValues: { [key: string]: string } = {};

  newCustomFieldLabel = '';
  newCustomFieldType: 'source' | 'document' = 'source';

  newProfileGattung1 = '';
  newProfileGattung2 = '';
  newProfileLevel1 = '';
  newProfileLevel2 = '';
  newProfileLevel3 = '';

  githubConfig: GithubConfig = { token: '', owner: '', repo: '', branch: 'main' };
  isGithubConnecting = false;

  constructor(
    private api: APIService,
    private userService: UserService,
    public github: GithubService,
    private pageTitle: PageTitleService
  ) {
    if (this.github.config) {
      this.githubConfig = { ...this.github.config };
    }
  }

  ngOnInit() {
    this.pageTitle.set('Settings');
    this.subs.push(this.userService.user.subscribe(user => {
      this.user = user;
      if (this.user) {
        this.api.getSettings(this.user.token).subscribe(res => {
          if (res.kind === 'SettingsRetrieved') {
            this.settings = res.settings;
            if (!this.settings.customSourceFields) this.settings.customSourceFields = [];
            if (!this.settings.customDocumentFields) this.settings.customDocumentFields = [];
            if (!this.settings.customLists) this.settings.customLists = {};
          }
        });
      }
    }));
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  get allSourceFields(): FieldDef[] {
    if (!this.settings) return this.sourceFields;
    const custom = (this.settings.customSourceFields || []).map(f => ({ ...f, isCustom: true }));
    return [...this.sourceFields, ...custom];
  }

  get allDocumentFields(): FieldDef[] {
    if (!this.settings) return this.documentFields;
    const custom = (this.settings.customDocumentFields || []).map(f => ({ ...f, isCustom: true }));
    return [...this.documentFields, ...custom];
  }

  selectField(field: FieldDef) {
    this.selectedField = field;
    if (this.newValues[field.key] === undefined) {
      this.newValues[field.key] = '';
    }
  }

  getList(field: FieldDef): string[] {
    if (!this.settings) return [];
    if (field.isCustom) {
      if (!this.settings.customLists) this.settings.customLists = {};
      if (!this.settings.customLists[field.key]) this.settings.customLists[field.key] = [];
      return this.settings.customLists[field.key];
    } else {
      return (this.settings as any)[field.key] || [];
    }
  }

  addValue() {
    if (!this.selectedField || !this.settings || !this.user) return;
    const value = this.newValues[this.selectedField.key];
    if (value && value.trim()) {
      const valTrimmed = value.trim();
      const list = this.getList(this.selectedField);
      if (!list.includes(valTrimmed)) {
        list.push(valTrimmed);
        list.sort((a, b) => a.localeCompare(b));
        this.saveSettings();
        this.newValues[this.selectedField.key] = '';
      }
    }
  }

  removeValue(value: string) {
    if (!this.selectedField || !this.settings || !this.user) return;
    const list = this.getList(this.selectedField);
    const index = list.indexOf(value);
    if (index !== -1) {
      list.splice(index, 1);
      this.saveSettings();
    }
  }

  addCustomField() {
    if (!this.newCustomFieldLabel.trim() || !this.settings) return;
    const key = this.newCustomFieldLabel.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    const field = { key, label: this.newCustomFieldLabel.trim() };
    
    if (this.newCustomFieldType === 'source') {
      if (!this.settings.customSourceFields) this.settings.customSourceFields = [];
      if (this.settings.customSourceFields.find(f => f.key === key)) return;
      this.settings.customSourceFields.push(field);
    } else {
      if (!this.settings.customDocumentFields) this.settings.customDocumentFields = [];
      if (this.settings.customDocumentFields.find(f => f.key === key)) return;
      this.settings.customDocumentFields.push(field);
    }
    
    if (!this.settings.customLists) this.settings.customLists = {};
    this.settings.customLists[key] = [];
    
    this.saveSettings();
    this.newCustomFieldLabel = '';
    this.selectField({ ...field, isCustom: true });
  }

  addGenreProfile() {
    if (!this.settings) return;
    if (!this.settings.genreLevelProfiles) this.settings.genreLevelProfiles = [];
    this.settings.genreLevelProfiles.push({
      id: Math.random().toString(36).substr(2, 9),
      gattung1: this.newProfileGattung1.trim(),
      gattung2: this.newProfileGattung2.trim(),
      names: {
        level1: this.newProfileLevel1.trim(),
        level2: this.newProfileLevel2.trim(),
        level3: this.newProfileLevel3.trim()
      }
    });
    this.saveSettings();
    this.newProfileGattung1 = '';
    this.newProfileGattung2 = '';
    this.newProfileLevel1 = '';
    this.newProfileLevel2 = '';
    this.newProfileLevel3 = '';
  }

  removeGenreProfile(id: string) {
    if (!this.settings || !this.settings.genreLevelProfiles) return;
    this.settings.genreLevelProfiles = this.settings.genreLevelProfiles.filter(p => p.id !== id);
    this.saveSettings();
  }

  get availableHeadlineFields(): FieldDef[] {
    const std = [
      { key: 'dokumenten_id', label: 'Document ID', isCustom: false },
      { key: 'textinitium', label: 'Textinitium (Title)', isCustom: false },
      ...this.documentFields
    ];
    const custom = (this.settings?.customDocumentFields || []).map(f => ({ ...f, isCustom: true }));
    return [...std, ...custom];
  }

  get availableHeaderFields(): FieldDef[] {
    return this.availableHeadlineFields;
  }

  isFieldSelectedInHeadline(key: string): boolean {
    if (!this.settings || !this.settings.pdfHeadlineMetadataFields) return false;
    return this.settings.pdfHeadlineMetadataFields.includes(key);
  }

  toggleFieldInHeadline(key: string): void {
    if (!this.settings) return;
    if (!this.settings.pdfHeadlineMetadataFields) {
      this.settings.pdfHeadlineMetadataFields = [];
    }
    const idx = this.settings.pdfHeadlineMetadataFields.indexOf(key);
    if (idx > -1) {
      this.settings.pdfHeadlineMetadataFields.splice(idx, 1);
    } else {
      this.settings.pdfHeadlineMetadataFields.push(key);
    }
    this.onSettingsChange();
  }

  get mockupHeaderValue(): string {
    const src = this.settings?.pdfHeaderSource || 'textinitium';
    if (src === 'dokumenten_id') return 'GL-01-01';
    if (src === 'textinitium') return 'Gloria in excelsis';
    if (src === 'gattung1') return 'Gloria';
    if (src === 'gattung2') return 'Introductory Rites';
    if (src === 'festtag') return 'Christmas';
    if (src === 'feier') return 'Main Mass';
    return 'Gloria in excelsis';
  }

  get mockupHeadlineText(): string {
    const fields = this.settings?.pdfHeadlineMetadataFields || [];
    if (fields.length === 0) return '';
    const parts: string[] = [];
    for (const f of fields) {
      let label = '';
      let val = '';
      if (f === 'dokumenten_id') { label = 'ID'; val = 'GL-01-01'; }
      else if (f === 'textinitium') { label = 'Initium'; val = 'Gloria in excelsis'; }
      else if (f === 'gattung1') { label = 'Genre 1'; val = 'Gloria'; }
      else if (f === 'gattung2') { label = 'Genre 2'; val = 'Introductory Rites'; }
      else if (f === 'festtag') { label = 'Feast Day'; val = 'Christmas'; }
      else if (f === 'feier') { label = 'Feast'; val = 'Main Mass'; }
      else {
        const custom = (this.settings?.customDocumentFields || []).find(x => x.key === f);
        label = custom ? custom.label : f;
        val = 'Sample';
      }
      parts.push(`${label}: ${val}`);
    }
    return parts.join('   •   ');
  }

  private saveSettings() {
    if (!this.settings || !this.user) return;
    this.api.updateSettings(this.user.token, this.settings).subscribe();
  }

  async connectGithub() {
    this.isGithubConnecting = true;
    this.github.saveConfig(this.githubConfig);
    const success = await this.github.testConnection();
    this.isGithubConnecting = false;
    if (!success) {
      this.github.clearConfig();
      alert('GitHub connection failed. Please check your token and repository details.');
    } else {
      alert('GitHub connected successfully! Use the Sync button in the top navigation bar to push or pull data.');
    }
  }

  disconnectGithub() {
    this.github.clearConfig();
    this.githubConfig = { token: '', owner: '', repo: '', branch: 'main' };
  }
}
