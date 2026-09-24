/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Test hook — see seedFromEnv() in src/app/dataSource.ts. */
  readonly VITE_SEED?: string
  readonly VITE_MOCK_FAILURE_RATE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
