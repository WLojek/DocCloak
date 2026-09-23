import { useEffect, useState } from 'react';
import App from '../../App.tsx';
import { GdprPage } from './GdprPage.tsx';
import { UseCasePage, type UseCaseId } from './UseCasePage.tsx';
import { PolishLanding } from './PolishLanding.tsx';

/**
 * Minimal hash router for the static content pages.
 *
 * The app itself stays a single page: any hash that does not start with
 * "#/" (including the in-page anchors "#tool" and "#how-it-works") renders
 * the tool as before. Content pages live under "#/..." so they need no
 * server-side rewrites on a static host.
 */

const USE_CASES: readonly UseCaseId[] = ['lawyers', 'accountants', 'hr', 'researchers'];

type Route =
  | { kind: 'app' }
  | { kind: 'gdpr' }
  | { kind: 'useCase'; useCase: UseCaseId }
  | { kind: 'pl' };

function parseRoute(hash: string): Route {
  if (!hash.startsWith('#/')) return { kind: 'app' };
  const path = hash.slice(1).replace(/\/+$/, '');
  if (path === '/gdpr' || path === '/rodo') return { kind: 'gdpr' };
  if (path === '/pl') return { kind: 'pl' };
  const useCase = USE_CASES.find((id) => path === `/for/${id}`);
  if (useCase) return { kind: 'useCase', useCase };
  return { kind: 'app' };
}

export function Root() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  switch (route.kind) {
    case 'gdpr':
      return <GdprPage />;
    case 'useCase':
      return <UseCasePage useCase={route.useCase} />;
    case 'pl':
      return <PolishLanding />;
    default:
      return <App />;
  }
}
