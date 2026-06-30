import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { LineChangeComponent } from './line-change.component';
import { FocusService } from '../focus.service';
import { ToolsService } from '../tools.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { UndoService } from '../undoService';

describe('LineChangeComponent', () => {
  let component: LineChangeComponent;
  let fixture: ComponentFixture<LineChangeComponent>;

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
      declarations: [ LineChangeComponent ],
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
    fixture = TestBed.createComponent(LineChangeComponent);
    component = fixture.componentInstance;
    component.model = {
      uuid: 'line-change-1',
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
