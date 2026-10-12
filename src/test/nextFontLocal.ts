// next/font/local, for the component tests: Next replaces each call with
// the font's files and class names when it builds the app, which can't
// happen outside it. Here a font is just a class that loads nothing, so the
// text falls back to the default font.

interface LocalFontOptions {
  variable?: string;
}

export default function localFont(options: LocalFontOptions) {
  return { className: "", variable: options.variable ? "" : undefined, style: { fontFamily: "inherit" } };
}
