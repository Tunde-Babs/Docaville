declare module 'utif' {
  interface IFD { width: number; height: number; [k: string]: unknown }
  const UTIF: { decode(b: ArrayBuffer): IFD[]; decodeImage(b: ArrayBuffer, ifd: IFD): void; toRGBA8(ifd: IFD): Uint8Array };
  export default UTIF;
}

declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  const factory: (options?: unknown) => unknown;
  export default factory;
}
