Bundled PDF fallback fonts (SIL Open Font License; included in this directory):

- NotoSans-Regular.ttf and NotoNaskhArabic-Regular.ttf: https://github.com/notofonts/noto-fonts/tree/main/hinted/ttf
- NotoSansCJKsc-Regular.otf: https://github.com/notofonts/noto-cjk/tree/main/Sans/OTF/SimplifiedChinese

The font binaries are in src/assets/fonts and are emitted as local build assets. They are loaded only when needed and embedded as subsets. No font download occurs at runtime.
