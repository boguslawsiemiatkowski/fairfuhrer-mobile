import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
  Platform,
} from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { usePlacesStore } from "@/stores/placesStore";
import type { DirectusOrte } from "@/types";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";

// Wyszukiwarka skupia się wyłącznie na miejscach geograficznych (miastach,
// miejscowościach, regionach), a nie na pojedynczych audiopinach:
// 1. Przeszukuje miasta z katalogu FairFührer (z liczbą dostępnych pinów w danym mieście),
// 2. Równolegle odpytuje Mapbox Geocoding API o miejscowości i regiony (DE/AT/CH).

export interface Suggestion {
  name: string;
  place_formatted: string;
  lat: number;
  lon: number;
  isLocalPlace: boolean;
  /** Nazwa miasta z katalogu (jeśli wybrano miasto posiadające piny w bazie). */
  cityName?: string;
}

export interface SearchSectionHandle {
  clear: () => void;
  hideSuggestions: () => void;
}

function normalizeSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .trim();
}

/**
 * Wyszukuje miejscowości (Stadt) występujące w bazie FairFührer (a nie pojedyncze piny).
 * Zwraca unikalne miasta wraz ze współrzędnymi środka i liczbą pinów (z uwzględnieniem wybranej kategorii).
 */
function searchCatalogCities(
  text: string,
  places: DirectusOrte[],
  selectedCategoryId: number | null,
): Suggestion[] {
  const q = normalizeSearch(text);
  if (!q) return [];

  const cityMap = new Map<
    string,
    {
      name: string;
      land: string;
      latSum: number;
      lonSum: number;
      coordCount: number;
      matchingCount: number;
    }
  >();

  for (const p of places) {
    const rawCity = p.Stadt?.trim();
    if (!rawCity) continue;
    const normCity = normalizeSearch(rawCity);
    if (!normCity.includes(q)) continue;

    const matchesCategory =
      selectedCategoryId === null ||
      Boolean(p.Kategorie?.some((k) => k.Kategorie_id?.id === selectedCategoryId));

    let entry = cityMap.get(normCity);
    if (!entry) {
      entry = {
        name: rawCity,
        land: p.Land?.trim() ?? "",
        latSum: 0,
        lonSum: 0,
        coordCount: 0,
        matchingCount: 0,
      };
      cityMap.set(normCity, entry);
    }

    if (p.location?.coordinates) {
      entry.lonSum += p.location.coordinates[0];
      entry.latSum += p.location.coordinates[1];
      entry.coordCount += 1;
    }
    if (matchesCategory) {
      entry.matchingCount += 1;
    }
  }

  return Array.from(cityMap.values())
    .filter((c) => c.coordCount > 0 && c.matchingCount > 0)
    .sort((a, b) => b.matchingCount - a.matchingCount || a.name.localeCompare(b.name, "de"))
    .slice(0, 6)
    .map((c) => ({
      name: c.name,
      place_formatted: [c.land, `${c.matchingCount} ${c.matchingCount === 1 ? "Ort" : "Orte"}`]
        .filter(Boolean)
        .join(" · "),
      lat: c.latSum / c.coordCount,
      lon: c.lonSum / c.coordCount,
      isLocalPlace: false,
      cityName: c.name,
    }));
}

interface SearchSectionProps {
  onSelectGeo: (item: {
    name: string;
    lat: number;
    lon: number;
    isLocalPlace: boolean;
    cityName?: string;
  }) => void;
  onClear: () => void;
  bottomSectionHeight: number;
  selectedCategoryId?: number | null;
}

