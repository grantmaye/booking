import type { ExpoConfig, ConfigContext } from "expo/config";
export default ({ config }: ConfigContext): ExpoConfig => {
  const development = process.env.APP_VARIANT === "development";
  const api = process.env.EXPO_PUBLIC_API_URL;
  if (
    process.env.EAS_BUILD_PROFILE === "production" &&
    (!api || !api.startsWith("https://"))
  )
    throw Error(
      "Set EXPO_PUBLIC_API_URL to the hosted HTTPS studio before building for stores.",
    );
  return {
    ...config,
    name: development ? "Chairside Dev" : "Chairside",
    slug: "chairside-mobile",
    version: "1.0.0",
    scheme: "chairside",
    orientation: "portrait",
    userInterfaceStyle: "light",
    icon: "./assets/icon.png",
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.grantmaye.chairside",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        ...(development
          ? {
              NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
              NSLocalNetworkUsageDescription:
                "Connect to your local Chairside development server.",
            }
          : {}),
      },
    },
    android: {
      package: "com.grantmaye.chairside",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#DBFF00",
      },
      blockedPermissions: ["android.permission.RECORD_AUDIO"],
      predictiveBackGestureEnabled: true,
    },
    web: {
      bundler: "metro",
      output: "single",
      favicon: "./assets/favicon.png",
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-font",
      [
        "expo-splash-screen",
        {
          backgroundColor: "#DBFF00",
          image: "./assets/splash-icon.png",
          imageWidth: 180,
        },
      ],
      "expo-web-browser",
      ...(development
        ? [
            [
              "expo-build-properties",
              { android: { usesCleartextTraffic: true } },
            ] as [string, Record<string, unknown>],
          ]
        : []),
    ],
  };
};
