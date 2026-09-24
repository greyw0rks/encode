import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/*
 * eslint-config-next 16 ships flat configs directly, so there's no FlatCompat
 * shim here — passing these through it fails, because the legacy validator
 * can't JSON.stringify a flat config's plugin objects.
 */
const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...coreWebVitals,
  ...nextTypescript,
];

export default config;
