import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { IiifViewerComponent } from './iiif-viewer.component';

describe('IiifViewerComponent', () => {
  let component: IiifViewerComponent;
  let fixture: ComponentFixture<IiifViewerComponent>;

  const mockHttpClient = {
    get: () => of(null)
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [IiifViewerComponent],
      providers: [
        { provide: HttpClient, useValue: mockHttpClient }
      ],
      schemas: [ NO_ERRORS_SCHEMA ]
    });
    fixture = TestBed.createComponent(IiifViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
