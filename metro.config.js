const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// @supabase/supabase-js ma opcjonalny dynamiczny require("@opentelemetry/api"),
// którego Metro statycznie nie akceptuje bez zainstalowanej paczki.
// Zwracamy pusty moduł na poziomie resolvera Metro, dzięki czemu przy aktualizacji
// @supabase/supabase-js lub migracji do Expo SDK 56+ nie polegamy wyłącznie na
// kruchym patch-package przypiętym do jednej wersji.
// Ponadto w expo-router@58.0.32 w package.json pozostał ogólny wpis `"./build/*": "./build/*.js"`,
// który dla folderu `expo-router/build/global-state/router-store` (posiadającego `index.js`)
// wypisuje fałszywy WARN w Metro przed automatycznym fallbackiem do `index.js`.
const upstreamResolveRequest = config.resolver?.resolveRequest;
config.resolver = {
  ...config.resolver,
  resolveRequest(context, moduleName, platform) {
    if (moduleName === "@opentelemetry/api") {
      return { type: "empty" };
    }
    if (moduleName === "expo-router/build/global-state/router-store") {
      return context.resolveRequest(
        context,
        "expo-router/build/global-state/router-store/index.js",
        platform,
      );
    }
    if (upstreamResolveRequest) {
      return upstreamResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
