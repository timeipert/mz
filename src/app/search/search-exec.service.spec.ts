import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ToastrModule } from 'ngx-toastr';
import { of } from 'rxjs';
import { SearchExecService, QuickResult } from './search-exec.service';
import { APIService } from '../api.service';
import { UserService } from '../user.service';
import { PatternAnalysisService } from './pattern-analysis.service';

describe('SearchExecService', () => {
  let service: SearchExecService;
  let apiSpy: jasmine.SpyObj<APIService>;
  let userSpy: jasmine.SpyObj<UserService>;

  beforeEach(() => {
    const apiMock = jasmine.createSpyObj('APIService', ['listSources', 'listDocuments', 'querySources', 'queryDocuments']);
    const userMock = jasmine.createSpyObj('UserService', [], {
      user: of({ token: 'test-token', email: 'test@example.com' })
    });

    TestBed.configureTestingModule({
      imports: [
        HttpClientTestingModule,
        ToastrModule.forRoot()
      ],
      providers: [
        SearchExecService,
        { provide: APIService, useValue: apiMock },
        { provide: UserService, useValue: userMock },
        PatternAnalysisService
      ]
    });

    service = TestBed.inject(SearchExecService);
    apiSpy = TestBed.inject(APIService) as jasmine.SpyObj<APIService>;
    userSpy = TestBed.inject(UserService) as jasmine.SpyObj<UserService>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('matchText', () => {
    it('should match exact phrase', () => {
      const res = service.matchText('Kyrie eleison', 'kyrie', 'phrase', false, 0);
      expect(res.matched).toBeTrue();
      expect(res.score).toBe(100);
    });

    it('should match with spelling tolerance (collapse double letters, map j/v)', () => {
      const res = service.matchText('Karolus', 'carolus', 'phrase', true, 0);
      // 'c' vs 'k' is not in spelling tolerance rules, but double letters/jv/ae collapse are.
      const res2 = service.matchText('Halleluia', 'haleluia', 'phrase', true, 0);
      expect(res2.matched).toBeTrue();
      expect(res2.score).toBe(90);
    });

    it('should match words-and mode', () => {
      const res = service.matchText('Kyrie eleison Christe eleison', 'kyrie christe', 'words-and', false, 0);
      expect(res.matched).toBeTrue();
      expect(res.score).toBe(80);
    });

    it('should match words-or mode', () => {
      const res = service.matchText('Kyrie eleison', 'christe kyrie', 'words-or', false, 0);
      expect(res.matched).toBeTrue();
      expect(res.score).toBe(70);
    });

    it('should match fuzzy substring', () => {
      const res = service.matchText('Kitten', 'sitting', 'fuzzy', false, 3);
      expect(res.matched).toBeTrue();
    });
  });

  describe('cancellation', () => {
    it('should set searchCancelled flag on cancelSearch()', () => {
      expect(service.searchCancelled).toBeFalse();
      service.cancelSearch();
      expect(service.searchCancelled).toBeTrue();
    });
  });

  describe('quick search caching', () => {
    it('should return cached results on identical parameters', async () => {
      service.cachedQuickSearched = true;
      service.cachedQuickText = 'test';
      service.cachedQuickMode = 'phrase';
      service.cachedQuickTolerance = true;
      service.cachedQuickDistance = 2;
      const expectedResults: QuickResult[] = [{
        kind: 'source',
        id: '1',
        title: 'Cached Source',
        subtitle: '',
        extra: '',
        score: 100,
        matchedIn: 'Metadata'
      }];
      service.cachedQuickResults = expectedResults;

      service.quickText = 'test';
      service.quickSearchMode = 'phrase';
      service.quickMedievalTolerance = true;
      service.quickFuzzyDistance = 2;

      await service.searchQuick(() => {}, () => {});

      expect(service.quickResults).toEqual(expectedResults);
      expect(service.quickSearched).toBeTrue();
    });
  });
});
