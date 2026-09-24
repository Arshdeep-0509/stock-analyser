// Brings @testing-library/jest-dom's matcher types (toBeInTheDocument, ...)
// into the app tsconfig, where the component tests live. The runtime side is
// registered in vitest.setup.ts at the repo root.
import '@testing-library/jest-dom/vitest'
