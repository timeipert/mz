import { Component, OnInit } from '@angular/core';
import { PageTitleService } from '../page-title.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.component.html',
  styleUrls: ['./welcome.component.css']
})
export class WelcomeComponent implements OnInit {
  constructor(private pageTitle: PageTitleService, private modalService: NgbModal) { }

  ngOnInit() {
    this.pageTitle.reset(); // Just "Monodi" on the home page
  }

  openCredits(content: any) {
    this.modalService.open(content, { centered: true });
  }
}
