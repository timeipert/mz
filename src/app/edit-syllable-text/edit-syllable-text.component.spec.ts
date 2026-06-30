import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { EditSyllableTextComponent } from './edit-syllable-text.component';
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap';

describe('EditSyllableTextComponent', () => {
  let component: EditSyllableTextComponent;
  let fixture: ComponentFixture<EditSyllableTextComponent>;

  const mockActiveModal = {
    close: () => {},
    dismiss: () => {}
  };

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ EditSyllableTextComponent ],
      imports: [ FormsModule ],
      providers: [
        { provide: NgbActiveModal, useValue: mockActiveModal }
      ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(EditSyllableTextComponent);
    component = fixture.componentInstance;
    component.text = 'initial text';
    component.title = 'Edit';
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
