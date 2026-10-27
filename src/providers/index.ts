// Energy providers the tool can fetch hourly data from. To add one, create src/providers/<id>/ with an
// info.ts (id, name, origin, loginUrl) and a bookmarklet.ts that calls runBookmarklet with a
// fetchHours for that provider's website, then list it here.
import { APP_ORIGIN_PLACEHOLDER } from '../bookmarklet/protocol.ts';
import demoBookmarklet from './demo/bookmarklet.ts?bookmarklet';
import { demo } from './demo/info.ts';
import greenchoiceBookmarklet from './greenchoice/bookmarklet.ts?bookmarklet';
import { greenchoice } from './greenchoice/info.ts';

export interface Provider {
  id: string;
  name: string;
  origin: string;
  loginUrl: string;
  /** Where in the provider's site the visitor should be when clicking the bookmark. */
  where: string;
  bookmarklet: string;
}

export const PROVIDERS: Provider[] = [
  { ...greenchoice, where: 'Mijn Greenchoice', bookmarklet: greenchoiceBookmarklet },
  ...(import.meta.env.DEV ? [{ ...demo, where: 'the demo supplier', bookmarklet: demoBookmarklet }] : []),
];

export function findProvider(id: string): Provider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function bookmarkletHref(provider: Provider, appOrigin: string): string {
  return `javascript:${encodeURIComponent(provider.bookmarklet.replaceAll(APP_ORIGIN_PLACEHOLDER, appOrigin))}`;
}
