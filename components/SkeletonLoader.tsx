import { useEffect } from "react";
import { View, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";

/**
 * Pojedynczy pulsacyjny blok szkieletu (shimmer) w estetyce Studio (wzorowany na PlaceInfoPanel.module.css z Weba).
 */
export function SkeletonBlock({ style }: { style?: StyleProp<ViewStyle> }) {
  const opacity = useSharedValue(0.38);

  useEffect(() => {
    opacity.set(
      withRepeat(
        withSequence(
          withTiming(0.88, { duration: 750, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.38, { duration: 750, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        true,
      ),
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return <Animated.View style={[s.block, style, animatedStyle]} />;
}

/**
 * Estetyczny szkielet ładowania tekstu opisu Audiopinu (4 linie różnej długości —
 * dokładny odpowiednik `.descriptionSkeleton` z panelu bocznego w aplikacji Web).
 */
export function DescriptionSkeleton() {
  return (
    <View style={s.descriptionWrap} accessibilityLabel="Beschreibung wird geladen">
      <SkeletonBlock style={s.lineFull} />
      <SkeletonBlock style={s.lineMedium} />
      <SkeletonBlock style={s.lineFull} />
      <SkeletonBlock style={s.lineShort} />
    </View>
  );
}

/**
 * Estetyczny szkielet karty Audiopinu na ekranie głównym (Liste) podczas ładowania katalogu.
 */
export function PinCardSkeleton({ width, height }: { width: number; height: number }) {
  return (
    <View style={[s.cardOuter, { width, height }]}>
      <SkeletonBlock style={StyleSheet.absoluteFill} />
      <View style={s.cardBottomOverlay}>
        <View style={s.cardIconCircle} />
        <View style={s.cardTitleBar} />
        <View style={s.cardSubtitleBar} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  block: {
    backgroundColor: "rgba(24, 34, 47, 0.14)",
    borderRadius: 6,
  },
  descriptionWrap: {
    gap: 11,
    paddingVertical: 6,
  },
  lineFull: {
    width: "100%",
    height: 15,
    borderRadius: 6,
  },
  lineMedium: {
    width: "92%",
    height: 15,
    borderRadius: 6,
  },
  lineShort: {
    width: "66%",
    height: 15,
    borderRadius: 6,
  },
  cardOuter: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#18222f",
    backgroundColor: "#e9ecf2",
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  cardBottomOverlay: {
    paddingHorizontal: 22,
    paddingBottom: 22,
    alignItems: "center",
    gap: 10,
  },
  cardIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.55)",
  },
  cardTitleBar: {
    width: "78%",
    height: 24,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.65)",
  },
  cardSubtitleBar: {
    width: "46%",
    height: 16,
    borderRadius: 5,
    backgroundColor: "rgba(255, 255, 255, 0.48)",
  },
});
