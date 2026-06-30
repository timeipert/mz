import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { SselectComponent } from './sselect.component';

describe('SselectComponent', () => {
  let component: SselectComponent<any>;
  let fixture: ComponentFixture<SselectComponent<any>>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ SselectComponent ],
      imports: [ FormsModule ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(SselectComponent);
    component = fixture.componentInstance;
    component.dropdown = {
      getPossibleValues: () => [],
      getValue: () => undefined,
      updateModel: () => {},
      getId: () => '',
      addCallback: () => {}
    };
    component.input = '';
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