export const SearchSection = forwardRef<SearchSectionHandle, SearchSectionProps>(
  function SearchSection(
    { onSelectGeo, onClear, bottomSectionHeight, selectedCategoryId = null }: SearchSectionProps,
    ref,
  ) {
    const [query, setQuery] = useState("");
    const [geoSuggestions, setGeoSuggestions] = useState<Suggestion[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isFetchingSuggestions, setIsFetchingSuggestions] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const categoryRef = useRef<number | null>(selectedCategoryId);
    useEffect(() => {
      categoryRef.current = selectedCategoryId;
    }, [selectedCategoryId]);

    useImperativeHandle(ref, () => ({
      clear: () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setQuery("");
        setGeoSuggestions([]);
        setShowSuggestions(false);
        setIsFetchingSuggestions(false);
        Keyboard.dismiss();
      },
      hideSuggestions: () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setGeoSuggestions([]);
        setShowSuggestions(false);
        setIsFetchingSuggestions(false);
        Keyboard.dismiss();
      },
    }));

    const runSearch = (text: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (text.trim().length < 2) {
        setGeoSuggestions([]);
        setShowSuggestions(false);
        setIsFetchingSuggestions(false);
        return;
      }
      setIsFetchingSuggestions(true);
      debounceRef.current = setTimeout(async () => {
        const currentCategory = categoryRef.current;
        const catalogCities = searchCatalogCities(
          text,
          usePlacesStore.getState().places,
          currentCategory,
        );
        const seenCityNames = new Set(catalogCities.map((c) => normalizeSearch(c.name)));

        let geoPlaces: Suggestion[] = [];
        try {
          const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(
            text,
          )}&country=de,at,ch&language=de&limit=6&types=place,locality,district,region&autocomplete=true&access_token=${MAPBOX_TOKEN}`;
          const res = await fetch(url);
          const json = await res.json();
          geoPlaces = (json.features ?? [])
            .map((f: Record<string, unknown>) => {
              const props = f.properties as Record<string, unknown>;
              const geom = f.geometry as { coordinates: [number, number] };
              const name = (props.name as string) ?? "";
              return {
                name,
                place_formatted: (props.place_formatted ?? "") as string,
                lat: geom.coordinates[1],
                lon: geom.coordinates[0],
                isLocalPlace: false,
              };
            })
            .filter((g: Suggestion) => g.name && !seenCityNames.has(normalizeSearch(g.name)));
        } catch {
          // Offline — zostają miasta z lokalnego katalogu.
        }

        const combined = [...catalogCities, ...geoPlaces];
        setGeoSuggestions(combined);
        setShowSuggestions(combined.length > 0);
        setIsFetchingSuggestions(false);
      }, 280);
    };

    useEffect(() => {
      if (query.trim().length >= 2) {
        runSearch(query);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedCategoryId]);

    const handleSelect = (item: Suggestion) => {
      setQuery(item.name);
      setShowSuggestions(false);
      setGeoSuggestions([]);
      Keyboard.dismiss();
      onSelectGeo({
        name: item.name,
        lat: item.lat,
        lon: item.lon,
        isLocalPlace: item.isLocalPlace,
        cityName: item.cityName,
      });
    };

    const handleClear = () => {
      setQuery("");
      setGeoSuggestions([]);
      setShowSuggestions(false);
      onClear();
    };

    return (
      <>
        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            placeholder="Suchen…"
            placeholderTextColor="rgba(255, 255, 255, 0.75)"
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              runSearch(t);
            }}
            onFocus={() => {
              if (query.length >= 2 && geoSuggestions.length > 0) setShowSuggestions(true);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => {
              if (geoSuggestions.length > 0) handleSelect(geoSuggestions[0]);
              else setShowSuggestions(false);
            }}
          />
          {isFetchingSuggestions && (
            <ActivityIndicator size="small" color="#fff" style={{ marginLeft: 8 }} />
          )}
          {query.length > 0 && !isFetchingSuggestions && (
            <TouchableOpacity onPress={handleClear} style={styles.clearBtn}>
              <Text style={styles.clearBtnText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {showSuggestions && geoSuggestions.length > 0 && (
          // ScrollView aus react-native-gesture-handler — fängt vertikalen
          // Drag zuverlässig ab, auch wenn darunter eine native Mapbox-MapView
          // liegt. Der Standard-RN-ScrollView verliert hier das Gesten-Battle.
          <View style={[styles.suggestionsBox, { bottom: bottomSectionHeight }]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              bounces={false}
              showsVerticalScrollIndicator
            >
              {geoSuggestions.map((s, idx) => (
                <TouchableOpacity
                  key={`geo-${s.name}-${s.lat}-${s.lon}-${idx}`}
                  style={styles.suggestionItem}
                  onPress={() => handleSelect(s)}
                  activeOpacity={0.7}
                >
                  <View style={styles.suggestionRow}>
                    <View
                      style={[
                        styles.suggestionBadge,
                        s.cityName ? styles.suggestionBadgePin : styles.suggestionBadgeGeo,
                      ]}
                    >
                      <Text style={styles.suggestionBadgeText}>Ort</Text>
                    </View>
                    <Text style={styles.suggestionText} numberOfLines={1}>
                      {s.name}
                    </Text>
                  </View>
                  <Text style={styles.suggestionSubtext} numberOfLines={1}>
                    {s.place_formatted}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </>
    );
  },
);

const styles = StyleSheet.create({
  searchBar: {
    backgroundColor: "#fc6c14",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: "#000000",
  },
  searchInput: {
    flex: 1,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 25,
    fontFamily: "FiraSansCondensed_700Bold",
    color: "#fff",
    letterSpacing: 1,
    borderWidth: 0,
  },
  clearBtn: { paddingLeft: 8, paddingVertical: 8 },
  clearBtnText: { fontSize: 18, color: "#fff" },
  suggestionsBox: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderTopWidth: 2,
    borderColor: "#000",
    maxHeight: 420,
    zIndex: 100,
    elevation: 10,
  },
  suggestionItem: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  suggestionBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    minWidth: 32,
    alignItems: "center",
  },
  suggestionBadgePin: {
    backgroundColor: "#fc6c14",
  },
  suggestionBadgeGeo: {
    backgroundColor: "#888",
  },
  suggestionBadgeText: {
    fontSize: 10,
    color: "#fff",
    fontFamily: "FiraSansCondensed_700Bold",
    letterSpacing: 0.5,
  },
  suggestionText: {
    flex: 1,
    fontSize: 16,
    color: "#000",
    fontFamily: "FiraSansCondensed_600SemiBold",
  },
  suggestionSubtext: {
    fontSize: 12,
    color: "#555",
    fontFamily: "FiraSansCondensed_400Regular",
    marginTop: 1,
    marginLeft: 40,
  },
});
