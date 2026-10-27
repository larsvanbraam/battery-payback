/// <reference types="vite/client" />

declare module '*?bookmarklet' {
  /** The module and its imports, bundled and minified into one script (see plugins/bookmarklet.ts). */
  const code: string;
  export default code;
}
