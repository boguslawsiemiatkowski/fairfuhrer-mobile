import { create } from "zustand";
import * as Location from "expo-location";
import { withPositionTimeout } from "@/lib/location";
import type { DirectusOrte } from "@/types";

export type RouteProfile = "walking" | "cycling" | "driving";

export interface RouteOrigin {
  type: "gps" | "pin" | "place" | "map-click";
  label: string;
  sublabel?: string;
  coords: [number, number]; // [lon, lat]
  placeId?: number;
}

export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
}

export interface RouteResult {
  profile: RouteProfile;
  distanceMeters: number;
  durationSeconds: number;
  geometry: GeoJSON.LineString;
  steps: RouteStep[];
}

export type RouteStatus =
  "idle" | "picking-on-map" | "locating-gps" | "loading-route" | "ready" | "error";

export const MAX_ACTIVE_MOBILITY_DISTANCE_M = 120_000;

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";

// Cache obliczonych tras w pamięci sesji
const directionsCache = new Map<string, RouteResult>();

function buildCacheKey(
  profile: RouteProfile,
  start: [number, number],
  end: [number, number],
): string {
  const s = `${start[0].toFixed(5)},${start[1].toFixed(5)}`;
  const e = `${end[0].toFixed(5)},${end[1].toFixed(5)}`;
  return `${profile}:${s}->${e}`;
}

