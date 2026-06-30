import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ParatextCommentComponent } from './paratext-comment.component';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';
import { UndoService } from '../undoService';

describe('ParatextCommentComponent', () => {
  let component: ParatextCommentComponent;
  let fixture: ComponentFixture<ParatextCommentComponent>;

  const mockActiveModal = {
    close: () => {},
    dismiss: () => {}
  };

  const mockUndoService = {
    undo: () => {},
    beforeChange: () => {}
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ ParatextCommentComponent ],
      imports: [ FormsModule ],
      providers: [
        { provide: NgbActiveModal, useValue: mockActiveModal },
        { provide: UndoService, useValue: mockUndoService }
      ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ParatextCommentComponent);
    component = fixture.componentInstance;
    component.comment = {
      uuid: 'pt-comment-1',
      text: 'mock comment',
      commentType: 'text'
    } as any;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
