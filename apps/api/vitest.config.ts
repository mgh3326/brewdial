import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Tests run the MCP server from its source, so no test entry point needs
      // apps/mcp built first. Type checking still reads the built declarations;
      // `pnpm check` builds them.
      '@brewdial/mcp/server': fileURLToPath(new URL('../mcp/src/server.ts', import.meta.url)),
    },
  },
  test: {
    fileParallelism: false,
  },
})
