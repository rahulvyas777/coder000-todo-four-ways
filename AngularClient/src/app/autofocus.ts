import { AfterViewInit, Directive, ElementRef, inject } from '@angular/core';

/**
 * Focuses (and selects) an inline editor as soon as it is rendered. It runs in the change
 * detection that creates the input, so a caller that renders synchronously (detectChanges)
 * gets the focus before the next keystroke arrives.
 */
@Directive({ selector: 'input[appAutofocus]' })
export class Autofocus implements AfterViewInit {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;

  ngAfterViewInit(): void {
    this.el.focus();
    this.el.select();
  }
}
