// Entry point of the Greenchoice bookmarklet; plugins/bookmarklet.ts bundles it into one string.
import { runBookmarklet } from '../../bookmarklet/runtime.ts';
import { fetchHours } from './api.ts';
import { greenchoice } from './info.ts';

runBookmarklet({ ...greenchoice, fetchHours });
