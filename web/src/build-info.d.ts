/**
 * Ambient declarations for build-time constants injected by Vite's
 * `define` block in web/vite.config.ts. Read by Header.tsx so the
 * user can see "what version of the app is this" at a glance.
 */

/** Short git commit hash at build time, or 'dev' if not in a git checkout. */
declare const __BUILD_HASH__: string;

/** ISO-8601 timestamp of the build, e.g. "2026-06-04T22:30:00.000Z". */
declare const __BUILD_TIME__: string;
