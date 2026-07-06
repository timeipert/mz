import { TestBed } from '@angular/core/testing';
import { APIService } from './api.service';

describe('APIService', () => {
  let service: APIService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [APIService]
    });
    service = TestBed.inject(APIService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should initialize storagePersisted as null or boolean', () => {
    // Should be boolean or null depending on browser support in spec runner
    const val = service.storagePersisted;
    expect(val === null || typeof val === 'boolean').toBeTrue();
  });
});
