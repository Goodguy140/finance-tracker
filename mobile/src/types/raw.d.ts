// Vite's `?raw` imports (used by tests only): the file's text.
declare module '*?raw' {
  const content: string;
  export default content;
}
