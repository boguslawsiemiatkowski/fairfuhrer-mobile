import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  Linking,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect, useScrollToTop } from "expo-router";
import Svg, { Polygon, Circle } from "react-native-svg";
import { usePlacesStore } from "@/stores/placesStore";
import { useAuth } from "@/context/AuthContext";
import { usePlaylistStore } from "@/stores/playlistStore";
import { getAudioUrl } from "@/lib/mediaUrls";
import HomeHeader from "@/components/HomeHeader";
import { PinCard } from "@/components/PinCard";
import { PinCardSkeleton, SkeletonBlock } from "@/components/SkeletonLoader";
import { KategorieBar } from "@/components/KategorieBar";
import { SearchSection, type SearchSectionHandle } from "@/components/SearchSection";
import { CityChips, placesInRegion, type Region } from "@/components/CityChips";
import { distanceInMeters } from "@/stores/routeStore";
import { useGpsSort } from "@/hooks/useGpsSort";

const CARD_GAP = 12; // odstęp między kartami i od lewej krawędzi
const CARD_PEEK = 44; // ile px następnej karty widać po prawej
const MAX_CARD_WIDTH = 420; // cap dla tabletów — karta nie szersza niż na większym telefonie
const NEARBY_SEARCH_RADIUS_M = 20_000; // 20 km dla miejscowości spoza dokładnych nazw Stadt

const keyExtractor = (id: number) => String(id);

