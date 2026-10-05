import { ScrollViewStyleReset, useServerDocumentContext } from "expo-router/html";

/**
 * The HTML shell around every page of the web build — what makes it installable as a PWA.
 *
 * <p>Web-only, and it runs in Node during `expo export`'s static rendering, so nothing here can
 * touch the DOM or browser APIs.
 *
 * <p>The manifest (`public/manifest.json`) is what Chrome on Android installs from. iOS reads
 * almost none of it, which is why the `apple-*` tags repeat the name and icon.
 *
 * <p>`viewport-fit=cover` is load-bearing, for the same reason the composer reads
 * `useSafeAreaInsets()` instead of padding by a constant: without it, an installed iPhone app has
 * no `env(safe-area-inset-*)` to measure, every inset comes back 0, and each sheet's close button
 * sits under the clock.
 *
 * <p>There is deliberately no service worker. Every screen is a live call to the API, so offline
 * has nothing to offer, and a cached bundle is how a fixed bug keeps shipping to phones.
 */
export default function Root({ children }: { children: React.ReactNode }) {
  const { bodyAttributes, bodyNodes, htmlAttributes, headNodes } = useServerDocumentContext();

  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />

        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#ffffff" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="OTJ Log" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/* Keeps the page itself from scrolling, so ScrollViews behave as they do on native. */}
        <ScrollViewStyleReset />

        {headNodes}
      </head>
      <body {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
