/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base da API quando o frontend é servido em outra origem (opcional). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
