import { BrowserModule } from '@angular/platform-browser';
import { NgModule, isDevMode } from '@angular/core';
import { ServiceWorkerModule } from '@angular/service-worker';
import { FormsModule } from '@angular/forms';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ToastrModule } from 'ngx-toastr';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { ScrollingModule } from '@angular/cdk/scrolling';

import { AppComponent } from './app.component';
import { WelcomeComponent } from './welcome/welcome.component';
// Removed LoginComponent
import { SettingsComponent } from './settings/settings.component';
import { SourcesOverviewComponent } from './sources-overview/sources-overview.component';
import { SourceComponent } from './source/source.component';
import { DocumentComponent } from './document/document.component';
import { UsersOverviewComponent } from './users-overview/users-overview.component';

import { NotesComponent } from './notes/notes.component';
import { RootSectionComponent } from './section/root-section.component';
import { FormteilSectionComponent } from './section/formteil-section.component';
import { MiscSectionComponent } from './section/misc-section.component';
import { ZeileSectionComponent } from './section/zeile-section.component';
import { ParatextSectionComponent } from './section/paratext-section.component';
import { DraggerComponent } from './dragger/dragger.component';
import { LineChangeComponent } from './line-change/line-change.component';
import { FolioChangeComponent } from './folio-change/folio-change.component';
import { SmartTableComponent } from './smart-table/smart-table.component';
import { SselectComponent } from './sselect/sselect.component';
import { ClefComponent } from './clef/clef.component';
import { BoxComponent } from './box/box.component';

import { ConfirmDeactivateGuard } from './ConfirmDeactivateGuard';
import { ZipUploadComponent } from './zip-upload/zip-upload.component';
import { EditSyllableTextComponent } from './edit-syllable-text/edit-syllable-text.component';
import { CommentComponent } from './comment/comment.component';
import { ComplexCommentComponent } from './complex-comment/complex-comment.component';
import { ParatextCommentComponent } from './paratext-comment/paratext-comment.component';
import { CommentTreeComponent } from './complex-comment/comment-tree/comment-tree.component';
import { CommentTreeLeafComponent } from './complex-comment/comment-tree/comment-tree-leaf/comment-tree-leaf.component';
import { CommentTreeUndecidedComponent } from './complex-comment/comment-tree/comment-tree-undecided/comment-tree-undecided.component';
import { CommentTreeGridComponent } from './complex-comment/comment-tree/comment-tree-grid/comment-tree-grid.component';
import { CommentTreeBracketComponent } from './complex-comment/comment-tree/comment-tree-leaf/comment-tree-bracket/comment-tree-bracket.component';
import { CommentTreeTextComponent } from './complex-comment/comment-tree/comment-tree-leaf/comment-tree-text/comment-tree-text.component';
import { CommentTreeNotesComponent } from './complex-comment/comment-tree/comment-tree-leaf/comment-tree-notes/comment-tree-notes.component';
import { CommentTreeActionDotComponent } from './complex-comment/comment-tree/comment-tree-action-dot/comment-tree-action-dot.component';
import { CommentInfoComponent } from './comment/comment-info/comment-info.component';

import { SearchComponent } from './search/search.component';
import { DragMapComponent } from './drag-map/drag-map.component';
import { NotationsdokumentationModule } from './notationsdokumentation/notationsdokumentation.module';
import { HelpButtonComponent } from './help-button/help-button.component';
import { ContextMenuComponent } from './context-menu/context-menu.component';

import { ManualLayoutComponent } from './manual/manual-layout/manual-layout.component';
import { OverviewComponent } from './manual/pages/overview/overview.component';
import { TranscriptionComponent } from './manual/pages/transcription/transcription.component';
import { SearchComponent as ManualSearchComponent } from './manual/pages/search/search.component';
import { ManualHighlightTriggerDirective } from './manual/services/manual-highlight-trigger.directive';
import { IiifComponent } from './manual/pages/iiif/iiif.component';
import { MetadataComponent } from './manual/pages/metadata/metadata.component';
import { UseCasesComponent } from './manual/pages/use-cases/use-cases.component';
import { CommentsComponent } from './manual/pages/comments/comments.component';
import { ManualSettingsComponent } from './manual/pages/settings/settings.component';
import { SubcorporaSelectorComponent } from './sources-overview/subcorpora-selector/subcorpora-selector.component';
import { StatsComponent } from './stats/stats.component';

