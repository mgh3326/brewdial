// `export {}` makes this a MODULE so `declare module 'hono'` AUGMENTS hono's
// types (merging ContextVariableMap) instead of REPLACING the module — a
// script-mode .d.ts replaces it, hiding Hono/Context/Next and breaking tsc.
export {}

declare module 'hono' {
  interface ContextVariableMap {
    appUserId?: string
  }
}
