import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import Svg, { Path, Circle, Line, Polyline } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { CategoryIcon, categoryColorFor } from "@/components/CategoryIcon";
import { usePlacesStore } from "@/stores/placesStore";
import {
  useRouteStore,
  formatDistance,
  formatDuration,
  MAX_ACTIVE_MOBILITY_DISTANCE_M,
  distanceInMeters,
  type RouteProfile,
} from "@/stores/routeStore";
import type { DirectusOrte, DirectusKategorie } from "@/types";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";

// ─── Ikony SVG (spójne z RoutePlannerSection na Webie) ────────────────────────

function MapPinSvg({ color = "#ffffff", size = 16 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx="12" cy="10" r="3" stroke={color} strokeWidth="2" />
    </Svg>
  );
}

function LocateSvg({ color = "#18222f", size = 15 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="7" stroke={color} strokeWidth="2" />
      <Circle cx="12" cy="12" r="2.5" fill={color} />
      <Line x1="12" y1="2" x2="12" y2="5" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="12" y1="19" x2="12" y2="22" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="2" y1="12" x2="5" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <Line x1="19" y1="12" x2="22" y2="12" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function SearchSvg({ color = "#18222f", size = 15 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="11" cy="11" r="7" stroke={color} strokeWidth="2" />
      <Line x1="20" y1="20" x2="16" y2="16" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

function TapMapSvg({ color = "#18222f", size = 15 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx="12" cy="9" r="2.5" fill={color} />
    </Svg>
  );
}

function WalkSvg({ color = "#18222f", size = 16 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="13" cy="4.5" r="2" stroke={color} strokeWidth="2" />
      <Path
        d="M10 22l2-7-2.5-2.5L11 8l4 2 2 3M8 14l3-6M14 15l2 7"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function BikeSvg({ color = "#18222f", size = 16 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="5.5" cy="17.5" r="3.5" stroke={color} strokeWidth="2" />
      <Circle cx="18.5" cy="17.5" r="3.5" stroke={color} strokeWidth="2" />
      <Path
        d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h2"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CarSvg({ color = "#18222f", size = 16 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9L18 10l-2.3-4.4A2 2 0 0 0 14 4.5H10a2 2 0 0 0-1.7 1.1L6 10l-2.5 1.1C2.7 11.3 2 12.1 2 13v3c0 .6.4 1 1 1h2"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx="7" cy="17" r="2" stroke={color} strokeWidth="2" />
      <Circle cx="17" cy="17" r="2" stroke={color} strokeWidth="2" />
    </Svg>
  );
}

function ArrowRightSvg({ color = "#ffffff", size = 18 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="5" y1="12" x2="19" y2="12" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
      <Polyline
        points="12 5 19 12 12 19"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ─── Geocoding helper (Mapbox v6 — identyczny jak w SearchSection) ───────────

interface OriginSuggestion {
  id: string;
  name: string;
  sublabel: string;
  coords: [number, number];
  isPin: boolean;
  placeId?: number;
}

async function fetchGeoOriginSuggestions(
  query: string,
  signal: AbortSignal,
): Promise<OriginSuggestion[]> {
  if (query.trim().length < 2 || !MAPBOX_TOKEN) return [];
  const url =
    `https://api.mapbox.com/search/geocode/v6/forward` +
    `?q=${encodeURIComponent(query)}` +
    `&country=de,at,ch` +
    `&language=de` +
    `&limit=5` +
    `&types=place,locality,postcode,district,address` +
    `&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url, { signal });
  const data = await res.json();
  return (data.features ?? [])
    .filter((f: any) => Array.isArray(f.geometry?.coordinates))
    .map((f: any) => ({
      id: `geo-${f.id}`,
      name: f.properties?.name || f.properties?.full_address || query,
      sublabel: f.properties?.place_formatted || "",
      coords: f.geometry.coordinates as [number, number],
      isPin: false,
    }));
}

interface RoutePlannerCardProps {
  place: DirectusOrte;
  firstCategory: DirectusKategorie | undefined;
  headerColor: string;
  onOpenOnMap: () => void;
}

export function RoutePlannerCard({
  place,
  firstCategory,
  headerColor,
  onOpenOnMap,
}: RoutePlannerCardProps) {
  const allPlaces = usePlacesStore((s) => s.places);

  const destination = useRouteStore((s) => s.destination);
  const origin = useRouteStore((s) => s.origin);
  const profile = useRouteStore((s) => s.profile);
  const status = useRouteStore((s) => s.status);
  const errorMessage = useRouteStore((s) => s.errorMessage);
  const infoNotice = useRouteStore((s) => s.infoNotice);
  const routeResult = useRouteStore((s) => s.routeResult);

  const focusMapOnCoords = useRouteStore((s) => s.focusMapOnCoords);
  const triggerFitBounds = useRouteStore((s) => s.triggerFitBounds);
  const startRouteWithGps = useRouteStore((s) => s.startRouteWithGps);
  const startRouteWithOrigin = useRouteStore((s) => s.startRouteWithOrigin);
  const changeProfile = useRouteStore((s) => s.changeProfile);
  const startPickingOnMap = useRouteStore((s) => s.startPickingOnMap);
  const clearRoute = useRouteStore((s) => s.clearRoute);

  const isForThisPlace = destination?.id === place.id;
  const activeOrigin = isForThisPlace ? origin : null;
  const activeStatus = isForThisPlace ? status : "idle";
  const activeResult = isForThisPlace ? routeResult : null;
  const activeError = isForThisPlace ? errorMessage : null;
  const activeNotice = isForThisPlace ? infoNotice : null;

  const [showOriginSearch, setShowOriginSearch] = useState(false);
  const [originQuery, setOriginQuery] = useState("");
  const [geoSuggestions, setGeoSuggestions] = useState<OriginSuggestion[]>([]);
  const [isSearchingGeo, setIsSearchingGeo] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Lokalni kandydaci miast z katalogu (zamiast pojedynczych pinów)
  const citySuggestions = useMemo<OriginSuggestion[]>(() => {
    const q = originQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const seen = new Map<
      string,
      { name: string; land: string; lonSum: number; latSum: number; count: number }
    >();
    for (const p of allPlaces) {
      const city = p.Stadt?.trim();
      if (!city || !p.location?.coordinates) continue;
      const key = city.toLowerCase();
      if (!key.includes(q)) continue;
      const existing = seen.get(key);
      if (existing) {
        existing.lonSum += p.location.coordinates[0];
        existing.latSum += p.location.coordinates[1];
        existing.count += 1;
      } else {
        seen.set(key, {
          name: city,
          land: p.Land?.trim() ?? "",
          lonSum: p.location.coordinates[0],
          latSum: p.location.coordinates[1],
          count: 1,
        });
      }
    }
    return Array.from(seen.values())
      .slice(0, 4)
      .map((c) => ({
        id: `city-${c.name}`,
        name: c.name,
        sublabel: c.land,
        coords: [c.lonSum / c.count, c.latSum / c.count] as [number, number],
        isPin: false,
      }));
  }, [originQuery, allPlaces]);

  // Mapbox Geocoding dla miast i adresów
  useEffect(() => {
    const q = originQuery.trim();
    if (!showOriginSearch || q.length < 2) {
      return;
    }

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsSearchingGeo(true);
      fetchGeoOriginSuggestions(q, controller.signal)
        .then((res) => {
          if (!controller.signal.aborted) {
            setGeoSuggestions(res);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsSearchingGeo(false);
          }
        });
    }, 280);

    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [showOriginSearch, originQuery]);

  const combinedSuggestions = useMemo(() => {
    const seen = new Set(citySuggestions.map((c) => c.name.toLowerCase()));
    const filteredGeo = geoSuggestions.filter((g) => !seen.has(g.name.toLowerCase()));
    return [...citySuggestions, ...filteredGeo];
  }, [citySuggestions, geoSuggestions]);

  const destinationCoords = place.location?.coordinates;
  const isOriginFarForActiveMobility = useMemo(() => {
    if (!activeOrigin || !destinationCoords) return false;
    return (
      distanceInMeters(activeOrigin.coords, destinationCoords) > MAX_ACTIVE_MOBILITY_DISTANCE_M
    );
  }, [activeOrigin, destinationCoords]);

  const handleOpenPinOnMap = () => {
    void Haptics.selectionAsync().catch(() => {});
    if (place.location?.coordinates) {
      focusMapOnCoords(place.location.coordinates, 16);
    }
    onOpenOnMap();
  };

  const handleSelectGps = () => {
    void Haptics.selectionAsync().catch(() => {});
    setShowOriginSearch(false);
    void startRouteWithGps(place, profile);
  };

  const handleSelectSuggestion = (item: OriginSuggestion) => {
    void Haptics.selectionAsync().catch(() => {});
    setShowOriginSearch(false);
    setOriginQuery("");
    setGeoSuggestions([]);
    void startRouteWithOrigin(
      place,
      {
        type: item.isPin ? "pin" : "place",
        label: item.name,
        sublabel: item.sublabel || undefined,
        coords: item.coords,
        placeId: item.placeId,
      },
      profile,
    );
  };

  const handlePickOnMap = () => {
    void Haptics.selectionAsync().catch(() => {});
    setShowOriginSearch(false);
    startPickingOnMap(place, profile);
    if (place.location?.coordinates) {
      focusMapOnCoords(place.location.coordinates, 13);
    }
    onOpenOnMap();
  };

  const handleProfilePress = (nextProfile: RouteProfile) => {
    void Haptics.selectionAsync().catch(() => {});
    if (!activeOrigin) {
      // Jeśli użytkownik od razu kliknie Zu Fuß / Fahrrad / Auto (jak na Webie),
      // automatycznie uruchamiamy wyznaczanie trasy z jego GPS!
      void startRouteWithGps(place, nextProfile);
      return;
    }
    void changeProfile(nextProfile);
  };

  const handleShowRouteOnMap = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    triggerFitBounds();
    onOpenOnMap();
  };

  return (
    <View style={s.card}>
      {/* Nagłówek miejsca docelowego */}
      <View style={s.headerRow}>
        <View style={s.iconWrap}>
          <CategoryIcon
            categoryId={firstCategory?.id ?? null}
            color={headerColor || categoryColorFor(firstCategory)}
            strokeColor="#fff"
            size={42}
          />
        </View>
        <View style={s.headerTextWrap}>
          <Text style={s.placeName}>{place.Name}</Text>
          {(place.Adresse || place.Stadt) && (
            <Text style={s.addressText}>
              {[place.Adresse, place.Stadt, place.Land].filter(Boolean).join(", ")}
            </Text>
          )}
        </View>
      </View>

      {/* Główny przycisk: otwórz ten Pin na naszej mapie FairFührer */}
      <TouchableOpacity style={s.openOnMapBtn} onPress={handleOpenPinOnMap} activeOpacity={0.85}>
        <View style={s.openOnMapBtnLabel}>
          <MapPinSvg color="#ffffff" size={17} />
          <Text style={s.openOnMapBtnText}>Pin auf der FairFührer-Karte öffnen</Text>
        </View>
        <ArrowRightSvg color="#fc6c14" size={18} />
      </TouchableOpacity>

      {/* Wbudowany Routenplaner (Mapbox Directions v5 — wewnątrz aplikacji) */}
      <View style={s.plannerBlock}>
        <View style={s.plannerTitleRow}>
          <Text style={s.plannerTitle}>ROUTENPLANER IN DER APP</Text>
          {isForThisPlace && (activeOrigin || activeStatus !== "idle") && (
            <TouchableOpacity
              style={s.resetBtn}
              onPress={() => {
                void Haptics.selectionAsync().catch(() => {});
                clearRoute();
              }}
              hitSlop={8}
            >
              <Text style={s.resetBtnText}>Zurücksetzen ✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Podgląd Start -> Ziel (gdy wybrano punkt startowy) */}
        {activeOrigin && (
          <View style={s.waypointsBox}>
            <View style={s.waypointRow}>
              <View style={s.badgeStart}>
                <Text style={s.badgeStartText}>START</Text>
              </View>
              <View style={s.waypointInfo}>
                <Text style={s.waypointLabel} numberOfLines={1}>
                  {activeOrigin.label}
                </Text>
                {activeOrigin.sublabel ? (
                  <Text style={s.waypointSub} numberOfLines={1}>
                    {activeOrigin.sublabel}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={s.waypointDivider} />
            <View style={s.waypointRow}>
              <View style={s.badgeDest}>
                <Text style={s.badgeDestText}>ZIEL</Text>
              </View>
              <View style={s.waypointInfo}>
                <Text style={s.waypointLabel} numberOfLines={1}>
                  {place.Name}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Krok 1: Startpunkt */}
        <Text style={s.stepLabel}>1. Startpunkt wählen</Text>
        <View style={s.originRow}>
          <TouchableOpacity
            style={[
              s.originBtn,
              activeOrigin?.type === "gps" && !showOriginSearch && s.originBtnActive,
            ]}
            onPress={handleSelectGps}
            activeOpacity={0.8}
          >
            <LocateSvg
              color={activeOrigin?.type === "gps" && !showOriginSearch ? "#ffffff" : "#18222f"}
              size={14}
            />
            <Text
              style={[
                s.originBtnText,
                activeOrigin?.type === "gps" && !showOriginSearch && s.originBtnTextActive,
              ]}
            >
              Mein GPS
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              s.originBtn,
              (showOriginSearch ||
                activeOrigin?.type === "pin" ||
                activeOrigin?.type === "place") &&
                s.originBtnActive,
            ]}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => {});
              setShowOriginSearch((v) => !v);
            }}
            activeOpacity={0.8}
          >
            <SearchSvg
              color={
                showOriginSearch || activeOrigin?.type === "pin" || activeOrigin?.type === "place"
                  ? "#ffffff"
                  : "#18222f"
              }
              size={14}
            />
            <Text
              style={[
                s.originBtnText,
                (showOriginSearch ||
                  activeOrigin?.type === "pin" ||
                  activeOrigin?.type === "place") &&
                  s.originBtnTextActive,
              ]}
            >
              Ort / Pin
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              s.originBtn,
              activeOrigin?.type === "map-click" && !showOriginSearch && s.originBtnActive,
            ]}
            onPress={handlePickOnMap}
            activeOpacity={0.8}
          >
            <TapMapSvg
              color={
                activeOrigin?.type === "map-click" && !showOriginSearch ? "#ffffff" : "#18222f"
              }
              size={14}
            />
            <Text
              style={[
                s.originBtnText,
                activeOrigin?.type === "map-click" && !showOriginSearch && s.originBtnTextActive,
              ]}
            >
              Auf Karte
            </Text>
          </TouchableOpacity>
        </View>

        {/* Wyszukiwarka innego pinu lub miasta jako punktu startowego */}
        {showOriginSearch && (
          <View style={s.originSearchBox}>
            <View style={s.originInputWrap}>
              <TextInput
                style={s.originInput}
                placeholder="Stadt oder Adresse eingeben…"
                placeholderTextColor="#7a8494"
                value={originQuery}
                onChangeText={(text) => {
                  setOriginQuery(text);
                  if (text.trim().length < 2) {
                    setGeoSuggestions([]);
                    setIsSearchingGeo(false);
                  }
                }}
                autoCorrect={false}
              />
              {originQuery.length > 0 && (
                <TouchableOpacity
                  onPress={() => {
                    setOriginQuery("");
                    setGeoSuggestions([]);
                  }}
                  style={s.originClearBtn}
                >
                  <Text style={s.originClearText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {originQuery.trim().length >= 2 && (
              <View style={s.suggestionsList}>
                {combinedSuggestions.length > 0 ? (
                  combinedSuggestions.map((item) => (
                    <TouchableOpacity
                      key={item.id}
                      style={s.suggestionRow}
                      onPress={() => handleSelectSuggestion(item)}
                      activeOpacity={0.75}
                    >
                      <View
                        style={[
                          s.suggestionBadge,
                          item.isPin ? s.suggestionBadgePin : s.suggestionBadgeGeo,
                        ]}
                      >
                        <Text
                          style={[
                            s.suggestionBadgeText,
                            item.isPin ? s.suggestionBadgeTextPin : s.suggestionBadgeTextGeo,
                          ]}
                        >
                          {item.isPin ? "PIN" : "ORT"}
                        </Text>
                      </View>
                      <View style={s.suggestionTextWrap}>
                        <Text style={s.suggestionName} numberOfLines={1}>
                          {item.name}
                        </Text>
                        {item.sublabel ? (
                          <Text style={s.suggestionSub} numberOfLines={1}>
                            {item.sublabel}
                          </Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  ))
                ) : (
                  <Text style={s.originHintText}>
                    {isSearchingGeo
                      ? "Vorschläge werden geladen…"
                      : "Keine passenden Orte oder Pins gefunden."}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* Krok 2: Verkehrsmittel */}
        <Text style={s.stepLabel}>2. Verkehrsmittel wählen</Text>
        <View style={s.profileRow}>
          <TouchableOpacity
            style={[
              s.profileBtn,
              profile === "walking" && s.profileBtnActive,
              isOriginFarForActiveMobility && s.profileBtnDisabled,
            ]}
            onPress={() => handleProfilePress("walking")}
            activeOpacity={0.8}
          >
            <WalkSvg color={profile === "walking" ? "#ffffff" : "#18222f"} size={16} />
            <Text style={[s.profileBtnText, profile === "walking" && s.profileBtnTextActive]}>
              Zu Fuß
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              s.profileBtn,
              profile === "cycling" && s.profileBtnActive,
              isOriginFarForActiveMobility && s.profileBtnDisabled,
            ]}
            onPress={() => handleProfilePress("cycling")}
            activeOpacity={0.8}
          >
            <BikeSvg color={profile === "cycling" ? "#ffffff" : "#18222f"} size={16} />
            <Text style={[s.profileBtnText, profile === "cycling" && s.profileBtnTextActive]}>
              Fahrrad
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.profileBtn, profile === "driving" && s.profileBtnActive]}
            onPress={() => handleProfilePress("driving")}
            activeOpacity={0.8}
          >
            <CarSvg color={profile === "driving" ? "#ffffff" : "#18222f"} size={16} />
            <Text style={[s.profileBtnText, profile === "driving" && s.profileBtnTextActive]}>
              Auto
            </Text>
          </TouchableOpacity>
        </View>

        {/* Stany ładowania / podpowiedzi / błędów */}
        {activeStatus === "idle" && !activeOrigin && !showOriginSearch && (
          <Text style={s.helperHint}>
            Tippe auf „Mein GPS“ oder direkt auf ein Verkehrsmittel, um die Route hierhin sofort in
            der App zu berechnen.
          </Text>
        )}

        {(activeStatus === "locating-gps" || activeStatus === "loading-route") && (
          <View style={s.statusBox}>
            <ActivityIndicator color="#fc6c14" size="small" />
            <Text style={s.statusBoxText}>
              {activeStatus === "locating-gps"
                ? "GPS-Standort wird ermittelt…"
                : "Route wird berechnet…"}
            </Text>
          </View>
        )}

        {activeNotice && (
          <View style={s.noticeBox}>
            <Text style={s.noticeText}>{activeNotice}</Text>
          </View>
        )}

        {activeStatus === "error" && activeError && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{activeError}</Text>
          </View>
        )}

        {/* Wynik obliczonej trasy */}
        {activeStatus === "ready" && activeResult && (
          <View style={s.resultBox}>
            <View style={s.resultHeaderRow}>
              <View style={s.metricsWrap}>
                <Text style={s.durationText}>{formatDuration(activeResult.durationSeconds)}</Text>
                <Text style={s.distanceText}>{formatDistance(activeResult.distanceMeters)}</Text>
              </View>

              <TouchableOpacity
                style={s.showOnMapCta}
                onPress={handleShowRouteOnMap}
                activeOpacity={0.85}
              >
                <Text style={s.showOnMapCtaText}>Route auf der Karte zeigen</Text>
                <ArrowRightSvg color="#ffffff" size={16} />
              </TouchableOpacity>
            </View>

            {activeResult.steps.length > 0 && (
              <>
                <TouchableOpacity
                  style={s.stepsToggleBtn}
                  onPress={() => setShowSteps((v) => !v)}
                  activeOpacity={0.75}
                >
                  <Text style={s.stepsToggleText}>
                    Wegbeschreibung ({activeResult.steps.length} Schritte)
                  </Text>
                  <Text style={s.stepsToggleChevron}>{showSteps ? "▲" : "▼"}</Text>
                </TouchableOpacity>

                {showSteps && (
                  <View style={s.stepsList}>
                    {activeResult.steps.map((step, idx) => (
                      <View key={idx} style={s.stepRow}>
                        <View style={s.stepIdxBadge}>
                          <Text style={s.stepIdxText}>{idx + 1}</Text>
                        </View>
                        <Text style={s.stepInstruction}>{step.instruction}</Text>
                        {step.distanceMeters > 0 && (
                          <Text style={s.stepDist}>{formatDistance(step.distanceMeters)}</Text>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#18222f",
    padding: 16,
    gap: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTextWrap: {
    flex: 1,
  },
  placeName: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 17,
    color: "#18222f",
    lineHeight: 22,
  },
  addressText: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 14,
    color: "#4a5568",
    lineHeight: 19,
    marginTop: 2,
  },
  openOnMapBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#18222f",
    borderWidth: 1.5,
    borderColor: "#18222f",
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  openOnMapBtnLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  openOnMapBtnText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 15,
    color: "#ffffff",
    letterSpacing: 0.3,
  },
  plannerBlock: {
    borderTopWidth: 1.5,
    borderTopColor: "rgba(24,34,47,0.14)",
    paddingTop: 12,
    gap: 10,
  },
  plannerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  plannerTitle: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 12,
    color: "#fc6c14",
    letterSpacing: 1.2,
  },
  resetBtn: {
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  resetBtnText: {
    fontFamily: "FiraSansCondensed_600SemiBold",
    fontSize: 12,
    color: "#5a6472",
  },
  waypointsBox: {
    backgroundColor: "#f8f8ff",
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderRadius: 6,
    padding: 10,
    gap: 6,
  },
  waypointRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  badgeStart: {
    backgroundColor: "#18222f",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    minWidth: 46,
    alignItems: "center",
  },
  badgeStartText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 10,
    color: "#ffffff",
    letterSpacing: 0.6,
  },
  badgeDest: {
    backgroundColor: "#fc6c14",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
    minWidth: 46,
    alignItems: "center",
  },
  badgeDestText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 10,
    color: "#ffffff",
    letterSpacing: 0.6,
  },
  waypointInfo: {
    flex: 1,
  },
  waypointLabel: {
    fontFamily: "FiraSansCondensed_600SemiBold",
    fontSize: 14,
    color: "#18222f",
  },
  waypointSub: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 12,
    color: "#5a6472",
  },
  waypointDivider: {
    height: 1,
    backgroundColor: "rgba(24,34,47,0.12)",
  },
  stepLabel: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 11,
    color: "#18222f",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 2,
  },
  originRow: {
    flexDirection: "row",
    gap: 8,
  },
  originBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 9,
    paddingHorizontal: 8,
    backgroundColor: "#f8f8ff",
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderRadius: 6,
  },
  originBtnActive: {
    backgroundColor: "#18222f",
  },
  originBtnText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 13,
    color: "#18222f",
  },
  originBtnTextActive: {
    color: "#ffffff",
  },
  originSearchBox: {
    backgroundColor: "#f8f8ff",
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderRadius: 6,
    padding: 10,
    gap: 8,
  },
  originInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderRadius: 6,
    paddingHorizontal: 10,
  },
  originInput: {
    flex: 1,
    paddingVertical: 8,
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 15,
    color: "#18222f",
  },
  originClearBtn: {
    paddingLeft: 8,
    paddingVertical: 4,
  },
  originClearText: {
    fontSize: 14,
    color: "#5a6472",
    fontFamily: "FiraSansCondensed_700Bold",
  },
  suggestionsList: {
    borderTopWidth: 1,
    borderTopColor: "rgba(24,34,47,0.12)",
    paddingTop: 4,
    gap: 4,
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 6,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "rgba(24,34,47,0.16)",
    borderRadius: 5,
  },
  suggestionBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  suggestionBadgePin: {
    backgroundColor: "#fc6c14",
  },
  suggestionBadgeGeo: {
    backgroundColor: "#18222f",
  },
  suggestionBadgeText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 10,
    letterSpacing: 0.5,
  },
  suggestionBadgeTextPin: {
    color: "#ffffff",
  },
  suggestionBadgeTextGeo: {
    color: "#ffffff",
  },
  suggestionTextWrap: {
    flex: 1,
  },
  suggestionName: {
    fontFamily: "FiraSansCondensed_600SemiBold",
    fontSize: 14,
    color: "#18222f",
  },
  suggestionSub: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 12,
    color: "#5a6472",
  },
  originHintText: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 13,
    color: "#5a6472",
    paddingVertical: 4,
  },
  profileRow: {
    flexDirection: "row",
    gap: 8,
  },
  profileBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    backgroundColor: "#f8f8ff",
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderRadius: 6,
  },
  profileBtnActive: {
    backgroundColor: "#fc6c14",
    borderColor: "#18222f",
  },
  profileBtnDisabled: {
    opacity: 0.45,
  },
  profileBtnText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 14,
    color: "#18222f",
  },
  profileBtnTextActive: {
    color: "#ffffff",
  },
  helperHint: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 13,
    color: "#5a6472",
    lineHeight: 18,
  },
  statusBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#f8f8ff",
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderRadius: 6,
    padding: 12,
  },
  statusBoxText: {
    fontFamily: "FiraSansCondensed_600SemiBold",
    fontSize: 14,
    color: "#18222f",
  },
  noticeBox: {
    backgroundColor: "#fff5ef",
    borderWidth: 1.5,
    borderColor: "#fc6c14",
    borderRadius: 6,
    padding: 10,
  },
  noticeText: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 13,
    color: "#18222f",
    lineHeight: 18,
  },
  errorBox: {
    backgroundColor: "#fff0ee",
    borderWidth: 1.5,
    borderColor: "#c0392b",
    borderRadius: 6,
    padding: 10,
  },
  errorText: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 13,
    color: "#c0392b",
    lineHeight: 18,
  },
  resultBox: {
    backgroundColor: "#f8f8ff",
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderRadius: 6,
    padding: 12,
    gap: 10,
  },
  resultHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  metricsWrap: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  durationText: {
    fontFamily: "Anton_400Regular",
    fontSize: 24,
    color: "#18222f",
  },
  distanceText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 16,
    color: "#fc6c14",
  },
  showOnMapCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fc6c14",
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderRadius: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  showOnMapCtaText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 14,
    color: "#ffffff",
  },
  stepsToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "rgba(24,34,47,0.14)",
    paddingTop: 8,
  },
  stepsToggleText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 13,
    color: "#18222f",
  },
  stepsToggleChevron: {
    fontSize: 12,
    color: "#fc6c14",
    fontFamily: "FiraSansCondensed_700Bold",
  },
  stepsList: {
    gap: 6,
    paddingTop: 4,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(24,34,47,0.08)",
  },
  stepIdxBadge: {
    width: 22,
    height: 22,
    borderRadius: 4,
    backgroundColor: "#18222f",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepIdxText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 11,
    color: "#ffffff",
  },
  stepInstruction: {
    flex: 1,
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 14,
    color: "#18222f",
    lineHeight: 19,
  },
  stepDist: {
    fontFamily: "FiraSansCondensed_600SemiBold",
    fontSize: 12,
    color: "#5a6472",
    marginTop: 2,
  },
});
