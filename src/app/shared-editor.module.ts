import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';

import { NotesComponent } from './notes/notes.component';
import { RootSectionComponent } from './section/root-section.component';
import { FormteilSectionComponent } from './section/formteil-section.component';
import { MiscSectionComponent } from './section/misc-section.component';
import { ZeileSectionComponent } from './section/zeile-section.component';
import { ParatextSectionComponent } from './section/paratext-section.component';
import { DraggerComponent } from './dragger/dragger.component';
import { LineChangeComponent } from './line-change/line-change.component';
import { FolioChangeComponent } from './folio-change/folio-change.component';
import { ClefComponent } from './clef/clef.component';
import { BoxComponent } from './box/box.component';
import { EditSyllableTextComponent } from './edit-syllable-text/edit-syllable-text.component';

import { CommentTreeComponent } from './complex-comment/comment-tree/comment-tree.component';
import { CommentTreeLeafComponent } from './complex-comment/comment-tree/comment-tree-leaf/comment-tree-leaf.component';
import { CommentTreeUndecidedComponent } from './complex-comment/comment-tree/comment-tree-undecided/comment-tree-undecided.component';
import { CommentTreeGridComponent } from './complex-comment/comment-tree/comment-tree-grid/comment-tree-grid.component';
import { CommentTreeBracketComponent } from './complex-comment/comment-tree/comment-tree-leaf/comment-tree-bracket/comment-tree-bracket.component';
import { CommentTreeTextComponent } from './complex-comment/comment-tree/comment-tree-leaf/comment-tree-text/comment-tree-text.component';
import { CommentTreeNotesComponent } from './complex-comment/comment-tree/comment-tree-leaf/comment-tree-notes/comment-tree-notes.component';
import { CommentTreeActionDotComponent } from './complex-comment/comment-tree/comment-tree-action-dot/comment-tree-action-dot.component';

const COMPONENTS = [
  CommentTreeComponent,
  CommentTreeLeafComponent,
  CommentTreeUndecidedComponent,
  CommentTreeGridComponent,
  CommentTreeBracketComponent,
  CommentTreeTextComponent,
  CommentTreeNotesComponent,
  CommentTreeActionDotComponent,
  RootSectionComponent,
  FormteilSectionComponent,
  MiscSectionComponent,
  ZeileSectionComponent,
  ParatextSectionComponent,
  NotesComponent,
  ClefComponent,
  DraggerComponent,
  BoxComponent,
  LineChangeComponent,
  FolioChangeComponent,
  EditSyllableTextComponent
];

@NgModule({
  declarations: COMPONENTS,
  imports: [
    CommonModule,
    FormsModule,
    DragDropModule,
    NgbModule
  ],
  exports: COMPONENTS
})
export class SharedEditorModule {}
