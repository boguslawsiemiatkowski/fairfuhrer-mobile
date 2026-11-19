import { create } from "zustand";
import { readItems } from "@directus/sdk";
import { directus } from "@/lib/directus";
import { loadPlacesCache, savePlacesCache } from "@/lib/placesCache";
import type { DirectusOrte, DirectusKategorie, DirectusEinstellungen } from "@/types";

// ─── Sehenswürdigkeiten gating ───────────────────────────────────────────────
//
// ALLE Nutzer sehen alle Audiopins, auch die der Kategorie „Sehenswertes".
//
// Vorher war die Hälfte davon gesperrt (Franks Entscheidung 2026-07-03). Das
// ist aufgehoben: Inhalte zurückzuhalten widerspricht dem Zweck des
// Fairführers, und im Web hat ohnehin jeder Pin seit Oktober 2026 eine eigene,
// bei Google auffindbare Seite unter /liste/[stadt]/[slug] — ein Pin, der
// dort frei lesbar ist, in der App zu sperren, wäre nicht erklärbar.
//
// Premium bleibt bestehen, nur mit anderem Inhalt: Offline-Karten sind die
// Gegenleistung, nicht der Zugang zu Pins. Die Produktnamen tragen das
// schon („support.fair.yearly", „support.small.yearly") — es geht um
// Unterstützung des Projekts, nicht um Freischalten.
//
// Die Maschinerie darunter bleibt absichtlich erhalten: sollte das Modell
// zurückkehren, genügt es, diesen Wert wieder auf 0.5 zu setzen. Deshalb
// bleiben auch die Sperr-Zustände in PinCard und auf der Karte im Code —
// sie werden nur nie mehr wahr.
//
// Detection priority (weiterhin gültig, falls das Modell zurückkommt):
//   1. EXPO_PUBLIC_SIGHTS_CATEGORY_ID — explicit override (preferred)
//   2. Fallback: normalized German name starts with "sehen"
//      (matches "Sehenswertes" and "Sehenswürdigkeiten").
const FREE_VISIBLE_RATIO = 1;

function normalizeGerman(input: string): string {
  return input
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/ß/g, "ss")
    .trim();
}

