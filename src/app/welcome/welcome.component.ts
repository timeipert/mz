import { Component, OnInit } from '@angular/core';
import { v4 as UUID } from "uuid";
import { PageTitleService } from '../page-title.service';

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.component.html',
  styleUrls: ['./welcome.component.css']
})
export class WelcomeComponent implements OnInit {
  constructor(private pageTitle: PageTitleService) { }

  ngOnInit() {
    this.pageTitle.reset(); // Just "Monodi" on the home page
  }
}
