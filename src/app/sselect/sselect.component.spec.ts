import { waitForAsync, ComponentFixture, TestBed } from '@angular/core/testing';

import { SselectComponent } from './sselect.component';

describe('SselectComponent', () => {
  let component: SselectComponent<any>;
  let fixture: ComponentFixture<SselectComponent<any>>;

  beforeEach(waitForAsync(() => {
    TestBed.configureTestingModule({
      declarations: [ SselectComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(SselectComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
