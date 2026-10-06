// The http project probes a running build; fail fast instead of timing out against nothing.
// vitest.config.ts forwards BASE_URL as TEST_BASE_URL (Vitest replaces BASE_URL itself with "/").
if (!process.env.TEST_BASE_URL) {
  throw new Error(
    "BASE_URL is not set. Start a build (npm run build && npm run preview) and run with BASE_URL=http://localhost:4321",
  );
}
