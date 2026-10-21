import { provideHttpClient, withFetch } from '@angular/common/http';
import { inject, provideBrowserGlobalErrorListeners, type ApplicationConfig } from '@angular/core';
import {
  isActive,
  provideRouter,
  Router,
  TitleStrategy,
  withComponentInputBinding,
  withInMemoryScrolling,
  withViewTransitions,
  type ViewTransitionInfo,
} from '@angular/router';
import { PageTitle } from './core/page-title';
import { routes } from './app.routes';

/** Page changes fade (decision 168); a change of the query only (a panel, a filter) does not. */
function onViewTransition({ transition }: ViewTransitionInfo) {
  const router = inject(Router);
  const target = router.currentNavigation()?.finalUrl;
  const sameQueryOnly =
    target &&
    isActive(target, router, {
      paths: 'exact',
      matrixParams: 'exact',
      fragment: 'ignored',
      queryParams: 'ignored',
    })();
  const still =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (sameQueryOnly || still) transition.skipTransition();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions({
        skipInitialTransition: true,
        onViewTransitionCreated: onViewTransition,
      }),
      // Scroll events only: the app shell scrolls once the page's data is there.
      withInMemoryScrolling(),
    ),
    provideHttpClient(withFetch()),
    { provide: TitleStrategy, useExisting: PageTitle },
  ],
};
