import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  Alert,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Mapbox, {
  Camera,
  MapView,
  LocationPuck,
  ShapeSource,
  CircleLayer,
  SymbolLayer,
  LineLayer,
  Images,
  Image as MapImage,
} from "@rnmapbox/maps";
import type { ComponentRef } from "react";
import { useRouter, useFocusEffect, useIsFocused } from "expo-router";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import * as Sentry from "@sentry/react-native";
import { useTabGpsCenter } from "@/hooks/useTabGpsCenter";
import { withPositionTimeout, locationErrorLevel } from "@/lib/location";
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
  const isFocused = useIsFocused();
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
  const selectedPlaceId = useRouteStore((s) => s.selectedPlaceId);
  const setSelectedPlaceId = useRouteStore((s) => s.setSelectedPlaceId);
  const fitBoundsTrigger = useRouteStore((s) => s.fitBoundsTrigger);
  const clearFocusTarget = useRouteStore((s) => s.clearFocusTarget);
  const pickOriginOnMap = useRouteStore((s) => s.pickOriginOnMap);
  const cancelPickingOnMap = useRouteStore((s) => s.cancelPickingOnMap);

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [bottomSectionHeight, setBottomSectionHeight] = useState(0);
  const [isLocatingUser, setIsLocatingUser] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);
  const {
    center: cameraCenter,
    zoom: cameraZoom,
    hasPermission: hasLocationPermission,
    markPermissionGranted,
  } = useTabGpsCenter(status === "success");
  const userLocationRef = useRef<[number, number] | null>(null);
  const shapeSourceRef = useRef<ComponentRef<typeof ShapeSource>>(null);
  const cameraRef = useRef<Camera>(null);

  // 1) Sprzętowy przycisk „Wstecz” na Androidzie anuluje tryb wyboru punktu na mapie
  //    (zamiast opuszczać ekran mapy).
  // 2) Przy opuszczeniu zakładki Karte automatycznie zamykamy otwartą listę podpowiedzi wyszukiwarki.
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (routeStatus === "picking-on-map") {
          cancelPickingOnMap();
          return true;
        }
        return false;
      };

      const subscription = BackHandler.addEventListener("hardwareBackPress", onBackPress);

      return () => {
        subscription.remove();
        searchRef.current?.hideSuggestions();
      };
    }, [routeStatus, cancelPickingOnMap]),
  );

  // GPS-Position kommt asynchron.
  const gpsAppliedRef = useRef(false);
  // Chroni przed sytuacją, w której użytkownik przeszedł z ekranu audiopinu
  // („Pin auf der FairFührer-Karte öffnen”), efekt `focusTarget` zdążył już wywołać
  // `setCamera` i `clearFocusTarget()`, a ułamek sekundy później asynchroniczny
  // `useTabGpsCenter` zwraca pozycję GPS i nadpisuje kamerę lokalizacją użytkownika.
  const hasExplicitCameraTargetRef = useRef(false);

  // Początkowe ustawienia kamery przy pierwszym montowaniu MapView — jeśli użytkownik
  // wszedł na zakładkę Karte po raz pierwszy poprzez „Pin auf der FairFührer-Karte öffnen”,
  // od razu startujemy w punkcie docelowym zamiast w domyślnym środku Niemiec.
  const initialCameraSettings = useMemo(() => {
    const initialFocus = useRouteStore.getState().focusTarget;
    return {
      centerCoordinate: initialFocus ? initialFocus.coords : cameraCenter,
      zoomLevel: initialFocus ? initialFocus.zoomLevel : cameraZoom,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Obsługa wycentrowania kamery na wybranym pinie („Pin auf der FairFührer-Karte öffnen”).
  // Czekamy, aż zakładka Karte będzie aktywna (isFocused) i styl Mapboxa gotowy (isMapReady),
  // aby wywołanie setCamera nie zostało odrzucone, gdy użytkownik kliknął przycisk
  // będąc jeszcze w modalu audiopinu otwartym z zakładki Liste (gdy zakładka Karte
  // była odłączona od okna Androida przez react-native-screens).
  useEffect(() => {
    if (!focusTarget || !isFocused || !isMapReady) return;
    hasExplicitCameraTargetRef.current = true;
    gpsAppliedRef.current = true;

    const targetCoords = focusTarget.coords;
    const targetZoom = focusTarget.zoomLevel;

    cameraRef.current?.setCamera({
      centerCoordinate: targetCoords,
      zoomLevel: targetZoom,
      animationMode: "flyTo",
      animationDuration: 650,
    });

    // Powtórz po krótkiej klatce (90 ms), gdy RNMBXMapView zakończy afterAttachFromLooper
    // po ponownym podłączeniu zakładki Karte do okna natywnego.
    const timer = setTimeout(() => {
      cameraRef.current?.setCamera({
        centerCoordinate: targetCoords,
        zoomLevel: targetZoom,
        animationMode: "flyTo",
        animationDuration: 650,
      });
      clearFocusTarget();
    }, 90);

    return () => clearTimeout(timer);
  }, [focusTarget, isFocused, isMapReady, clearFocusTarget]);

  useEffect(() => {
    if (cameraCenter[0] === 10.0 && cameraCenter[1] === 51.0) return; // Default
    // Zawsze zapisujemy współrzędne GPS użytkownika w userLocationRef, aby przycisk
    // celownika (⊕) miał je od razu pod ręką.
    userLocationRef.current = cameraCenter;

    if (gpsAppliedRef.current || hasExplicitCameraTargetRef.current) return;
    if (!isMapReady) return;
    // Nie nadpisuj widoku, jeśli użytkownik właśnie przeszedł z karty pinu
    // („Pin auf der Karte öffnen” lub aktywna trasa)
    if (useRouteStore.getState().focusTarget || useRouteStore.getState().routeResult) {
      gpsAppliedRef.current = true;
      return;
    }
    gpsAppliedRef.current = true;
    cameraRef.current?.setCamera({
      centerCoordinate: cameraCenter,
      zoomLevel: cameraZoom,
      animationMode: "flyTo",
      animationDuration: 800,
    });
  }, [cameraCenter, cameraZoom, isMapReady]);

  // Dopasowanie kamery (fitBounds) do wyznaczonej trasy Mapbox
  useEffect(() => {
    if (!isFocused || !isMapReady) return;
    if (!routeResult || !routeOrigin || !routeDestination?.location?.coordinates) return;
    hasExplicitCameraTargetRef.current = true;
    gpsAppliedRef.current = true;
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

    const ne: [number, number] = [maxLon, maxLat];
    const sw: [number, number] = [minLon, minLat];
    cameraRef.current?.fitBounds(ne, sw, [140, 48, 160, 48], 750);

    const timer = setTimeout(() => {
      cameraRef.current?.fitBounds(ne, sw, [140, 48, 160, 48], 750);
    }, 90);

    return () => clearTimeout(timer);
  }, [isFocused, isMapReady, routeResult, routeOrigin, routeDestination, fitBoundsTrigger]);

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

  // GeoJSON dla aktualnie wybranego / odkrywanego pinu (podświetlenie + etykieta na wierzchu mapy)
  const selectedPinGeoJSON = useMemo<GeoJSON.FeatureCollection>(() => {
    if (selectedPlaceId === null) return EMPTY_POINT_GEOJSON;
    const selectedPlace = allPlaces.find((p) => p.id === selectedPlaceId);
    if (!selectedPlace?.location?.coordinates) return EMPTY_POINT_GEOJSON;
    const cat = selectedPlace.Kategorie?.[0]?.Kategorie_id ?? null;
    const catId = cat?.id ?? null;
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: selectedPlace.location.coordinates,
          },
          properties: {
            placeId: selectedPlace.id,
            placeName: selectedPlace.Name,
            locked: lockedIds.has(selectedPlace.id) ? 1 : 0,
            categoryColor: categoryColorFor(cat),
            categoryIcon: iconName(catId),
          },
        },
      ],
    };
  }, [allPlaces, lockedIds, selectedPlaceId]);

  const handleSelectGeo = useCallback(
    (item: {
      name: string;
      lat: number;
      lon: number;
      isLocalPlace: boolean;
      cityName?: string;
    }) => {
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
      // w normalnym trybie centruje mapę na tym pinie, zaznacza go wizualnie i otwiera szczegóły
      const placeId = feature.properties.placeId as number;
      const isLocked = feature.properties.locked === 1;
      if (!placeId) return;

      const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];

      if (useRouteStore.getState().status === "picking-on-map") {
        const clickedPlace = usePlacesStore.getState().placesById.get(placeId);
        void pickOriginOnMap(coords, clickedPlace);
        return;
      }

      searchRef.current?.hideSuggestions();
      setSelectedPlaceId(placeId);
      hasExplicitCameraTargetRef.current = true;

      if (Array.isArray(coords) && coords.length >= 2) {
        cameraRef.current?.setCamera({
          centerCoordinate: coords,
          animationMode: "easeTo",
          animationDuration: 450,
        });
      }

      if (isLocked) {
        router.navigate("/custom-paywall");
        return;
      }

      router.navigate(`/place/${placeId}`);
    },
    [router, cameraZoom, pickOriginOnMap, setSelectedPlaceId],
  );

  const handleBlankMapPress = useCallback(
    (feature: GeoJSON.Feature) => {
      searchRef.current?.hideSuggestions();
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
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
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
            onDidFinishLoadingMap={() => setIsMapReady(true)}
            onPress={handleBlankMapPress}
          >
            <Camera
              ref={cameraRef}
              defaultSettings={initialCameraSettings}
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
              promoteId="placeId"
              shape={geoJSON}
              cluster
              clusterRadius={50}
              clusterMaxZoomLevel={14}
              onPress={handleMapPress}
            >
              {/* Klastry — koła w palecie barw marki FairFührer (#2e7d32, #fc6c14, #18222f), zsynchronizowane z Web App */}
              <CircleLayer
                id="clusters"
                filter={["has", "point_count"]}
                style={{
                  circleColor: [
                    "step",
                    ["get", "point_count"],
                    "#2e7d32",
                    10,
                    "#fc6c14",
                    30,
                    "#18222f",
                  ],
                  circleRadius: ["step", ["get", "point_count"], 21, 10, 26, 30, 32],
                  circleStrokeWidth: 3,
                  circleStrokeColor: "#ffffff",
                }}
              />

              {/* Liczba w klastrze */}
              <SymbolLayer
                id="cluster-count"
                filter={["has", "point_count"]}
                style={{
                  textField: ["get", "point_count_abbreviated"],
                  textSize: 14,
                  textColor: "#ffffff",
                  textFont: ["DIN Offc Pro Bold", "Arial Unicode MS Bold"],
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

            {/* Aktualnie wybrany / odkrywany pin — wyróżniony pierścieniem FairFührer,
                powiększoną ikoną kategorii (jak `places-selected` na Webie) oraz etykietą z nazwą */}
            <ShapeSource
              id="fairfuehrer-selected-pin"
              shape={selectedPinGeoJSON}
              onPress={handleMapPress}
            >
              <CircleLayer
                id="selected-pin-outer-ring"
                style={{
                  circleRadius: 23,
                  circleColor: "rgba(252, 108, 20, 0.24)",
                  circleStrokeWidth: 2.5,
                  circleStrokeColor: "#fc6c14",
                }}
              />
              <CircleLayer
                id="selected-pin-inner-halo"
                style={{
                  circleRadius: 17.5,
                  circleColor: "#ffffff",
                  circleStrokeWidth: 2.5,
                  circleStrokeColor: "#18222f",
                }}
              />
              <SymbolLayer
                id="selected-pin-symbol"
                style={{
                  iconImage: ["get", "categoryIcon"],
                  iconSize: 1.32,
                  iconAllowOverlap: true,
                  iconIgnorePlacement: true,
                  textField: ["get", "placeName"],
                  textFont: ["DIN Offc Pro Bold", "Arial Unicode MS Bold"],
                  textSize: 13,
                  textOffset: [0, 1.9],
                  textAnchor: "top",
                  textMaxWidth: 14,
                  textColor: "#18222f",
                  textHaloColor: "#ffffff",
                  textHaloWidth: 2.2,
                  textAllowOverlap: true,
                  textOptional: true,
                }}
              />
            </ShapeSource>

            {/* Natywny LocationPuck (GPU) montujemy dopiero po potwierdzeniu uprawnień
                lokalizacji (hasLocationPermission) i nie odmontowujemy go przy utracie
                fokusu zakładki — zamiast tego sterujemy jego widocznością przez `visible={isFocused}`.
                Zapobiega to wyścigom `RNMBXNativeUserLocation` na Androidzie przy pierwszym
                oknie uprawnień oraz przy przejściach Liste -> Audiopin -> Karte. */}
            {hasLocationPermission && (
              <LocationPuck
                puckBearingEnabled
                puckBearing="heading"
                pulsing="default"
                visible={isFocused}
              />
            )}
          </MapView>
        )}
      </View>

      {/* Przycisk powrotu do lokalizacji użytkownika (⊕). Priorytet:
          1. Gdy uprawnienie jest już przyznane: getLastKnownPositionAsync (0 ms odczyt z cache
             systemowego aktualizowanego na bieżąco przez natywny silnik LocationPuck) lub userLocationRef
          2. Gdy brak uprawnienia lub pozycji w cache: prośba o uprawnienie + getCurrentPositionAsync
             ze spinnerem i czytelnym komunikatem */}
      <TouchableOpacity
        style={styles.gpsBtn}
        disabled={isLocatingUser}
        onPress={async () => {
          void Haptics.selectionAsync().catch(() => {});

          if (hasLocationPermission) {
            const recentPos = await Location.getLastKnownPositionAsync({
              maxAge: 60_000,
            }).catch(() => null);
            const targetCoords: [number, number] | null = recentPos
              ? [recentPos.coords.longitude, recentPos.coords.latitude]
              : userLocationRef.current;

            if (targetCoords) {
              userLocationRef.current = targetCoords;
              cameraRef.current?.setCamera({
                centerCoordinate: targetCoords,
                zoomLevel: 13,
                animationMode: "flyTo",
                animationDuration: 600,
              });
              return;
            }
          }

          setIsLocatingUser(true);
          Sentry.addBreadcrumb({
            category: "gps",
            level: "info",
            message: "gps-button fallback (requesting fresh fix)",
          });

          try {
            const { status: permStatus, canAskAgain } =
              await Location.requestForegroundPermissionsAsync();
            if (permStatus !== "granted") {
              Sentry.captureMessage("gps-button: permission not granted", {
                level: "warning",
                tags: { feature: "gps-button" },
                extra: { status: permStatus },
              });
              Alert.alert(
                "Standort benötigt",
                "Um deinen Standort auf der Karte anzuzeigen, aktiviere bitte den Standortzugriff für Fairführer.",
                canAskAgain
                  ? [{ text: "OK" }]
                  : [
                      { text: "Abbrechen", style: "cancel" },
                      {
                        text: "Einstellungen",
                        onPress: () => {
                          void Linking.openSettings().catch(() => {});
                        },
                      },
                    ],
              );
              return;
            }

            // Powiadom hook, aby natychmiast zamontować <LocationPuck> bez potrzeby przeładowania
            markPermissionGranted();

            // 1) Najpierw spróbuj ostatniej znanej pozycji z systemu (0 ms czekania).
            //    Jeśli jest świeża, od razu przesuwamy kamerę, nie blokując użytkownika.
            const lastPos = await Location.getLastKnownPositionAsync({
              maxAge: 300_000,
            }).catch(() => null);

            if (lastPos) {
              const lastCoords: [number, number] = [
                lastPos.coords.longitude,
                lastPos.coords.latitude,
              ];
              userLocationRef.current = lastCoords;
              cameraRef.current?.setCamera({
                centerCoordinate: lastCoords,
                zoomLevel: 13,
                animationMode: "flyTo",
                animationDuration: 600,
              });
              return;
            }

            // 2) Jeśli brak pozycji w cache — pobierz świeży fix GPS z timeoutem
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
            Sentry.captureException(e, {
              level: locationErrorLevel(e),
              tags: { feature: "gps-button" },
            });
            Alert.alert(
              "Standort nicht verfügbar",
              "Dein aktueller GPS-Standort konnte nicht ermittelt werden. Bitte prüfe, ob die Ortungsdienste aktiviert sind.",
            );
          } finally {
            setIsLocatingUser(false);
          }
        }}
        activeOpacity={0.8}
      >
        {isLocatingUser ? (
          <ActivityIndicator size="small" color="#fc6c14" />
        ) : (
          <Text style={styles.gpsBtnText}>⊕</Text>
        )}
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
