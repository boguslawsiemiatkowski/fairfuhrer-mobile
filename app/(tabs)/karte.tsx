import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Mapbox, {
  Camera,
  MapView,
  UserLocation,
  LocationPuck,
  ShapeSource,
  CircleLayer,
  SymbolLayer,
  LineLayer,
  Images,
  Image as MapImage,
} from "@rnmapbox/maps";
import type { ComponentRef } from "react";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import * as Sentry from "@sentry/react-native";
import { useTabGpsCenter } from "@/hooks/useTabGpsCenter";
import { withPositionTimeout } from "@/lib/location";
import { usePlacesStore } from "@/stores/placesStore";
import { useRouteStore } from "@/stores/routeStore";
import { useAuth } from "@/context/AuthContext";
import type { DirectusOrte } from "@/types";
import HomeHeader from "@/components/HomeHeader";
import { CategoryIcon, CATEGORY_COLORS, categoryColorFor } from "@/components/CategoryIcon";
import { KategorieBar } from "@/components/KategorieBar";
import { SearchSection, type SearchSectionHandle } from "@/components/SearchSection";
import { MapRouteOverlay } from "@/components/MapRouteOverlay";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";

Mapbox.setAccessToken(MAPBOX_TOKEN);
Mapbox.setTelemetryEnabled(false);

const DEFAULT_COLOR = "#fc6c14";

// ─── Pin-Icons ───────────────────────────────────────────────────────────────
// Die Pins tragen dieselben Icons wie die Kategorie-Leiste. Möglich, weil
// <Image> aus @rnmapbox/maps eine React-View entgegennimmt und sie zu einem
// Karten-Icon rastert — wir rendern also direkt <CategoryIcon> statt eigene
// PNGs zu pflegen. Namen der Icons müssen zur `categoryIcon`-Property im
// GeoJSON passen.
const ICON_CATEGORY_IDS = Object.keys(CATEGORY_COLORS).map(Number);
const ICON_NAME_DEFAULT = "cat-default";
const iconName = (catId: number | null) =>
  catId !== null && CATEGORY_COLORS[catId] ? `cat-${catId}` : ICON_NAME_DEFAULT;
// Größe der gerasterten View in pt. Etwas größer als die früheren Kreise
// (r=10), sonst wäre das Icon im Pin nicht lesbar.
const ICON_SIZE = 26;
// Radius des weißen Halos darunter — ersetzt den früheren circleStroke und
// hält die Pins auf bunten Karten-Hintergründen erkennbar.
const ICON_HALO_RADIUS = 13.5;

// ─── GeoJSON builder ──────────────────────────────────────────────────────────

function placesToGeoJSON(
  places: DirectusOrte[],
  lockedIds: Set<number>,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: places
      .filter((p) => p.location?.coordinates)
      .map((p) => {
        const cat = p.Kategorie?.[0]?.Kategorie_id ?? null;
        const catId = cat?.id ?? null;
        return {
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: p.location!.coordinates,
          },
          properties: {
            placeId: p.id,
            locked: lockedIds.has(p.id) ? 1 : 0,
            // Abgedunkelt wie im Web: der Pin trägt das Symbol in Weiß.
            categoryColor: categoryColorFor(cat),
            categoryIcon: iconName(catId),
          },
        };
      }),
  };
}

const EMPTY_LINE_GEOJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const EMPTY_POINT_GEOJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

