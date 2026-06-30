import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DraggerComponent } from './dragger.component';
import { DragStateService } from './drag-state.service';

describe('DraggerComponent', () => {
  let component: DraggerComponent;
  let fixture: ComponentFixture<DraggerComponent>;

  const mockDragStateService = {
    change$: of(null),
    draggingZipper: null,
    zippersEqual: () => false,
    isValidTarget: () => false,
    startDrag: () => {},
    endDrag: () => {},
    setHovered: () => {}
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ DraggerComponent ],
      providers: [
        { provide: DragStateService, useValue: mockDragStateService }
      ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(DraggerComponent);
    component = fixture.componentInstance;
    component.zipper = [1];
    component.actions = [];
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
