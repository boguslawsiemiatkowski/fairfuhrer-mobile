import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import * as Haptics from "expo-haptics";
import {
  useRouteStore,
  formatDistance,
  formatDuration,
  type RouteProfile,
} from "@/stores/routeStore";

export function MapRouteOverlay() {
  const destination = useRouteStore((s) => s.destination);
  const origin = useRouteStore((s) => s.origin);
  const profile = useRouteStore((s) => s.profile);
  const status = useRouteStore((s) => s.status);
  const routeResult = useRouteStore((s) => s.routeResult);
  const errorMessage = useRouteStore((s) => s.errorMessage);
  const infoNotice = useRouteStore((s) => s.infoNotice);

  const changeProfile = useRouteStore((s) => s.changeProfile);
  const triggerFitBounds = useRouteStore((s) => s.triggerFitBounds);
  const cancelPickingOnMap = useRouteStore((s) => s.cancelPickingOnMap);
  const clearRoute = useRouteStore((s) => s.clearRoute);

  const [showSteps, setShowSteps] = useState(false);

  if (!destination || status === "idle") {
    return null;
  }

  // Tryb wybierania punktu startowego na mapie
  if (status === "picking-on-map") {
    return (
      <View style={s.overlayWrap}>
        <View style={s.pickingBanner}>
          <View style={s.pickingHeaderRow}>
            <Text style={s.pickingBadge}>STARTPUNKT WÄHLEN</Text>
            <TouchableOpacity
              style={s.cancelBtn}
              onPress={() => {
                void Haptics.selectionAsync().catch(() => {});
                cancelPickingOnMap();
              }}
            >
              <Text style={s.cancelBtnText}>Abbrechen ✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={s.pickingText}>
            Tippe jetzt direkt auf eine beliebige Stelle oder einen Pin auf der Karte, um deinen
            Startpunkt nach „{destination.Name}“ zu setzen.
          </Text>
        </View>
      </View>
    );
  }

  const handleProfileChange = (next: RouteProfile) => {
    void Haptics.selectionAsync().catch(() => {});
    void changeProfile(next);
  };

  return (
    <View style={s.overlayWrap}>
      <View style={s.card}>
        {/* Wiersz 1: Tytuł + Beenden */}
        <View style={s.topRow}>
          <View style={s.routeSummaryWrap}>
            <Text style={s.routeLabel} numberOfLines={1}>
              {origin?.label ?? "Start"} → {destination.Name}
            </Text>
          </View>
          <TouchableOpacity
            style={s.closeBtn}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => {});
              setShowSteps(false);
              clearRoute();
            }}
            hitSlop={8}
          >
            <Text style={s.closeBtnText}>Beenden ✕</Text>
          </TouchableOpacity>
        </View>

        {/* Wiersz 2: Przełącznik środka transportu + Metryki */}
        <View style={s.controlsRow}>
          <View style={s.profilePills}>
            {(
              [
                { id: "walking", label: "Zu Fuß" },
                { id: "cycling", label: "Fahrrad" },
                { id: "driving", label: "Auto" },
              ] as { id: RouteProfile; label: string }[]
            ).map((item) => {
              const isActive = profile === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[s.profilePill, isActive && s.profilePillActive]}
                  onPress={() => handleProfileChange(item.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.profilePillText, isActive && s.profilePillTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {status === "ready" && routeResult && (
            <View style={s.metricsGroup}>
              <Text style={s.durationText}>{formatDuration(routeResult.durationSeconds)}</Text>
              <Text style={s.distanceText}>· {formatDistance(routeResult.distanceMeters)}</Text>
            </View>
          )}
        </View>

        {/* Stany ładowania / błędu */}
        {(status === "locating-gps" || status === "loading-route") && (
          <View style={s.loadingRow}>
            <ActivityIndicator color="#fc6c14" size="small" />
            <Text style={s.loadingText}>
              {status === "locating-gps" ? "GPS wird ermittelt…" : "Route wird berechnet…"}
            </Text>
          </View>
        )}

        {infoNotice && <Text style={s.noticeText}>{infoNotice}</Text>}
        {status === "error" && errorMessage && <Text style={s.errorText}>{errorMessage}</Text>}

        {/* Wiersz 3: Akcje (Ganze Route + Wegbeschreibung) */}
        {status === "ready" && routeResult && (
          <View style={s.bottomActionsRow}>
            <TouchableOpacity
              style={s.actionBtn}
              onPress={() => {
                void Haptics.selectionAsync().catch(() => {});
                triggerFitBounds();
              }}
              activeOpacity={0.8}
            >
              <Text style={s.actionBtnText}>Ganze Route zeigen</Text>
            </TouchableOpacity>

            {routeResult.steps.length > 0 && (
              <TouchableOpacity
                style={[s.actionBtn, showSteps && s.actionBtnActive]}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => {});
                  setShowSteps((v) => !v);
                }}
                activeOpacity={0.8}
              >
                <Text style={[s.actionBtnText, showSteps && s.actionBtnTextActive]}>
                  Schritte ({routeResult.steps.length}) {showSteps ? "▲" : "▼"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Rozwijana lista kroków nawigacji */}
        {status === "ready" && routeResult && showSteps && (
          <ScrollView style={s.stepsScroll} nestedScrollEnabled>
            {routeResult.steps.map((step, idx) => (
              <View key={idx} style={s.stepRow}>
                <View style={s.stepBadge}>
                  <Text style={s.stepBadgeText}>{idx + 1}</Text>
                </View>
                <Text style={s.stepInstruction}>{step.instruction}</Text>
                {step.distanceMeters > 0 && (
                  <Text style={s.stepDist}>{formatDistance(step.distanceMeters)}</Text>
                )}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  overlayWrap: {
    position: "absolute",
    top: 10,
    left: 12,
    right: 12,
    zIndex: 25,
  },
  pickingBanner: {
    backgroundColor: "#18222f",
    borderWidth: 2,
    borderColor: "#fc6c14",
    borderRadius: 8,
    padding: 12,
    gap: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
  },
  pickingHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickingBadge: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 11,
    color: "#fc6c14",
    letterSpacing: 1.2,
  },
  cancelBtn: {
    backgroundColor: "rgba(255,255,255,0.14)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  cancelBtnText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 12,
    color: "#ffffff",
  },
  pickingText: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 14,
    color: "#ffffff",
    lineHeight: 19,
  },
  card: {
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#18222f",
    borderRadius: 8,
    padding: 12,
    gap: 8,
    shadowColor: "#18222f",
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 10,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  routeSummaryWrap: {
    flex: 1,
  },
  routeLabel: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 15,
    color: "#18222f",
  },
  closeBtn: {
    backgroundColor: "#18222f",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 5,
  },
  closeBtnText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 12,
    color: "#ffffff",
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  profilePills: {
    flexDirection: "row",
    gap: 6,
  },
  profilePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#18222f",
    backgroundColor: "#f8f8ff",
  },
  profilePillActive: {
    backgroundColor: "#fc6c14",
    borderColor: "#18222f",
  },
  profilePillText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 12,
    color: "#18222f",
  },
  profilePillTextActive: {
    color: "#ffffff",
  },
  metricsGroup: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  durationText: {
    fontFamily: "Anton_400Regular",
    fontSize: 19,
    color: "#18222f",
  },
  distanceText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 14,
    color: "#fc6c14",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
  },
  loadingText: {
    fontFamily: "FiraSansCondensed_600SemiBold",
    fontSize: 13,
    color: "#18222f",
  },
  noticeText: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 12,
    color: "#18222f",
    backgroundColor: "#fff5ef",
    padding: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#fc6c14",
  },
  errorText: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 12,
    color: "#c0392b",
    backgroundColor: "#fff0ee",
    padding: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: "#c0392b",
  },
  bottomActionsRow: {
    flexDirection: "row",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(24,34,47,0.12)",
    paddingTop: 8,
  },
  actionBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#18222f",
    backgroundColor: "#f8f8ff",
  },
  actionBtnActive: {
    backgroundColor: "#18222f",
  },
  actionBtnText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 12,
    color: "#18222f",
  },
  actionBtnTextActive: {
    color: "#ffffff",
  },
  stepsScroll: {
    maxHeight: 170,
    borderTopWidth: 1,
    borderTopColor: "rgba(24,34,47,0.12)",
    paddingTop: 6,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(24,34,47,0.08)",
  },
  stepBadge: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: "#18222f",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepBadgeText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 10,
    color: "#ffffff",
  },
  stepInstruction: {
    flex: 1,
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 13,
    color: "#18222f",
    lineHeight: 18,
  },
  stepDist: {
    fontFamily: "FiraSansCondensed_600SemiBold",
    fontSize: 11,
    color: "#5a6472",
    marginTop: 2,
  },
});
