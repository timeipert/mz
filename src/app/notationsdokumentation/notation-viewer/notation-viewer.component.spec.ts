import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { NotationViewerComponent } from './notation-viewer.component';

describe('NotationViewerComponent', () => {
  let component: NotationViewerComponent;
  let fixture: ComponentFixture<NotationViewerComponent>;

  const mockHttpClient = {
    get: () => of(null)
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [NotationViewerComponent],
      providers: [
        { provide: HttpClient, useValue: mockHttpClient }
      ],
      schemas: [ NO_ERRORS_SCHEMA ]
    });
    fixture = TestBed.createComponent(NotationViewerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
