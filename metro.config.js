const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// @supabase/supabase-js ma opcjonalny dynamiczny require("@opentelemetry/api"),
// którego Metro statycznie nie akceptuje bez zainstalowanej paczki.
// Zwracamy pusty moduł na poziomie resolvera Metro, dzięki czemu przy aktualizacji
// @supabase/supabase-js lub migracji do Expo SDK 56 nie polegamy wyłącznie na
// kruchym patch-package przypiętym do jednej wersji.
const upstreamResolveRequest = config.resolver?.resolveRequest;
config.resolver = {
  ...config.resolver,
  resolveRequest(context, moduleName, platform) {
    if (moduleName === "@opentelemetry/api") {
      return { type: "empty" };
    }
    if (upstreamResolveRequest) {
      return upstreamResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