function normalizeCity(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .trim();
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ListeScreen() {
  const {
    categories: allCategories,
    einstellungen,
    status,
    error,
    isOffline,
    fetchAll,
    getAllPlacesWithLocked,
  } = usePlacesStore();
  const { isPro } = useAuth();
  const router = useRouter();
  const searchRef = useRef<SearchSectionHandle>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // Wymiary kart — capped dla tabletów, wycentrowane gdy ekran szerszy niż karta + peek.
  // Wysokość ograniczona wysokością ekranu, żeby chipsy/search/kategoryBar się mieściły.
  const { CARD_WIDTH, CARD_HEIGHT, CARD_STEP, LIST_HORIZONTAL_PADDING } = useMemo(() => {
    const naturalWidth = screenWidth - CARD_GAP * 2 - CARD_PEEK;
    const width = Math.min(naturalWidth, MAX_CARD_WIDTH);
    const step = width + CARD_GAP;
    // Pad po lewej, żeby na szerokich ekranach karta + peek były wycentrowane
    const padding = Math.max(CARD_GAP, (screenWidth - width - CARD_PEEK) / 2);
    // Wysokość: max ~38% ekranu — zostawia ~62% na header + GPS label + chipsy + search + kategorie.
    // Na telefonie portrait najczęściej ograniczy aspect ratio (1.1× szerokości), na tablecie height.
    const height = Math.min(width * 1.1, screenHeight * 0.38);
    return {
      CARD_WIDTH: width,
      CARD_HEIGHT: height,
      CARD_STEP: step,
      LIST_HORIZONTAL_PADDING: padding,
    };
  }, [screenWidth, screenHeight]);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: CARD_STEP,
      offset: LIST_HORIZONTAL_PADDING + CARD_STEP * index,
      index,
    }),
    [CARD_STEP, LIST_HORIZONTAL_PADDING],
  );

  const flatListHeader = useMemo(
    () => <View style={{ width: LIST_HORIZONTAL_PADDING }} />,
    [LIST_HORIZONTAL_PADDING],
  );

  // All places shown; locked ones open paywall on tap (same logic as map).
  const { places: allPlaces } = useMemo(
    () => getAllPlacesWithLocked(isPro),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getAllPlacesWithLocked, isPro, status],
  );
  const isLoading = status === "loading" || status === "idle";

  const { orderedIds, status: gpsStatus, sortByLocation } = useGpsSort(status === "success");

  // Dauerhaft abgelehnte Berechtigung lässt sich in der App nicht mehr
  // erfragen — dann führt der Button in die Systemeinstellungen.
  const handleSortByLocation = useCallback(() => {
    if (gpsStatus === "blocked") {
      Linking.openSettings().catch(() => {});
      return;
    }
    sortByLocation();
  }, [gpsStatus, sortByLocation]);

  // Kurz halten: die Zeile teilt sich den Platz mit "Alle abspielen".
  const gpsButtonLabel =
    gpsStatus === "blocked"
      ? "Standort aktivieren"
      : gpsStatus === "error"
        ? "Standort erneut suchen"
        : "Nach Entfernung sortieren";

  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [selectedSearchPlace, setSelectedSearchPlace] = useState<{
    name: string;
    lat: number;
    lon: number;
    cityName?: string;
  } | null>(null);

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const flatListRef = useRef<FlatList<number>>(null);
  // Tapnięcie w aktywną zakładkę Liste na dolnym pasku przewija poziomą karuzelę kart do początku
  useScrollToTop(flatListRef);
  const [bottomSectionHeight, setBottomSectionHeight] = useState(0);

  // Fetch danych przy pierwszym montowaniu.
  useEffect(() => {
    fetchAll(isPro);
  }, [fetchAll, isPro]);

  // Automatyczne chowanie otwartej listy sugestii wyszukiwarki przy opuszczeniu zakładki Liste
  useFocusEffect(
    useCallback(() => {
      return () => {
        searchRef.current?.hideSuggestions();
      };
    }, []),
  );

  // 1. Filtrowanie po wybranym miejscu geograficznym z wyszukiwarki (np. Lindau, Bregenz):
  //    - Jeśli nazwa pasuje do miasta (Stadt) w naszym katalogu, filtrujemy dokładnie do tego miasta
  //      (i sortujemy od środka wyszukanego punktu).
  //    - Jeśli użytkownik wybrał z Mapboxa miejscowość/region, który nie ma własnego wpisu Stadt,
  //      pokazujemy piny w promieniu 20 km posortowane według odległości.
  const searchFilteredPlaces = useMemo(() => {
    if (!selectedSearchPlace) return allPlaces;

    const targetCityNorm = normalizeCity(selectedSearchPlace.cityName ?? selectedSearchPlace.name);
    const exactCityMatches = allPlaces.filter((p) => {
      const pCity = normalizeCity(p.Stadt);
      if (!pCity || !targetCityNorm) return false;
      return (
        pCity === targetCityNorm ||
        pCity.startsWith(`${targetCityNorm} `) ||
        pCity.startsWith(`${targetCityNorm},`) ||
        pCity.startsWith(`${targetCityNorm}(`)
      );
    });

    const centerCoords: [number, number] = [selectedSearchPlace.lon, selectedSearchPlace.lat];

    if (exactCityMatches.length > 0) {
      return [...exactCityMatches].sort((a, b) => {
        const da = a.location?.coordinates
          ? distanceInMeters(centerCoords, a.location.coordinates)
          : 999999;
        const db = b.location?.coordinates
          ? distanceInMeters(centerCoords, b.location.coordinates)
          : 999999;
        return da - db;
      });
    }

    // Fallback geograficzny: piny w promieniu 20 km od wybranej miejscowości
    return allPlaces
      .filter((p) => {
        if (!p.location?.coordinates) return false;
        return distanceInMeters(centerCoords, p.location.coordinates) <= NEARBY_SEARCH_RADIUS_M;
      })
      .sort((a, b) => {
        const da = distanceInMeters(centerCoords, a.location!.coordinates);
        const db = distanceInMeters(centerCoords, b.location!.coordinates);
        return da - db;
      });
  }, [allPlaces, selectedSearchPlace]);

  // 2. Filtrowanie po wybranym miejscu z wyszukiwarki ORAZ kategorii —
  //    przekazywane do CityChips, dzięki czemu liczniki w chipsach (Alle, Deutschland,
  //    Österreich, Schweiz) zawsze pokazują dokładną liczbę pinów dla wybranego miasta i kategorii!
  const searchAndCategoryFilteredPlaces = useMemo(() => {
    if (selectedCategoryId === null) return searchFilteredPlaces;
    return searchFilteredPlaces.filter((p) =>
      p.Kategorie?.some((k) => k.Kategorie_id && k.Kategorie_id.id === selectedCategoryId),
    );
  }, [searchFilteredPlaces, selectedCategoryId]);

  // 3. Finalna lista miejsc na kartach (uwzględnia także wybrany chip kraju oraz sortowanie GPS)
  const displayedPlaces = useMemo(() => {
    let result = selectedRegion
      ? placesInRegion(searchAndCategoryFilteredPlaces, selectedRegion)
      : [...searchAndCategoryFilteredPlaces];

    // Sortowanie po GPS stosujemy, gdy użytkownik nie wyszukał konkretnego miasta
    // (przy wyszukaniu miasta lista jest już posortowana względem tego miasta).
    if (!selectedSearchPlace && orderedIds) {
      const indexMap = new Map(orderedIds.map((id, i) => [id, i]));
      result.sort((a, b) => (indexMap.get(a.id) ?? 9999) - (indexMap.get(b.id) ?? 9999));
    }

    return result;
  }, [searchAndCategoryFilteredPlaces, selectedRegion, selectedSearchPlace, orderedIds]);

  const displayedIds = useMemo(() => displayedPlaces.map((p) => p.id), [displayedPlaces]);

  // ── Alle abspielen: playlista z aktualnie przefiltrowanych wyników posiadających audio
  const playablePlaces = useMemo(
    () => displayedPlaces.filter((p) => getAudioUrl(p) !== null),
    [displayedPlaces],
  );

  const selectedCategoryName = useMemo(() => {
    if (selectedCategoryId === null) return null;
    return allCategories.find((c) => c.id === selectedCategoryId)?.Name ?? null;
  }, [allCategories, selectedCategoryId]);

  const alleAbspielenLabel = useMemo(() => {
    const parts: string[] = [];
    if (selectedSearchPlace?.name) parts.push(selectedSearchPlace.name);
    if (selectedRegion?.name) parts.push(selectedRegion.name);
    if (selectedCategoryName) parts.push(selectedCategoryName);
    return parts.length > 0 ? parts.join(" · ") : "Aktuelle Auswahl";
  }, [selectedSearchPlace, selectedRegion, selectedCategoryName]);

  const startPlaylist = usePlaylistStore((s) => s.startPlaylist);
  const handleAlleAbspielen = useCallback(() => {
    if (playablePlaces.length === 0) return;
    startPlaylist(playablePlaces, { kind: "aktuelle_liste", label: alleAbspielenLabel });
    router.navigate("/player");
  }, [playablePlaces, alleAbspielenLabel, startPlaylist, router]);

  const showAlleAbspielenBtn =
    playablePlaces.length > 0 &&
    (selectedSearchPlace !== null || selectedRegion !== null || selectedCategoryId !== null);

  const handleSelectRegionChip = useCallback((region: Region | null) => {
    setSelectedRegion(region);
    flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  const handleSelectSearchGeo = useCallback(
    (item: {
      name: string;
      lat: number;
      lon: number;
      isLocalPlace: boolean;
      cityName?: string;
    }) => {
      Keyboard.dismiss();
      // Resetujemy zawężenie do innego kraju, aby np. po wybraniu „Bregenz” (Austria)
      // wcześniejszy filtr „Deutschland” nie ukrył wyników.
      setSelectedRegion(null);
      setSelectedSearchPlace(item);
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    },
    [],
  );

  const clearSearch = useCallback(() => {
    setSelectedSearchPlace(null);
    Keyboard.dismiss();
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
    });
  }, []);

  const renderCard = useCallback(
    ({ item: placeId }: { item: number }) => (
      <View style={[styles.cardWrapperOuter, { width: CARD_STEP }]}>
        <View style={[styles.cardWrapper, { width: CARD_WIDTH, height: CARD_HEIGHT }]}>
          <PinCard placeId={placeId} />
        </View>
      </View>
    ),
    [CARD_WIDTH, CARD_HEIGHT, CARD_STEP],
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <HomeHeader einstellungen={einstellungen} />
        <View style={styles.middleContent}>
          <View style={styles.aboveCards}>
            <SkeletonBlock
              style={{
                width: 170,
                height: 26,
                borderRadius: 10,
                marginLeft: LIST_HORIZONTAL_PADDING,
              }}
            />
          </View>
          <View style={styles.cardsArea}>
            <View style={{ flexDirection: "row", paddingLeft: LIST_HORIZONTAL_PADDING }}>
              <View style={styles.cardWrapperOuter}>
                <PinCardSkeleton width={CARD_WIDTH} height={CARD_HEIGHT} />
              </View>
              <View style={styles.cardWrapperOuter}>
                <PinCardSkeleton width={CARD_WIDTH} height={CARD_HEIGHT} />
              </View>
            </View>
          </View>
          <View style={styles.belowCards}>
            <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 14 }}>
              <SkeletonBlock style={{ width: 72, height: 34, borderRadius: 17 }} />
              <SkeletonBlock style={{ width: 112, height: 34, borderRadius: 17 }} />
              <SkeletonBlock style={{ width: 98, height: 34, borderRadius: 17 }} />
              <SkeletonBlock style={{ width: 88, height: 34, borderRadius: 17 }} />
            </View>
          </View>
        </View>
        <View style={styles.bottomSection}>
          <View style={styles.searchSkeletonBar} />
          <View style={styles.kategorieSkeletonBar} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={[styles.container, styles.centered]} edges={["top", "left", "right"]}>
        <Text style={styles.errorText}>{error}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* Logo + Menu */}
      <HomeHeader einstellungen={einstellungen} />

      {/* Offline-Hinweis — sichtbar, wenn gespeicherte Daten verwendet werden.
          Identisch zur Karte, damit der Modus auf beiden Screens erkennbar ist. */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            Offline-Modus – es werden gespeicherte Daten angezeigt. Fotos und Audioguides sind
            möglicherweise nicht verfügbar.
          </Text>
        </View>
      )}

      {/* Środkowa część ekranu — wyśrodkowana w pionie, dzięki czemu przycisk GPS nad kartami
          oraz chipsy krajów pod kartami są zawsze wyśrodkowane w swoich pasach przestrzeni
          (identyczna odległość od karty i od sąsiedniej krawędzi), bez wypychania dolnego paska */}
      <View style={styles.middleContent}>
        {/* Przestrzeń nad kartą — GPS label po lewej, Alle abspielen button po prawej */}
        <View style={styles.aboveCards}>
          {/* Sortiert → Status-Label. Nicht sortiert → Button, der es auslöst.
              Vorher gab es nur das Label: schlug die Ortung fehl oder wurde die
              Berechtigung abgelehnt, hatte der Nutzer keinerlei Möglichkeit,
              die Sortierung nachzuholen. */}
          {orderedIds ? (
            <View style={[styles.gpsLabel, { marginLeft: LIST_HORIZONTAL_PADDING }]}>
              <Text style={styles.gpsLabelText}>Nach Entfernung sortiert</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.gpsSortBtn, { marginLeft: LIST_HORIZONTAL_PADDING }]}
              onPress={handleSortByLocation}
              disabled={gpsStatus === "locating"}
              activeOpacity={0.7}
            >
              {gpsStatus === "locating" ? (
                <>
                  <ActivityIndicator size="small" color="#fc6c14" />
                  <Text style={styles.gpsSortBtnText}>Standort wird ermittelt …</Text>
                </>
              ) : (
                <>
                  <Svg width={14} height={14} viewBox="0 0 24 24">
                    <Circle cx="12" cy="12" r="9" fill="none" stroke="#fc6c14" strokeWidth={2} />
                    <Circle cx="12" cy="12" r="3.5" fill="#fc6c14" />
                  </Svg>
                  <Text style={styles.gpsSortBtnText}>{gpsButtonLabel}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
          {showAlleAbspielenBtn && (
            <TouchableOpacity
              style={styles.alleAbspielenBtn}
              onPress={handleAlleAbspielen}
              activeOpacity={0.85}
            >
              <Svg width={16} height={16} viewBox="0 0 24 24">
                <Circle cx="12" cy="12" r="12" fill="#fff" />
                <Polygon points="10,7.5 16.5,12 10,16.5" fill="#fc6c14" />
              </Svg>
              <Text style={styles.alleAbspielenText}>Alle abspielen</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Karty — przewijane poziomo */}
        <View style={styles.cardsArea}>
          {displayedIds.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>Keine Ergebnisse gefunden.</Text>
            </View>
          ) : (
            <FlatList
              ref={flatListRef}
              data={displayedIds}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={CARD_STEP}
              snapToAlignment="start"
              decelerationRate="fast"
              style={styles.flatList}
              ListHeaderComponent={flatListHeader}
              initialNumToRender={3}
              maxToRenderPerBatch={2}
              windowSize={3}
              removeClippedSubviews
              keyExtractor={keyExtractor}
              getItemLayout={getItemLayout}
              renderItem={renderCard}
            />
          )}
        </View>

        {/* Przestrzeń pod kartą — city chips wyśrodkowane pionowo, zsynchronizowane z wyszukiwarką i kategorią */}
        <View style={styles.belowCards}>
          <CityChips
            activeRegionName={selectedRegion?.name ?? null}
            allPlaces={allPlaces}
            filteredPlaces={searchAndCategoryFilteredPlaces}
            onSelectRegion={handleSelectRegionChip}
          />
        </View>
      </View>

      {/* Dolna sekcja — wyszukiwarka + kategorie */}
      <View
        style={styles.bottomSection}
        onLayout={(e) => setBottomSectionHeight(e.nativeEvent.layout.height)}
      >
        <SearchSection
          ref={searchRef}
          selectedCategoryId={selectedCategoryId}
          onSelectGeo={handleSelectSearchGeo}
          onClear={clearSearch}
          bottomSectionHeight={bottomSectionHeight}
        />

        <KategorieBar
          categories={allCategories}
          selectedId={selectedCategoryId}
          onSelect={(id) => {
            setSelectedCategoryId(id);
            requestAnimationFrame(() => {
              flatListRef.current?.scrollToOffset({ offset: 0, animated: false });
            });
          }}
          isPro={isPro}
        />
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f8ff",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // Środkowy kontener między HomeHeader a bottomSection — ma flex: 1 i minHeight: 0,
  // a wewnątrz dzieli wolną przestrzeń po równo nad i pod kartami (aboveCards i belowCards).
  middleContent: {
    flex: 1,
    minHeight: 0,
  },
  // Przestrzeń nad kartami — flex: 1, flexBasis: 0 i alignItems: "center" gwarantuje,
  // że przycisk GPS / etykieta znajduje się dokładnie w połowie odległości między górnym nagłówkiem a kartami.
  aboveCards: {
    flex: 1,
    flexBasis: 0,
    minHeight: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingRight: 12,
  },
  // Karty — stała wysokość (CARD_HEIGHT), zawsze pomiędzy pasem górnym a dolnym
  cardsArea: {
    flexShrink: 0,
  },
  // Przestrzeń pod kartami — flex: 1, flexBasis: 0 i justifyContent: "center" gwarantuje,
  // że chipsy krajów znajdują się dokładnie w połowie odległości między kartami a paskiem wyszukiwarki.
  belowCards: {
    flex: 1,
    flexBasis: 0,
    minHeight: 54,
    justifyContent: "center",
    paddingVertical: 6,
  },
  flatList: {
    flexGrow: 0,
    flexShrink: 0,
  },
  searchSkeletonBar: {
    height: 54,
    backgroundColor: "#fc6c14",
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: "#000000",
  },
  kategorieSkeletonBar: {
    height: 48,
    backgroundColor: "rgba(255, 242, 232, 0.9)",
  },
  // Outer: karta + gap po prawej stronie (tworzy odstęp między kartami).
  // Wymiary (width) podawane inline — zależą od szerokości ekranu.
  cardWrapperOuter: {
    paddingRight: CARD_GAP,
  },
  // Wymiary (width/height) podawane inline.
  cardWrapper: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  // Dolna sekcja
  bottomSection: {
    position: "relative",
    zIndex: 10,
    elevation: 10,
    overflow: "visible",
  },
  // GPS sort label — czarne tło, biały tekst.
  // marginLeft podawane inline (musi pasować do paddingu listy).
  gpsLabel: {
    backgroundColor: "#fafafa",
    paddingHorizontal: 10,
    borderRadius: 10,
    paddingVertical: 3,
  },
  gpsLabelText: {
    fontSize: 12,
    fontFamily: "FiraSansCondensed_600SemiBold",
    color: "#fc6c14",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  // Steht an derselben Stelle wie das Label — als Button erkennbar durch
  // Rahmen und Standort-Icon. marginLeft inline (Padding der Liste).
  gpsSortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fff5ef",
    borderWidth: 1,
    borderColor: "#fc6c14",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    flexShrink: 1,
  },
  gpsSortBtnText: {
    fontSize: 12,
    fontFamily: "FiraSansCondensed_600SemiBold",
    color: "#fc6c14",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    flexShrink: 1,
  },
  // Alle abspielen — button orange po prawej stronie nad kartami. Widoczny gdy
  // user cos przefiltrowal (miasto lub kategoria) i sa piny z audio.
  alleAbspielenBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fc6c14",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    marginLeft: "auto",
  },
  alleAbspielenText: {
    color: "#fff",
    fontSize: 12,
    fontFamily: "FiraSansCondensed_600SemiBold",
    letterSpacing: 0.5,
  },
  errorText: {
    fontSize: 15,
    color: "#c0392b",
    textAlign: "center",
    paddingHorizontal: 24,
  },
  emptyText: {
    fontSize: 15,
    color: "#000",
    textAlign: "center",
    paddingTop: 40,
    fontFamily: "FiraSansCondensed_400Regular",
  },
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
});
