/// <reference types="vite/client" />

declare module '*.json?raw' {
  const content: string;
  export default content;
}

declare module '*.mp3?url' {
  const url: string;
  export default url;
}