@NgModule({ declarations: [
        AppComponent,
        WelcomeComponent,
        UsersOverviewComponent,
        SourcesOverviewComponent,
        SubcorporaSelectorComponent,
        SourceComponent,
        DocumentComponent,
        NotesComponent,
        RootSectionComponent,
        FormteilSectionComponent,
        MiscSectionComponent,
        ZeileSectionComponent,
        ParatextSectionComponent,
        DraggerComponent,
        LineChangeComponent,
        FolioChangeComponent,
        SmartTableComponent,
        SselectComponent,
        ClefComponent,
        BoxComponent,
        ZipUploadComponent,
        EditSyllableTextComponent,
        CommentComponent,
        ParatextCommentComponent,
        ComplexCommentComponent,
        CommentTreeComponent,
        CommentTreeLeafComponent,
        CommentTreeUndecidedComponent,
        CommentTreeGridComponent,
        CommentTreeBracketComponent,
        CommentTreeTextComponent,
        CommentTreeNotesComponent,
        CommentTreeActionDotComponent,
        CommentInfoComponent,
        SearchComponent,
        SettingsComponent,
        DragMapComponent,
        HelpButtonComponent,
        ContextMenuComponent,
        ManualLayoutComponent,
        OverviewComponent,
        TranscriptionComponent,
        ManualSearchComponent,
        ManualHighlightTriggerDirective,
        IiifComponent,
        MetadataComponent,
        UseCasesComponent,
        CommentsComponent,
        ManualSettingsComponent,
        StatsComponent
    ],
    bootstrap: [AppComponent], imports: [BrowserModule,
        CommonModule,
        BrowserAnimationsModule,
        ToastrModule.forRoot(),
        FormsModule,
        NotationsdokumentationModule,
        NgbModule,
        DragDropModule,
        ScrollingModule,
        RouterModule.forRoot([
            {
                path: 'login',
                redirectTo: '/sources',
                pathMatch: 'full'
            }, {
                path: 'users',
                component: UsersOverviewComponent,
            }, {
                path: 'sources',
                component: SourcesOverviewComponent,
            }, {
                path: 'source/:id',
                component: SourceComponent,
            }, {
                path: 'source',
                component: SourceComponent,
            }, {
                path: 'document/:source',
                component: DocumentComponent,
            }, {
                path: 'document/:source/:id',
                component: DocumentComponent,
                canDeactivate: [ConfirmDeactivateGuard]
            }, {
                path: 'search',
                component: SearchComponent,
            }, {
                path: 'stats',
                component: StatsComponent,
            }, {
                path: 'settings',
                component: SettingsComponent,
            }, {
                path: 'zip-upload',
                component: ZipUploadComponent,
            }, {
                path: 'cc',
                component: ComplexCommentComponent
            }, {
                path: 'manual',
                component: ManualLayoutComponent,
                children: [
                    { path: '', redirectTo: 'overview', pathMatch: 'full' },
                    { path: 'overview', component: OverviewComponent },
                    { path: 'transcription', component: TranscriptionComponent },
                    { path: 'search', component: ManualSearchComponent },
                    { path: 'iiif', component: IiifComponent },
                    { path: 'metadata', component: MetadataComponent },
                    { path: 'comments', component: CommentsComponent },
                    { path: 'settings', component: ManualSettingsComponent },
                    { path: 'use-cases', component: UseCasesComponent },
                ]
            }, {
                path: '**',
                component: WelcomeComponent
            }
        ], { useHash: true, anchorScrolling: 'enabled' }),
        ServiceWorkerModule.register('ngsw-worker.js', {
          enabled: !isDevMode(),
          registrationStrategy: 'registerWhenStable:30000'
        })
    ], providers: [ConfirmDeactivateGuard, provideHttpClient(withInterceptorsFromDi())] })
export class AppModule { }