// Memoizowane ikony kategorii dla Mapboxa — zapobiega ponownej rasteryzacji
// widoków React na tekstury GPU przy zmianach stanu ekranu.
const MapPinImages = React.memo(function MapPinImages() {
  return (
    <Images>
      {ICON_CATEGORY_IDS.map((id) => (
        <MapImage key={id} name={`cat-${id}`}>
          <CategoryIcon
            categoryId={id}
            color={categoryColorFor({ id, Farbe: CATEGORY_COLORS[id] })}
            size={ICON_SIZE}
          />
        </MapImage>
      ))}
      <MapImage name={ICON_NAME_DEFAULT}>
        <CategoryIcon categoryId={-1} color={DEFAULT_COLOR} size={ICON_SIZE} />
      </MapImage>
    </Images>
  );
});

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function KarteScreen() {
  const router = useRouter();
  const searchRef = useRef<SearchSectionHandle>(null);

  const allCategories = usePlacesStore((s) => s.categories);
  const einstellungen = usePlacesStore((s) => s.einstellungen);
  const status = usePlacesStore((s) => s.status);
  const isOffline = usePlacesStore((s) => s.isOffline);
  const allPlaces = usePlacesStore((s) => s.places);
  const lockedSightsIds = usePlacesStore((s) => s.lockedSightsIds);

  const { isPro } = useAuth();
  const lockedIds = useMemo(
    () => (isPro ? new Set<number>() : lockedSightsIds),
    [isPro, lockedSightsIds],
  );
  const isLoading = status === "loading" || status === "idle";

  // Stan wbudowanego Routenplanera (Mapbox)
  const routeOrigin = useRouteStore((s) => s.origin);
  const routeDestination = useRouteStore((s) => s.destination);
  const routeResult = useRouteStore((s) => s.routeResult);
  const routeStatus = useRouteStore((s) => s.status);
  const focusTarget = useRouteStore((s) => s.focusTarget);
  const fitBoundsTrigger = useRouteStore((s) => s.fitBoundsTrigger);
  const clearFocusTarget = useRouteStore((s) => s.clearFocusTarget);
  const pickOriginOnMap = useRouteStore((s) => s.pickOriginOnMap);

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [bottomSectionHeight, setBottomSectionHeight] = useState(0);
  const { center: cameraCenter, zoom: cameraZoom } = useTabGpsCenter(status === "success");
  const userLocationRef = useRef<[number, number] | null>(null);
  const puckSeenRef = useRef(false);
  const shapeSourceRef = useRef<ComponentRef<typeof ShapeSource>>(null);
  const cameraRef = useRef<Camera>(null);

  // GPS-Position kommt asynchron.
  const gpsAppliedRef = useRef(false);
  useEffect(() => {
    if (gpsAppliedRef.current) return;
    if (cameraCenter[0] === 10.0 && cameraCenter[1] === 51.0) return; // Default
    gpsAppliedRef.current = true;
    // Nie nadpisuj widoku, jeśli użytkownik właśnie przeszedł z karty pinu
    // („Pin auf der Karte öffnen” lub aktywna trasa)
    if (useRouteStore.getState().focusTarget || useRouteStore.getState().routeResult) {
      return;
    }
    cameraRef.current?.setCamera({
      centerCoordinate: cameraCenter,
      zoomLevel: cameraZoom,
      animationMode: "flyTo",
      animationDuration: 800,
    });
  }, [cameraCenter, cameraZoom]);

  // Obsługa wycentrowania kamery na wybranym pinie („Pin auf der FairFührer-Karte öffnen”)
  useEffect(() => {
    if (!focusTarget) return;
    cameraRef.current?.setCamera({
      centerCoordinate: focusTarget.coords,
      zoomLevel: focusTarget.zoomLevel,
      animationMode: "flyTo",
      animationDuration: 650,
    });
    clearFocusTarget();
  }, [focusTarget, clearFocusTarget]);

  // Dopasowanie kamery (fitBounds) do wyznaczonej trasy Mapbox
  useEffect(() => {
    if (!routeResult || !routeOrigin || !routeDestination?.location?.coordinates) return;
    const coords = routeResult.geometry.coordinates as [number, number][];
    if (coords.length === 0) return;

    let minLon = routeOrigin.coords[0];
    let maxLon = routeOrigin.coords[0];
    let minLat = routeOrigin.coords[1];
    let maxLat = routeOrigin.coords[1];

    const extend = (pt: [number, number]) => {
      if (pt[0] < minLon) minLon = pt[0];
      if (pt[0] > maxLon) maxLon = pt[0];
      if (pt[1] < minLat) minLat = pt[1];
      if (pt[1] > maxLat) maxLat = pt[1];
    };

    extend(routeDestination.location.coordinates);
    for (const c of coords) {
      extend(c);
    }

    cameraRef.current?.fitBounds(
      [maxLon, maxLat],
      [minLon, minLat],
      [140, 48, 160, 48],
      750,
    );
  }, [routeResult, routeOrigin, routeDestination, fitBoundsTrigger]);

  // GeoJSON dla linii trasy oraz punktu startowego (START)
  const routeGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!routeResult) return EMPTY_LINE_GEOJSON;
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: routeResult.geometry,
        },
      ],
    };
  }, [routeResult]);

  const routeOriginGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!routeOrigin) return EMPTY_POINT_GEOJSON;
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { label: "Start" },
          geometry: {
            type: "Point",
            coordinates: routeOrigin.coords,
          },
        },
      ],
    };
  }, [routeOrigin]);

  // GeoJSON — przeliczany tylko gdy zmienia się lista lub filtr
  const geoJSON = useMemo(() => {
    const filtered =
      selectedCategoryId === null
        ? allPlaces
        : allPlaces.filter((p) =>
            p.Kategorie?.some((k) => k.Kategorie_id?.id === selectedCategoryId),
          );
    return placesToGeoJSON(filtered, lockedIds);
  }, [allPlaces, lockedIds, selectedCategoryId]);

  const handleSelectGeo = useCallback(
    (item: { name: string; lat: number; lon: number; isLocalPlace: boolean; cityName?: string }) => {
      searchRef.current?.hideSuggestions();
      cameraRef.current?.setCamera({
        centerCoordinate: [item.lon, item.lat],
        zoomLevel: 13,
        animationMode: "flyTo",
        animationDuration: 800,
      });
    },
    [],
  );

  const handleMapPress = useCallback(
    async (event: { features: GeoJSON.Feature[] }) => {
      const feature = event.features[0];
      if (!feature?.properties) return;

      const isCluster = feature.properties.cluster === true;

      if (isCluster) {
        // Zoom do poziomu rozwinięcia klastra
        const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
        try {
          const zoom = await shapeSourceRef.current?.getClusterExpansionZoom(feature);
          if (zoom != null) {
            cameraRef.current?.setCamera({
              centerCoordinate: coords,
              zoomLevel: zoom,
              animationDuration: 500,
              animationMode: "flyTo",
            });
          }
        } catch {
          // fallback — zoom o 2 poziomy
          cameraRef.current?.setCamera({
            centerCoordinate: coords,
            zoomLevel: Math.min(cameraZoom + 2, 20),
            animationMode: "flyTo",
            animationDuration: 300,
          });
        }
        return;
      }

      // Pojedynczy pin — w trybie wyboru punktu startowego trasy ustawia ten pin jako Start;
      // w normalnym trybie otwiera szczegóły (lub paywall, gdy zablokowany)
      const placeId = feature.properties.placeId as number;
      const isLocked = feature.properties.locked === 1;
      if (!placeId) return;

      if (useRouteStore.getState().status === "picking-on-map") {
        const clickedPlace = usePlacesStore.getState().placesById.get(placeId);
        const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
        void pickOriginOnMap(coords, clickedPlace);
        return;
      }

      searchRef.current?.hideSuggestions();

      if (isLocked) {
        router.push("/custom-paywall");
        return;
      }

      router.push(`/place/${placeId}`);
    },
    [router, cameraZoom, pickOriginOnMap],
  );

  const handleBlankMapPress = useCallback(
    (feature: GeoJSON.Feature) => {
      if (useRouteStore.getState().status !== "picking-on-map") return;
      if (feature?.geometry?.type === "Point") {
        const coords = feature.geometry.coordinates as [number, number];
        if (Array.isArray(coords) && coords.length >= 2) {
          void pickOriginOnMap([coords[0], coords[1]]);
        }
      }
    },
    [pickOriginOnMap],
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <HomeHeader einstellungen={einstellungen} />

      {/* Offline-Hinweis — sichtbar, wenn gespeicherte Daten verwendet werden */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            Offline-Modus – es werden gespeicherte Daten angezeigt. Fotos und Audioguides sind
            möglicherweise nicht verfügbar.
          </Text>
        </View>
      )}

      {/* Mapa */}
      <View style={styles.mapArea}>
        {/* Nakładka wbudowanego Routenplanera (widoczna gdy aktywna jest trasa lub wybór punktu) */}
        <MapRouteOverlay />

        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#fc6c14" />
          </View>
        ) : (
          <MapView
            style={styles.map}
            styleURL={Mapbox.StyleURL.Street}
            localizeLabels={{ locale: "de" }}
            compassEnabled
            onPress={handleBlankMapPress}
          >
            <Camera
              ref={cameraRef}
              defaultSettings={{
                centerCoordinate: cameraCenter,
                zoomLevel: cameraZoom,
              }}
              animationMode="flyTo"
              animationDuration={800}
            />

            <MapPinImages />

            {/* Warstwa wyznaczonej trasy Mapbox (pod pinami, jak na Webie) */}
            <ShapeSource id="fairfuehrer-route-source" shape={routeGeoJSON}>
              <LineLayer
                id="fairfuehrer-route-casing"
                style={{
                  lineColor: "#18222f",
                  lineWidth: 9,
                  lineOpacity: 0.92,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
              <LineLayer
                id="fairfuehrer-route-line"
                style={{
                  lineColor: "#fc6c14",
                  lineWidth: 5,
                  lineOpacity: 1,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
            </ShapeSource>

            {/* Punkt startowy trasy (START) */}
            <ShapeSource id="fairfuehrer-route-origin" shape={routeOriginGeoJSON}>
              <CircleLayer
                id="fairfuehrer-route-origin-outer"
                style={{
                  circleRadius: 10,
                  circleColor: "#18222f",
                  circleStrokeWidth: 2.5,
                  circleStrokeColor: "#ffffff",
                }}
              />
              <CircleLayer
                id="fairfuehrer-route-origin-inner"
                style={{
                  circleRadius: 4.5,
                  circleColor: "#fc6c14",
                }}
              />
            </ShapeSource>

            {/* Jeden source dla wszystkich miejsc — klastry natywnie w GPU */}
            <ShapeSource
              ref={shapeSourceRef}
              id="places"
              shape={geoJSON}
              cluster
              clusterRadius={50}
              clusterMaxZoomLevel={14}
              onPress={handleMapPress}
            >
              {/* Klastry — koła */}
              <CircleLayer
                id="clusters"
                filter={["has", "point_count"]}
                style={{
                  circleColor: [
                    "step",
                    ["get", "point_count"],
                    "#51bbd6",
                    10,
                    "#f1f075",
                    30,
                    "#f28cb1",
                  ],
                  circleRadius: ["step", ["get", "point_count"], 20, 10, 30, 30, 40],
                  circleStrokeWidth: 2,
                  circleStrokeColor: "#fff",
                }}
              />

              {/* Liczba w klastrze */}
              <SymbolLayer
                id="cluster-count"
                filter={["has", "point_count"]}
                style={{
                  textField: ["get", "point_count_abbreviated"],
                  textSize: 20,
                  textColor: "#fff",
                  textFont: ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
                  textHaloColor: "#000",
                  textHaloWidth: 0.3,
                }}
              />

              {/* Pojedyncze piny — biały halo pod spodem, ikona kategorii na
                  wierzchu. Kolejność JSX = kolejność warstw. */}
              <CircleLayer
                id="unclustered-halo"
                filter={["!", ["has", "point_count"]]}
                style={{
                  circleColor: "#fff",
                  circleRadius: ICON_HALO_RADIUS,
                }}
              />
              <SymbolLayer
                id="unclustered"
                filter={["!", ["has", "point_count"]]}
                style={{
                  iconImage: ["get", "categoryIcon"],
                  // Piny nie mogą znikać przy zagęszczeniu — dotąd były to
                  // koła, które Mapbox rysuje zawsze. Bez tych dwóch flag
                  // symbol-collision ukrywałby część pinów.
                  iconAllowOverlap: true,
                  iconIgnorePlacement: true,
                }}
              />
            </ShapeSource>

            {/* Puck (natywny GPU renderer) MUSI byc ostatnim dzieckiem MapView,
                zeby byl rysowany NA WIERZCHU pinow. W Mapbox React Native
                kolejnosc JSX = kolejnosc warstw.
                W 10.3.x <UserLocation> jest deprecated i w praktyce w 10.3.2
                przestal renderowac puck na Androidzie. LocationPuck to nastepca
                (natywny), a osobny <UserLocation visible={false} onUpdate>
                zostaje tylko po to, zeby dostac coords do userLocationRef
                (uzywane przez globus) — puck sie nie duplikuje, bo visible=false. */}
            <LocationPuck puckBearingEnabled puckBearing="heading" visible />
            <UserLocation
              visible={false}
              onUpdate={(loc) => {
                userLocationRef.current = [loc.coords.longitude, loc.coords.latitude];
                if (!puckSeenRef.current) {
                  puckSeenRef.current = true;
                  Sentry.addBreadcrumb({
                    category: "gps",
                    level: "info",
                    message: "UserLocation puck first fix",
                    data: { lon: loc.coords.longitude, lat: loc.coords.latitude },
                  });
                }
              }}
            />
          </MapView>
        )}
      </View>

      {/* Przycisk powrotu do lokalizacji. Priorytet:
          1. userLocationRef (aktualizowany przez UserLocation.onUpdate)
          2. Fallback: getCurrentPositionAsync (gdy Mapbox jeszcze nie
             odpalił onUpdate — np. tuz po otwarciu Karte) */}
      <TouchableOpacity
        style={styles.gpsBtn}
        onPress={async () => {
          if (userLocationRef.current) {
            cameraRef.current?.setCamera({
              centerCoordinate: userLocationRef.current,
              zoomLevel: 13,
              animationMode: "flyTo",
              animationDuration: 600,
            });
            return;
          }
          // Fallback: puck jeszcze nie dostarczył fixa (onUpdate nie odpalił).
          // Diagnostyka wysyła do Sentry realną przyczynę zamiast po cichu nic
          // nie robić.
          Sentry.addBreadcrumb({
            category: "gps",
            level: "info",
            message: "gps-button fallback (puck ref empty)",
          });
          try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== "granted") {
              Sentry.captureMessage("gps-button: permission not granted", {
                level: "warning",
                tags: { feature: "gps-button" },
                extra: { status },
              });
              return;
            }
            // getCurrentPositionAsync nie ma wbudowanego timeoutu i potrafi
            // wisieć w nieskonczonosc bez fixa GPS. Wspolny helper zamiast
            // lokalnego Promise.race — ten zostawial wiszacy setTimeout takze
            // wtedy, gdy pozycja przyszla na czas.
            const pos = await withPositionTimeout(
              Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
            );
            const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
            userLocationRef.current = coords;
            cameraRef.current?.setCamera({
              centerCoordinate: coords,
              zoomLevel: 13,
              animationMode: "flyTo",
              animationDuration: 600,
            });
          } catch (e) {
            Sentry.captureException(e, { tags: { feature: "gps-button" } });
          }
        }}
        activeOpacity={0.8}
      >
        <Text style={styles.gpsBtnText}>⊕</Text>
      </TouchableOpacity>

      {/* Dolna sekcja — tylko wyszukiwarka */}
      <View
        style={styles.bottomSection}
        onLayout={(e) => setBottomSectionHeight(e.nativeEvent.layout.height)}
      >
        <SearchSection
          ref={searchRef}
          onSelectGeo={handleSelectGeo}
          onClear={() => {}}
          bottomSectionHeight={bottomSectionHeight}
          selectedCategoryId={selectedCategoryId}
        />
        {/* Pasek kategorii — pod wyszukiwarką */}
        <KategorieBar
          categories={allCategories}
          selectedId={selectedCategoryId}
          onSelect={setSelectedCategoryId}
          isPro={isPro}
        />
      </View>

      {/* Sugestie — absolute nad bottomSection, poza jego drzewem */}
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  offlineBanner: {
    backgroundColor: "#fff5ef",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#fcd9c2",
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  offlineBannerText: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 12,
    color: "#7a4a22",
    textAlign: "center",
    lineHeight: 16,
  },
  mapArea: { flex: 1 },
  map: { flex: 1 },
  bottomSection: { position: "relative", zIndex: 10 },
  gpsBtn: {
    position: "absolute",
    right: 14,
    bottom: 120,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#ccc",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    zIndex: 20,
  },
  gpsBtnText: { fontSize: 26, color: "#fc6c14", lineHeight: 26 },
});
