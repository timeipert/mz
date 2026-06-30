import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { FolioChangeComponent } from './folio-change.component';
import { FocusService } from '../focus.service';
import { ToolsService } from '../tools.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { UndoService } from '../undoService';

describe('FolioChangeComponent', () => {
  let component: FolioChangeComponent;
  let fixture: ComponentFixture<FolioChangeComponent>;

  const mockFocusService = {
    preferredFocus: 'Notes',
    mode: { kind: 'Normal' }
  };

  const mockToolsService = {
    addStack: () => {},
    remove: () => {}
  };

  const mockNgbModal = {
    open: () => {}
  };

  const mockUndoService = {
    undo: () => {}
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ FolioChangeComponent ],
      providers: [
        { provide: FocusService, useValue: mockFocusService },
        { provide: ToolsService, useValue: mockToolsService },
        { provide: NgbModal, useValue: mockNgbModal },
        { provide: UndoService, useValue: mockUndoService }
      ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(FolioChangeComponent);
    component = fixture.componentInstance;
    component.model = {
      uuid: 'folio-change-1',
      text: '1r',
      focus: false
    } as any;
    component.comments = [];
    component.readOnly = false;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
