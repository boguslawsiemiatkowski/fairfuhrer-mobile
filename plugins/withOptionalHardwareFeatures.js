const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Zgodnie z wytycznymi Google Play dla urządzeń wieloformatowych (telefony, tablety,
 * foldables, Chromebooki, Android XR):
 * https://developer.android.com/develop/ui/compose/layouts/adaptive/
 *
 * Oznacza wszystkie niejawnie wymagane funkcje sprzętowe (wynikające z uprawnień
 * lokalizacji, aparatu, ekranu dotykowego lub orientacji) jako opcjonalne (`android:required="false"`).
 * Dzięki temu Google Play nie wyklucza żadnych urządzeń w katalogu sklepu.
 */
const OPTIONAL_HARDWARE_FEATURES = [
  "android.hardware.screen.portrait",
  "android.hardware.screen.landscape",
  "android.hardware.location",
  "android.hardware.location.gps",
  "android.hardware.location.network",
  "android.hardware.camera",
  "android.hardware.camera.autofocus",
  "android.hardware.faketouch",
];

module.exports = function withOptionalHardwareFeatures(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    if (!Array.isArray(manifest["uses-feature"])) {
      manifest["uses-feature"] = [];
    }

    const usesFeatures = manifest["uses-feature"];

    for (const featureName of OPTIONAL_HARDWARE_FEATURES) {
      const existing = usesFeatures.find(
        (item) => item.$ && item.$["android:name"] === featureName,
      );
      if (existing) {
        existing.$["android:required"] = "false";
      } else {
        usesFeatures.push({
          $: {
            "android:name": featureName,
            "android:required": "false",
          },
        });
      }
    }

    return modConfig;
  });
};
