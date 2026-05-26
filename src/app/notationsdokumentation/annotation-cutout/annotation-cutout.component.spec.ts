import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AnnotationCutoutComponent } from './annotation-cutout.component';

describe('AnnotationCutoutComponent', () => {
  let component: AnnotationCutoutComponent;
  let fixture: ComponentFixture<AnnotationCutoutComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [AnnotationCutoutComponent]
    });
    fixture = TestBed.createComponent(AnnotationCutoutComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
