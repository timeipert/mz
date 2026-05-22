import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { ZipUploadComponent } from './zip-upload.component';

describe('ZipUploadComponent', () => {
  let component: ZipUploadComponent;
  let fixture: ComponentFixture<ZipUploadComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ ZipUploadComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ZipUploadComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
