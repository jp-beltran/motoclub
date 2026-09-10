/// <reference types="vite/client" />

// Declares `import.meta.env` — and with it `import.meta.env.DEV`, the build
// flag that keeps "Restaurar demonstração" out of production (see
// `app/layout/DevResetDemoButton.tsx`). Vite replaces that property with the
// literal `false` when it builds, which is what lets the dead branch, its
// component and the label be dropped from `dist/` instead of merely hidden.
//
// This is Vite's own mechanism and the file its templates ship; without the
// reference `tsc -b` rejects `import.meta.env` as a property that does not
// exist on `ImportMeta`.
