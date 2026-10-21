/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute API origin for split deployments; leave unset to use the same origin. */
  readonly VITE_API_URL?: string;
}
