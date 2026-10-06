// The http project probes a running build; fail fast instead of timing out against nothing.
if (!process.env.BASE_URL) {
  throw new Error(
    "BASE_URL is not set. Start a build (npm run build && npm run preview) and run with BASE_URL=http://localhost:4321",
  );
}