export function distanceInMeters(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.max(50, Math.round(meters / 10) * 10)} m`;
  }
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1).replace(".", ",") : Math.round(km)} km`;
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) {
    return `${totalMinutes} Min.`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours} Std. ${mins} Min.` : `${hours} Std.`;
}

interface FocusTarget {
  coords: [number, number];
  zoomLevel: number;
  timestamp: number;
}

interface RouteState {
  destination: DirectusOrte | null;
  origin: RouteOrigin | null;
  profile: RouteProfile;
  status: RouteStatus;
  errorMessage: string | null;
  infoNotice: string | null;
  routeResult: RouteResult | null;
  focusTarget: FocusTarget | null;
  fitBoundsTrigger: number;

  focusMapOnCoords: (coords: [number, number], zoomLevel?: number) => void;
  clearFocusTarget: () => void;
  triggerFitBounds: () => void;

  calculateRoute: (
    targetOrigin: RouteOrigin,
    targetDest: DirectusOrte,
    requestedProfile: RouteProfile,
  ) => Promise<void>;
  startRouteWithGps: (destination: DirectusOrte, initialProfile?: RouteProfile) => Promise<void>;
  startRouteWithOrigin: (
    destination: DirectusOrte,
    origin: RouteOrigin,
    requestedProfile?: RouteProfile,
  ) => Promise<void>;
  changeProfile: (nextProfile: RouteProfile) => Promise<void>;
  startPickingOnMap: (destination: DirectusOrte, initialProfile?: RouteProfile) => void;
  cancelPickingOnMap: () => void;
  pickOriginOnMap: (coords: [number, number], clickedPlace?: DirectusOrte) => Promise<void>;
  clearRoute: () => void;
}

let activeAbortController: AbortController | null = null;

export const useRouteStore = create<RouteState>((set, get) => ({
  destination: null,
  origin: null,
  profile: "walking",
  status: "idle",
  errorMessage: null,
  infoNotice: null,
  routeResult: null,
  focusTarget: null,
  fitBoundsTrigger: 0,

  focusMapOnCoords: (coords, zoomLevel = 16) => {
    set({
      focusTarget: {
        coords,
        zoomLevel,
        timestamp: Date.now(),
      },
    });
  },

  clearFocusTarget: () => {
    set({ focusTarget: null });
  },

  triggerFitBounds: () => {
    set((s) => ({ fitBoundsTrigger: s.fitBoundsTrigger + 1 }));
  },

  calculateRoute: async (targetOrigin, targetDest, requestedProfile) => {
    if (!targetDest.location?.coordinates) {
      set({
        destination: targetDest,
        origin: targetOrigin,
        status: "error",
        errorMessage: "Für diesen Ort sind leider keine Koordinaten hinterlegt.",
      });
      return;
    }

    if (!MAPBOX_TOKEN) {
      set({
        destination: targetDest,
        origin: targetOrigin,
        status: "error",
        errorMessage: "Mapbox-Token fehlt. Die Routenberechnung ist nicht verfügbar.",
      });
      return;
    }

    const destCoords = targetDest.location.coordinates;
    const straightDist = distanceInMeters(targetOrigin.coords, destCoords);

    if (straightDist < 20) {
      set({
        destination: targetDest,
        origin: targetOrigin,
        routeResult: null,
        status: "error",
        errorMessage:
          "Startpunkt und Ziel liegen unmittelbar nebeneinander (unter 20 m). Bitte wähle einen anderen Startpunkt.",
      });
      return;
    }

    let effectiveProfile = requestedProfile;
    let notice: string | null = null;
    if (
      straightDist > MAX_ACTIVE_MOBILITY_DISTANCE_M &&
      (requestedProfile === "walking" || requestedProfile === "cycling")
    ) {
      effectiveProfile = "driving";
      notice =
        `Dein gewählter Startpunkt („${targetOrigin.label}“) ist ca. ${formatDistance(straightDist)} vom Ziel entfernt. ` +
        "Fuß- und Fahrradrouten sind nur bis 120 km verfügbar — es wird daher automatisch die Auto-Route angezeigt.";
    }

    const cacheKey = buildCacheKey(effectiveProfile, targetOrigin.coords, destCoords);
    const cached = directionsCache.get(cacheKey);
    if (cached) {
      set((s) => ({
        destination: targetDest,
        origin: targetOrigin,
        profile: effectiveProfile,
        routeResult: cached,
        status: "ready",
        errorMessage: null,
        infoNotice: notice,
        fitBoundsTrigger: s.fitBoundsTrigger + 1,
      }));
      return;
    }

    activeAbortController?.abort();
    const controller = new AbortController();
    activeAbortController = controller;

    set({
      destination: targetDest,
      origin: targetOrigin,
      profile: effectiveProfile,
      status: "loading-route",
      errorMessage: null,
      infoNotice: notice,
    });

    const coordsParam = `${targetOrigin.coords[0]},${targetOrigin.coords[1]};${destCoords[0]},${destCoords[1]}`;
    const url =
      `https://api.mapbox.com/directions/v5/mapbox/${effectiveProfile}/${coordsParam}` +
      `?geometries=geojson&overview=full&steps=true&language=de&access_token=${MAPBOX_TOKEN}`;

    try {
      const res = await fetch(url, { signal: controller.signal });
      const data = (await res.json()) as {
        code?: string;
        routes?: {
          distance: number;
          duration: number;
          geometry: GeoJSON.LineString;
          legs?: {
            steps?: {
              distance: number;
              duration: number;
              maneuver?: { instruction?: string };
            }[];
          }[];
        }[];
      };

      if (controller.signal.aborted) return;

      if (!res.ok || data.code !== "Ok" || !data.routes?.length) {
        set({
          routeResult: null,
          status: "error",
          errorMessage:
            "Zwischen diesem Startpunkt und dem Ziel konnte keine Route gefunden werden. Bitte wähle einen Startpunkt in der Nähe oder ein anderes Verkehrsmittel.",
        });
        return;
      }

      const primaryRoute = data.routes[0];
      const rawSteps = primaryRoute.legs?.[0]?.steps ?? [];
      const steps: RouteStep[] = rawSteps
        .map((s) => ({
          instruction: s.maneuver?.instruction?.trim() ?? "",
          distanceMeters: Math.round(s.distance ?? 0),
          durationSeconds: Math.round(s.duration ?? 0),
        }))
        .filter((s) => Boolean(s.instruction));

      const result: RouteResult = {
        profile: effectiveProfile,
        distanceMeters: Math.round(primaryRoute.distance),
        durationSeconds: Math.round(primaryRoute.duration),
        geometry: primaryRoute.geometry,
        steps,
      };

      directionsCache.set(cacheKey, result);
      set((s) => ({
        destination: targetDest,
        origin: targetOrigin,
        profile: effectiveProfile,
        routeResult: result,
        status: "ready",
        errorMessage: null,
        fitBoundsTrigger: s.fitBoundsTrigger + 1,
      }));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      set({
        routeResult: null,
        status: "error",
        errorMessage:
          "Netzwerkfehler bei der Routenberechnung. Bitte prüfe deine Internetverbindung und versuche es erneut.",
      });
    }
  },

  startRouteWithGps: async (destination, initialProfile) => {
    const requestedProfile = initialProfile ?? get().profile;
    set({
      destination,
      profile: requestedProfile,
      status: "locating-gps",
      errorMessage: null,
      infoNotice: null,
    });

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        set({
          status: "error",
          errorMessage:
            "Standortzugriff nicht erlaubt. Bitte gib den Standort frei oder wähle unten über „Ort / Pin suchen“ bzw. „Auf Karte tippen“ einen anderen Startpunkt.",
        });
        return;
      }

      // Najpierw sprawdź ostatnią znaną pozycję (błyskawicznie, 0 ms czekania),
      // a jeśli nie ma — pobierz świeżą z timeoutem.
      let pos = await Location.getLastKnownPositionAsync({
        maxAge: 120_000,
      });
      if (!pos) {
        pos = await withPositionTimeout(
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
        );
      }

      const nextOrigin: RouteOrigin = {
        type: "gps",
        label: "Mein Standort (GPS)",
        sublabel: `${pos.coords.latitude.toFixed(4)}° N, ${pos.coords.longitude.toFixed(4)}° E`,
        coords: [pos.coords.longitude, pos.coords.latitude],
      };

      await get().calculateRoute(nextOrigin, destination, requestedProfile);
    } catch {
      set({
        status: "error",
        errorMessage:
          "Dein GPS-Standort konnte nicht ermittelt werden. Bitte wähle stattdessen über „Ort / Pin suchen“ oder „Auf Karte tippen“ einen Startpunkt.",
      });
    }
  },

  startRouteWithOrigin: async (destination, origin, requestedProfile) => {
    const profileToUse = requestedProfile ?? get().profile;
    await get().calculateRoute(origin, destination, profileToUse);
  },

  changeProfile: async (nextProfile) => {
    const { origin, destination } = get();
    if (origin && destination?.location?.coordinates) {
      const straightDist = distanceInMeters(origin.coords, destination.location.coordinates);
      if (
        straightDist > MAX_ACTIVE_MOBILITY_DISTANCE_M &&
        (nextProfile === "walking" || nextProfile === "cycling")
      ) {
        set({
          infoNotice:
            `Fuß- und Fahrradrouten sind nur bis 120 km verfügbar. Dein aktueller Startpunkt („${origin.label}“) ist ca. ${formatDistance(straightDist)} entfernt. ` +
            "Bitte wähle einen Startpunkt in der Region (z. B. einen anderen Pin oder per Tipp auf die Karte), um Fuß- oder Radwege zu berechnen.",
        });
        return;
      }
      await get().calculateRoute(origin, destination, nextProfile);
    } else {
      set({ profile: nextProfile, infoNotice: null });
    }
  },

  startPickingOnMap: (destination, initialProfile) => {
    activeAbortController?.abort();
    set((s) => ({
      destination,
      profile: initialProfile ?? s.profile,
      status: "picking-on-map",
      errorMessage: null,
      infoNotice: null,
    }));
  },

  cancelPickingOnMap: () => {
    set((s) => ({
      status: s.routeResult ? "ready" : "idle",
    }));
  },

  pickOriginOnMap: async (coords, clickedPlace) => {
    const { destination, profile } = get();
    if (!destination) return;

    const nextOrigin: RouteOrigin = clickedPlace
      ? {
          type: "pin",
          label: clickedPlace.Name,
          sublabel: [clickedPlace.Stadt, clickedPlace.Adresse].filter(Boolean).join(", "),
          coords,
          placeId: clickedPlace.id,
        }
      : {
          type: "map-click",
          label: "Gewählter Punkt auf der Karte",
          sublabel: `${coords[1].toFixed(4)}° N, ${coords[0].toFixed(4)}° E`,
          coords,
        };

    await get().calculateRoute(nextOrigin, destination, profile);
  },

  clearRoute: () => {
    activeAbortController?.abort();
    set({
      destination: null,
      origin: null,
      status: "idle",
      errorMessage: null,
      infoNotice: null,
      routeResult: null,
    });
  },
}));