function envSightsCategoryId(): number | null {
  const raw = process.env.EXPO_PUBLIC_SIGHTS_CATEGORY_ID;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function isSightsCategory(cat: DirectusKategorie | undefined | null): boolean {
  if (!cat) return false;
  const overrideId = envSightsCategoryId();
  if (overrideId !== null && cat.id === overrideId) return true;
  return normalizeGerman(cat.Name ?? "").startsWith("sehen");
}

export const FREE_SIGHTS_VISIBLE_RATIO = FREE_VISIBLE_RATIO;

function placeHasSights(place: DirectusOrte, sightsCategoryIds: Set<number>): boolean {
  if (!place.Kategorie) return false;
  return place.Kategorie.some((k) => k.Kategorie_id && sightsCategoryIds.has(k.Kategorie_id.id));
}

// FNV-1a 32-bit — stable, no external deps, well-distributed enough that a
// 50 % cutoff produces a 50 % visible subset in practice. Keys are derived
// from place.id (primary) plus Name to make the hash robust if id schemas
// change later.
function stableHash01(place: DirectusOrte): number {
  const key = `${place.id}:${place.Name ?? ""}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Map to [0, 1). >>> 0 normalizes the int32 to uint32.
  return (h >>> 0) / 0x100000000;
}

// ─── Shared gating computation ───────────────────────────────────────────────
//
// Returns two sets for free users:
//   visibleSightsIds — the top-N Sehenswertes places (unlocked)
//   lockedSightsIds  — the rest (shown on map, paywall on tap)
//
// Bei FREE_VISIBLE_RATIO = 1 (aktuell) ist `lockedSightsIds` immer leer:
// `visibleCount` erreicht dann `sights.length`, und `slice(visibleCount)`
// liefert nichts. Die Rechnung bleibt dennoch stehen, damit ein Zurück zu
// 0.5 ein Einzeiler ist.
//
// For premium users both sets are empty (not needed — all places are open).

const EMPTY_LOCKED_SET = new Set<number>();

function computeSightsGating(
  places: DirectusOrte[],
  categories: DirectusKategorie[],
): { visibleSightsIds: Set<number>; lockedSightsIds: Set<number> } {
  // Fast-path: gdy FREE_VISIBLE_RATIO >= 1, żaden pin nie jest zablokowany —
  // unikamy kosztownego hashowania i sortowania setek miejsc przy każdym wywołaniu.
  if (FREE_VISIBLE_RATIO >= 1) {
    return { visibleSightsIds: EMPTY_LOCKED_SET, lockedSightsIds: EMPTY_LOCKED_SET };
  }

  const sightsCategoryIds = new Set(categories.filter(isSightsCategory).map((c) => c.id));
  if (sightsCategoryIds.size === 0) {
    return { visibleSightsIds: EMPTY_LOCKED_SET, lockedSightsIds: EMPTY_LOCKED_SET };
  }

  const sights: DirectusOrte[] = [];
  for (const p of places) {
    if (placeHasSights(p, sightsCategoryIds)) sights.push(p);
  }
  if (sights.length === 0) {
    return { visibleSightsIds: EMPTY_LOCKED_SET, lockedSightsIds: EMPTY_LOCKED_SET };
  }

  const visibleCount = Math.ceil(FREE_VISIBLE_RATIO * sights.length);
  const ranked = sights
    .map((p) => ({ p, h: stableHash01(p) }))
    .sort((a, b) => (a.h === b.h ? a.p.id - b.p.id : a.h - b.h));

  const visibleSightsIds = new Set(ranked.slice(0, visibleCount).map((x) => x.p.id));
  const lockedSightsIds = new Set(ranked.slice(visibleCount).map((x) => x.p.id));
  return { visibleSightsIds, lockedSightsIds };
}

function buildPlacesMap(places: DirectusOrte[]): Map<number, DirectusOrte> {
  const map = new Map<number, DirectusOrte>();
  for (const p of places) {
    map.set(p.id, p);
  }
  return map;
}

// ─── Pobieranie z Directusa ──────────────────────────────────────────────────
//
// Wspólne zapytania dla fetchAll (start aplikacji) i refreshOfflineData
// (ręczne odświeżanie). Jedno źródło prawdy dla zestawu pól.

// Klientowy cache opisów pobranych on-demand po otwarciu Audiopinu (jak na Webie)
const descriptionCache = new Map<number, string | null>();
const descriptionInflight = new Map<number, Promise<string | null>>();

interface DirectusFetchResult {
  settings: DirectusEinstellungen;
  places: DirectusOrte[];
  categories: DirectusKategorie[];
}

async function fetchFromDirectus(includeDescriptions = false): Promise<DirectusFetchResult> {
  const orteFields = [
    "id",
    "Name",
    "Adresse",
    "Stadt",
    "Land",
    "Telefon",
    ...(includeDescriptions ? ["Vollbeschreibung"] : []),
    "location",
    "Hauptbild",
    "Titelbild",
    "Audio",
    "Audio_Datei",
    "Link_URL",
    "Link_Text",
    "Galerie.directus_files_id",
    "Galerie_Bilder",
    "Kategorie.Kategorie_id.id",
    "Kategorie.Kategorie_id.Name",
    "Kategorie.Kategorie_id.Farbe",
    "Zertifizierungen.Zertifizierungen_id.id",
    "Zertifizierungen.Zertifizierungen_id.Name",
    "Zertifizierungen.Zertifizierungen_id.Image",
    "Bearbeitungsstatus",
  ];

  const [settings, places, categories] = await Promise.all([
    directus.request(
      readItems("Einstellungen" as never, {
        fields: ["Logo", "Slogan"] as never[],
      }),
    ),
    directus.request(
      readItems("Orte" as never, {
        fields: orteFields as never[],
        limit: -1,
      }),
    ),
    directus.request(
      readItems("Kategorie" as never, {
        fields: ["id", "Name", "Farbe", "Reihenfolge"] as never[],
        sort: ["Reihenfolge"] as never[],
        limit: -1,
      }),
    ),
  ]);

  const typedPlaces = places as unknown as DirectusOrte[];
  if (includeDescriptions) {
    for (const p of typedPlaces) {
      if (p.Vollbeschreibung !== undefined) {
        descriptionCache.set(p.id, p.Vollbeschreibung ?? null);
      }
    }
  }

  return {
    settings: settings as unknown as DirectusEinstellungen,
    places: typedPlaces,
    categories: categories as unknown as DirectusKategorie[],
  };
}

// ─── Store ──────────────────────────────────────────────────────────────────

interface PlacesState {
  places: DirectusOrte[];
  placesById: Map<number, DirectusOrte>;
  lockedSightsIds: Set<number>;
  categories: DirectusKategorie[];
  einstellungen: DirectusEinstellungen | null;
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  // true, gdy aktualne dane pochodzą z lokalnego cache offline
  // (sieć była niedostępna, a cache istniał).
  isOffline: boolean;

  getPlaceById: (id: number) => DirectusOrte | undefined;
  getVisiblePlaces: (isPro: boolean) => DirectusOrte[];
  // Returns all places (for map display), plus the set of locked IDs.
  // Locked = Sehenswertes but outside the free 50% — shown as pins,
  // but tapping opens paywall instead of the detail screen.
  getAllPlacesWithLocked: (isPro: boolean) => {
    places: DirectusOrte[];
    lockedIds: Set<number>;
  };
  isLockedPlace: (placeId: number, isPro: boolean) => boolean;
  // isPro decyduje, czy przy braku sieci wolno użyć cache offline —
  // offline to funkcja premium, więc dla nie-premium fallback jest pomijany.
  fetchAll: (isPro: boolean, force?: boolean) => Promise<void>;
  // Pobiera opis pojedynczego miejsca on-demand (gdy nie przyszedł w początkowym fetchu).
  // Dzięki temu startowy payload aplikacji jest mniejszy, a na ekranie Audiopinu
  // w trakcie dociągania opisu wyświetlamy elegancki szkielet shimmer (jak w panelu na Webie).
  fetchPlaceDescription: (placeId: number) => Promise<string | null>;
  // Zapisuje aktualnie załadowane dane do lokalnego cache offline.
  // Wywoływane po udanym pobraniu paczki mapy offline (funkcja premium).
  cacheCurrentPlaces: () => Promise<void>;
  // Pobiera świeże dane z Directusa, aktualizuje store i nadpisuje cache
  // offline. Używane przez ręczny przycisk „Aktualisieren". W odróżnieniu
  // od fetchAll nie ma guarda status — zawsze wykonuje request.
  // Zwraca true przy sukcesie, false przy błędzie sieci.
  refreshOfflineData: () => Promise<boolean>;
}

export const usePlacesStore = create<PlacesState>((set, get) => ({
  places: [],
  placesById: new Map(),
  lockedSightsIds: EMPTY_LOCKED_SET,
  categories: [],
  einstellungen: null,
  status: "idle",
  error: null,
  isOffline: false,

  // O(1) odczyt po ID z prekomputowanej mapy (zamiast O(N) .find() przy każdym renderze)
  getPlaceById: (id) => get().placesById.get(id),

  getVisiblePlaces: (isPro) => {
    const { places, lockedSightsIds } = get();
    if (isPro || lockedSightsIds.size === 0) return places;
    return places.filter((p) => !lockedSightsIds.has(p.id));
  },

  // O(1) — zwraca stabilną referencję Set zamiast przeliczać gating od nowa
  getAllPlacesWithLocked: (isPro) => {
    const { places, lockedSightsIds } = get();
    if (isPro || lockedSightsIds.size === 0) {
      return { places, lockedIds: EMPTY_LOCKED_SET };
    }
    return { places, lockedIds: lockedSightsIds };
  },

  // O(1) — sprawdzenie w prekomputowanym Set
  isLockedPlace: (placeId, isPro) => {
    if (isPro) return false;
    return get().lockedSightsIds.has(placeId);
  },

  fetchPlaceDescription: async (placeId: number) => {
    const existingPlace = get().placesById.get(placeId);
    if (existingPlace && existingPlace.Vollbeschreibung !== undefined) {
      return existingPlace.Vollbeschreibung ?? null;
    }
    if (descriptionCache.has(placeId)) {
      const cachedDesc = descriptionCache.get(placeId) ?? null;
      if (existingPlace) {
        const updatedPlace: DirectusOrte = { ...existingPlace, Vollbeschreibung: cachedDesc };
        const nextMap = new Map(get().placesById);
        nextMap.set(placeId, updatedPlace);
        set({
          places: get().places.map((p) => (p.id === placeId ? updatedPlace : p)),
          placesById: nextMap,
        });
      }
      return cachedDesc;
    }

    const inflight = descriptionInflight.get(placeId);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const rows = (await directus.request(
          readItems("Orte" as never, {
            filter: { id: { _eq: placeId } } as never,
            fields: ["id", "Vollbeschreibung"] as never[],
            limit: 1,
          }),
        )) as unknown as { id: number; Vollbeschreibung?: string | null }[];

        const desc = rows?.[0]?.Vollbeschreibung ?? null;
        descriptionCache.set(placeId, desc);

        const currentPlace = get().placesById.get(placeId);
        if (currentPlace) {
          const updatedPlace: DirectusOrte = { ...currentPlace, Vollbeschreibung: desc };
          const nextMap = new Map(get().placesById);
          nextMap.set(placeId, updatedPlace);
          set({
            places: get().places.map((p) => (p.id === placeId ? updatedPlace : p)),
            placesById: nextMap,
          });
        }
        return desc;
      } catch {
        return null;
      } finally {
        descriptionInflight.delete(placeId);
      }
    })();

    descriptionInflight.set(placeId, promise);
    return promise;
  },

  fetchAll: async (isPro: boolean, force = false) => {
    // Guard: nie startuj równoległych fetchów i nie przeładowuj ponownie,
    // jeśli dane są już załadowane (chyba że wywołano wymuszone odświeżenie `force = true`
    // lub poprzedni stan to `error`).
    const currentStatus = get().status;
    if (currentStatus === "loading") return;
    if (!force && currentStatus === "success" && get().places.length > 0) return;

    set({ status: "loading", error: null });

    try {
      const { settings, places, categories } = await fetchFromDirectus(false);
      // Jeśli mieliśmy już wcześniej pobrane opisy w pamięci, zachowujemy je przy odświeżeniu
      const mergedPlaces = places.map((p) =>
        p.Vollbeschreibung === undefined && descriptionCache.has(p.id)
          ? { ...p, Vollbeschreibung: descriptionCache.get(p.id) ?? null }
          : p,
      );
      const { lockedSightsIds } = computeSightsGating(mergedPlaces, categories);

      set({
        einstellungen: settings,
        places: mergedPlaces,
        placesById: buildPlacesMap(mergedPlaces),
        lockedSightsIds,
        categories,
        status: "success",
        isOffline: false,
      });
    } catch {
      // Sieć zawiodła. Cache offline to funkcja premium — dla nie-premium
      // (lub po wygaśnięciu premium) NIE używamy go, nawet jeśli pliki
      // fizycznie istnieją na urządzeniu.
      const cached = isPro ? await loadPlacesCache() : null;
      if (cached) {
        for (const p of cached.places) {
          if (p.Vollbeschreibung !== undefined) {
            descriptionCache.set(p.id, p.Vollbeschreibung ?? null);
          }
        }
        const { lockedSightsIds } = computeSightsGating(cached.places, cached.categories);
        set({
          einstellungen: cached.einstellungen,
          places: cached.places,
          placesById: buildPlacesMap(cached.places),
          lockedSightsIds,
          categories: cached.categories,
          status: "success",
          error: null,
          isOffline: true,
        });
        return;
      }
      set({ status: "error", error: "Daten konnten nicht geladen werden." });
    }
  },

  cacheCurrentPlaces: async () => {
    const { status } = get();
    if (status !== "success" || get().places.length === 0) return;
    // Do lokalnego cache offline zapisujemy pełny zestaw danych (razem z Vollbeschreibung),
    // aby użytkownik Fairführer+ miał w trybie offline dostęp także do wszystkich opisów.
    try {
      const { settings, places, categories } = await fetchFromDirectus(true);
      const { lockedSightsIds } = computeSightsGating(places, categories);
      set({
        einstellungen: settings,
        places,
        placesById: buildPlacesMap(places),
        lockedSightsIds,
        categories,
      });
      await savePlacesCache({ places, categories, einstellungen: settings });
    } catch {
      const { places, categories, einstellungen } = get();
      await savePlacesCache({ places, categories, einstellungen });
    }
  },

  refreshOfflineData: async () => {
    try {
      const { settings, places, categories } = await fetchFromDirectus(true);
      const { lockedSightsIds } = computeSightsGating(places, categories);
      set({
        einstellungen: settings,
        places,
        placesById: buildPlacesMap(places),
        lockedSightsIds,
        categories,
        status: "success",
        error: null,
        isOffline: false,
      });
      // Nadpisz cache offline świeżymi danymi (savePlacesCache aktualizuje
      // też savedAt → UI pokaże nową datę „Zuletzt aktualisiert").
      await savePlacesCache({ places, categories, einstellungen: settings });
      return true;
    } catch {
      // Brak sieci / błąd Directusa — store i cache zostają bez zmian.
      return false;
    }
  },
}));
