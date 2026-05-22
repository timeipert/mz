import { Component, OnInit } from '@angular/core';
import { v4 as UUID } from "uuid";

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.component.html',
  styleUrls: ['./welcome.component.css']
})
export class WelcomeComponent implements OnInit {
  constructor() { }

  ngOnInit() {
  }
}
