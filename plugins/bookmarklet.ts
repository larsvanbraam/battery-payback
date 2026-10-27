// Turns `import code from './x.ts?bookmarklet'` into the minified source of x.ts and everything it
// imports, as one self-contained IIFE string. The page puts it in a `javascript:` link that visitors
// drag to their bookmarks bar, so it has to run on its own on the energy provider's website.
import { resolve } from 'node:path';
import { build } from 'esbuild';
import type { Plugin } from 'vite';

const SUFFIX = '?bookmarklet';

export function bookmarklet(): Plugin {
  return {
    name: 'bookmarklet',
    async resolveId(id, importer) {
      if (!id.endsWith(SUFFIX)) return null;
      const resolved = await this.resolve(id.slice(0, -SUFFIX.length), importer, { skipSelf: true });
      return resolved ? resolved.id + SUFFIX : null;
    },
    async load(id) {
      if (!id.endsWith(SUFFIX)) return null;
      const entry = id.slice(0, -SUFFIX.length);
      const result = await build({
        entryPoints: [entry],
        bundle: true,
        minify: true,
        format: 'iife',
        target: 'es2020',
        write: false,
        metafile: true,
        legalComments: 'none',
      });
      for (const input of Object.keys(result.metafile.inputs)) this.addWatchFile(resolve(input));
      const code = result.outputFiles[0].text.trim();
      return `export default ${JSON.stringify(code)};`;
    },
  };
}
