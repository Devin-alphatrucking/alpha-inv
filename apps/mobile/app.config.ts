import type { ExpoConfig } from "expo/config";

// One codebase, many branded apps. Everything that changes per company comes from the environment when the app is built
// (see docs/PHASE-8-MOBILE-APP.md). The defaults build the shared app.
const env = process.env;
const name = env.APP_NAME ?? "Invoice & Billing";
const slug = env.APP_SLUG ?? "invoice-billing";
const bundleId = env.APP_BUNDLE_ID ?? "com.example.invoicebilling"; // replace before store submission
const primary = env.APP_PRIMARY_COLOR ?? "#0f172a";

const config: ExpoConfig = {
  name,
  slug,
  version: env.APP_VERSION ?? "1.0.0",
  scheme: slug,
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: true,
    bundleIdentifier: bundleId,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: bundleId,
    adaptiveIcon: {
      backgroundColor: primary,
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: "./assets/favicon.png" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-image-picker", { cameraPermission: `Allow ${name} to use the camera to photograph invoices, site work and deliveries.`, photosPermission: `Allow ${name} to choose invoice and site photos from your gallery.` }],
    "expo-document-picker",
  ],
  experiments: { typedRoutes: true },
  extra: { apiUrl: env.API_URL ?? "http://localhost:3000" },
};

export default config;
