import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  useWindowDimensions,
  Keyboard,
  Alert,
  ActivityIndicator,
  BackHandler,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Svg, { Path, Circle } from "react-native-svg";
import { usePlacesStore } from "@/stores/placesStore";
import { useAuth } from "@/context/AuthContext";
import { syncPremiumToWeb } from "@/lib/revenuecat";
import { openExternalUrl } from "@/lib/openExternalUrl";

const FF_ORANGE = "#fc6c14";
const FF_BLACK = "#181716";

interface Props {
  visible: boolean;
  onClose: () => void;
}

function CloseIcon() {
  return (
    <Svg width={42} height={42} viewBox="0 0 24 24" fill="none">
      <Path d="M18 6L6 18M6 6l12 12" stroke={FF_BLACK} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

function ChevronIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 18l6-6-6-6"
        stroke="#999"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

interface DrawerItemProps {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
}

function DrawerItem({ label, icon, onPress }: DrawerItemProps) {
  return (
    <TouchableOpacity style={s.item} onPress={onPress} activeOpacity={0.7}>
      <View style={s.itemIcon}>{icon}</View>
      <Text style={s.itemLabel}>{label}</Text>
      <ChevronIcon />
    </TouchableOpacity>
  );
}

function RefreshIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 4v6h6M20 20v-6h-6"
        stroke={FF_ORANGE}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M20 10a8 8 0 0 0-14.93-2M4 14a8 8 0 0 0 14.93 2"
        stroke={FF_ORANGE}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function HilfeIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={10} stroke={FF_ORANGE} strokeWidth={1.8} />
      <Path
        d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"
        stroke={FF_ORANGE}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Circle cx={12} cy={17} r={0.5} fill={FF_ORANGE} stroke={FF_ORANGE} strokeWidth={1} />
    </Svg>
  );
}

function DatenschutzIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
        stroke={FF_ORANGE}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function AgbIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
        stroke={FF_ORANGE}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M14 2v6h6M16 13H8M16 17H8M10 9H8"
        stroke={FF_ORANGE}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ImpressumIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={10} stroke={FF_ORANGE} strokeWidth={1.8} />
      <Path d="M12 16v-4M12 8h.01" stroke={FF_ORANGE} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function FeedbackIcon() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        stroke={FF_ORANGE}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export default function AppDrawer({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const drawerWidth = Math.min(Math.round(windowWidth * 0.78), 360);

  const translateX = useSharedValue(drawerWidth);
  const opacity = useSharedValue(0);
  const [isRendered, setIsRendered] = useState(visible);
  const { fetchAll, status } = usePlacesStore();
  const { isPro, session } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  if (visible && !isRendered) {
    setIsRendered(true);
  }

  const handleRefresh = async () => {
    if (refreshing || status === "loading") return;
    setRefreshing(true);
    // Trigger fetch — der Store aktualisiert Places/Kategorien und ggf.
    // (bei Premium) auch den Offline-Cache. Wir warten kurz, damit der
    // Nutzer optische Rückmeldung sieht, auch wenn der Request sehr
    // schnell durchläuft.
    //
    // Für eingeloggte Nutzer stoßen wir parallel den Web-Sync an: falls
    // der Nutzer Premium anonym gekauft und sich später registriert hat,
    // ist das der Weg, es auf Supabase (und damit die Website) zu
    // übertragen. Der Sync-Call ist fire-and-forget — Fehler landen in
    // Sentry, ohne das Refresh-Ergebnis zu blockieren.
    const syncPromise = session ? syncPremiumToWeb() : Promise.resolve();
    await Promise.all([fetchAll(isPro, true), syncPromise]);
    const finalStatus = usePlacesStore.getState().status;
    const isOffline = usePlacesStore.getState().isOffline;
    setRefreshing(false);
    if (finalStatus === "success") {
      Alert.alert(
        isOffline ? "Offline-Daten geladen" : "Daten aktualisiert",
        isOffline
          ? "Keine Verbindung — wir zeigen deine zuletzt gespeicherten Fairführer-Daten."
          : "Deine Fairführer-Daten wurden erfolgreich aktualisiert.",
      );
    } else if (finalStatus === "error") {
      Alert.alert(
        "Keine Verbindung",
        "Aktualisierung fehlgeschlagen. Bitte prüfe deine Internetverbindung und versuche es erneut.",
      );
    }
  };

  useEffect(() => {
    if (visible) {
      Keyboard.dismiss();
      translateX.set(
        withSpring(0, {
          damping: 22,
          stiffness: 220,
          mass: 0.9,
        }),
      );
      opacity.set(withTiming(1, { duration: 200 }));
    } else {
      translateX.set(
        withTiming(drawerWidth, { duration: 220 }, (finished) => {
          if (finished) {
            scheduleOnRN(setIsRendered, false);
          }
        }),
      );
      opacity.set(withTiming(0, { duration: 200 }));
    }
  }, [visible, drawerWidth, translateX, opacity]);

  // Obsługa sprzętowego przycisku/gestu „Wstecz” na Androidzie przy otwartej szufladzie
  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [visible, onClose]);

  // Natywny gest przesunięcia palcem w prawo (swipe-to-close) na wątku UI.
  // W RNGH v3 przekazanie pojedynczej dodatniej liczby `activeOffsetX: 10` oznacza
  // zakres (-inf, 10), czyli aktywację gestu wyłącznie po przesunięciu o > 10px w prawo!
  const panGesture = usePanGesture({
    enabled: visible,
    activeOffsetX: 10,
    failOffsetY: [-20, 20],
    onUpdate: (e) => {
      "worklet";
      const dragX = Math.max(0, e.translationX);
      translateX.set(dragX);
      opacity.set(interpolate(dragX, [0, drawerWidth], [1, 0], Extrapolation.CLAMP));
    },
    onDeactivate: (e) => {
      "worklet";
      if (e.translationX > drawerWidth * 0.28 || e.velocityX > 500) {
        scheduleOnRN(onClose);
      } else {
        translateX.set(
          withSpring(0, {
            damping: 22,
            stiffness: 220,
            mass: 0.9,
          }),
        );
        opacity.set(withTiming(1, { duration: 150 }));
      }
    },
  });

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const panelAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  if (!visible && !isRendered) return null;

  function navigate(path: string) {
    onClose();
    setTimeout(() => router.navigate(path as any), 250);
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={visible ? "auto" : "none"}>
      {/* Backdrop */}
      <Animated.View style={[s.backdrop, backdropAnimatedStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Panel — slides in from right + supports native swipe-to-close */}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[
            s.panel,
            {
              width: drawerWidth,
              paddingTop: insets.top + 8,
              paddingBottom: insets.bottom + 16,
            },
            panelAnimatedStyle,
          ]}
        >
          {/* Header */}
          <View style={s.panelHeader}>
            <Text style={s.panelTitle}>FAIRFÜHRER</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <CloseIcon />
            </TouchableOpacity>
          </View>

          {/* Main items */}
          <View style={s.section}>
            <Text style={s.sectionLabel}>DATEN</Text>
            <TouchableOpacity
              style={s.item}
              onPress={handleRefresh}
              activeOpacity={0.7}
              disabled={refreshing || status === "loading"}
            >
              <View style={s.itemIcon}>
                {refreshing ? (
                  <ActivityIndicator size="small" color={FF_ORANGE} />
                ) : (
                  <RefreshIcon />
                )}
              </View>
              <Text style={s.itemLabel}>
                {refreshing ? "Wird aktualisiert…" : "Daten aktualisieren"}
              </Text>
              {!refreshing && <ChevronIcon />}
            </TouchableOpacity>
          </View>

          <View style={s.divider} />

          <View style={s.section}>
            <Text style={s.sectionLabel}>SUPPORT</Text>
            <DrawerItem
              label="Hilfe & FAQ"
              icon={<HilfeIcon />}
              onPress={() => navigate("/(drawer)/hilfe")}
            />
            <DrawerItem
              label="Feedback senden"
              icon={<FeedbackIcon />}
              onPress={() =>
                openExternalUrl(
                  "mailto:info@fairfuehrer.guide?subject=App-Feedback",
                  "Auf diesem Gerät ist keine E-Mail-App eingerichtet. Sie erreichen uns unter info@fairfuehrer.guide.",
                )
              }
            />
          </View>

          <View style={s.divider} />

          <View style={s.section}>
            <Text style={s.sectionLabel}>RECHTLICHES</Text>
            <DrawerItem
              label="Datenschutz"
              icon={<DatenschutzIcon />}
              onPress={() => navigate("/(drawer)/datenschutz")}
            />
            <DrawerItem
              label="Nutzungsbedingungen"
              icon={<AgbIcon />}
              onPress={() => navigate("/(drawer)/agb")}
            />
            <DrawerItem
              label="Impressum"
              icon={<ImpressumIcon />}
              onPress={() => navigate("/(drawer)/impressum")}
            />
          </View>

          <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={s.footerText}>© 2025 Seenergien GmbH</Text>
            <Text style={s.footerText}>fairfuehrer.guide</Text>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(24,34,47,0.5)",
  },
  panel: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "#f8f8ff",
    borderLeftWidth: 2,
    borderLeftColor: "#18222f",
    shadowColor: "#000",
    shadowOffset: { width: -4, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 16,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 18,
    backgroundColor: "#ffffff",
    borderBottomWidth: 2,
    borderBottomColor: "#18222f",
  },
  panelTitle: {
    fontFamily: "Anton_400Regular",
    fontSize: 30,
    color: FF_ORANGE,
    letterSpacing: 1,
  },
  section: {
    paddingTop: 10,
  },
  sectionLabel: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 11,
    color: "#5a6472",
    letterSpacing: 1.4,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 13,
    gap: 12,
  },
  itemIcon: {
    width: 24,
    alignItems: "center",
  },
  itemLabel: {
    fontFamily: "FiraSansCondensed_600SemiBold",
    fontSize: 16,
    color: "#18222f",
    flex: 1,
  },
  divider: {
    height: 1.5,
    backgroundColor: "rgba(24,34,47,0.14)",
    marginHorizontal: 20,
    marginTop: 8,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1.5,
    borderTopColor: "rgba(24,34,47,0.14)",
    backgroundColor: "#ffffff",
    gap: 2,
  },
  footerText: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 12,
    color: "#5a6472",
  },
});
