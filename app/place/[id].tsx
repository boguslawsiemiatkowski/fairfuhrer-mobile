import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  PanResponder,
  Animated,
  Dimensions,
  StatusBar,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Line, Path, Circle, Polyline } from "react-native-svg";

import { AudioPlayer } from "@/components/AudioPlayer";
import { CategoryIcon, categoryColorFor } from "@/components/CategoryIcon";
import { RoutePlannerCard } from "@/components/RoutePlannerCard";
import { usePlacesStore } from "@/stores/placesStore";
import { useAuth } from "@/context/AuthContext";
import { getMainImageUrl, getAudioUrl, getGalleryUrls } from "@/lib/mediaUrls";
import { resolveMediaUri } from "@/lib/mediaCache";
import { openExternalUrl } from "@/lib/openExternalUrl";

import type { DirectusKategorie, DirectusOrte } from "@/types";

const SCREEN_WIDTH = Dimensions.get("window").width;
const SCREEN_HEIGHT = Dimensions.get("window").height;
const GALLERY_IMAGE_SIZE = Math.floor((SCREEN_WIDTH - 40 - 10) / 2);
const IMAGE_HEIGHT = 250;

const DIRECTUS_URL = process.env.EXPO_PUBLIC_DIRECTUS_URL ?? "";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCategories(place: DirectusOrte): DirectusKategorie[] {
  if (!place.Kategorie) return [];
  return place.Kategorie.map((k) => k.Kategorie_id).filter(Boolean) as DirectusKategorie[];
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&bdquo;/g, "\u201E")
    .replace(/&sbquo;/g, "\u201A")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&hellip;/g, "\u2026")
    .replace(/&euro;/g, "\u20AC")
    .replace(/&times;/g, "\u00D7")
    .replace(/&copy;/g, "\u00A9")
    .replace(/&reg;/g, "\u00AE")
    .replace(/&trade;/g, "\u2122")
    .replace(/&laquo;/g, "\u00AB")
    .replace(/&raquo;/g, "\u00BB")
    .replace(/&auml;/g, "ä")
    .replace(/&ouml;/g, "ö")
    .replace(/&uuml;/g, "ü")
    .replace(/&Auml;/g, "Ä")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&szlig;/g, "ß")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

interface RichBlock {
  type: "heading" | "list-item" | "paragraph";
  text: string;
}

/**
 * Zamienia HTML z Directus/Worda na uporządkowane bloki tekstu (akapity, nagłówki, listy),
 * dzięki czemu opis na ekranie Audiopinu ma czytelne odstępy i wypunktowania jak na Webie.
 */
function parseDescriptionBlocks(html: string): RichBlock[] {
  const normalized = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, "\n@@H@@$2\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n@@LI@@$1\n")
    .replace(/<\/(p|div|ul|ol|blockquote)[^>]*>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n");

  const rawLines = normalized.split(/\n+/);
  const blocks: RichBlock[] = [];

  for (const raw of rawLines) {
    let kind: RichBlock["type"] = "paragraph";
    let content = raw;

    if (content.startsWith("@@H@@")) {
      kind = "heading";
      content = content.slice(5);
    } else if (content.startsWith("@@LI@@")) {
      kind = "list-item";
      content = content.slice(6);
    }

    const stripped = decodeHtmlEntities(content.replace(/<[^>]+>/g, ""))
      .replace(/\s+/g, " ")
      .trim();

    if (!stripped) continue;

    // Obsługa ręcznych punktorów z Worda (np. "• tekst" lub "· tekst")
    if (kind === "paragraph" && /^[•·▪◦]\s*/.test(stripped)) {
      const cleaned = stripped.replace(/^[•·▪◦]\s*/, "").trim();
      if (cleaned) {
        blocks.push({ type: "list-item", text: cleaned });
      }
      continue;
    }

    blocks.push({ type: kind, text: stripped });
  }

  return blocks;
}

/** Odległość w metrach między dwoma punktami [lon, lat] (wzór Haversine). */
function distanceInMeters(a: [number, number], b: [number, number]): number {
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

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.max(50, Math.round(meters / 10) * 10)} m`;
  }
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1).replace(".", ",") : Math.round(km)} km`;
}

// ── Ikony SVG (Studio) ────────────────────────────────────────────────────────

function CloseIcon({ color = "#18222f", size = 18 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="18" y1="6" x2="6" y2="18" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
      <Line x1="6" y1="6" x2="18" y2="18" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
    </Svg>
  );
}

function PhoneSvgIcon({ color = "#ffffff", size = 15 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ExternalLinkSvgIcon({ color = "#ffffff", size = 15 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline
        points="15 3 21 3 21 9"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line
        x1="10"
        y1="14"
        x2="21"
        y2="3"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </Svg>
  );
}

function NavigationSvgIcon({ color = "#ffffff", size = 16 }: { color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 11l19-9-9 19-2-8-8-2z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function MapPinSvgIcon({ color = "#18222f", size = 16 }: { color?: string; size?: number }) {
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

function ArrowRightSvgIcon({ color = "#fc6c14", size = 18 }: { color?: string; size?: number }) {
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

// ── Fullscreen Gallery Viewer ─────────────────────────────────────────────────

interface GalleryViewerProps {
  images: { key: string; uri: string }[];
  initialIndex: number;
  onClose: () => void;
}

function GalleryViewer({ images, initialIndex, onClose }: GalleryViewerProps) {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const translateX = useRef(new Animated.Value(0)).current;

  const goTo = useCallback(
    (nextIndex: number) => {
      const direction = nextIndex > currentIndex ? -1 : 1;
      Animated.timing(translateX, {
        toValue: direction * SCREEN_WIDTH,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        translateX.setValue(-direction * SCREEN_WIDTH);
        setCurrentIndex(nextIndex);
        Animated.timing(translateX, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }).start();
      });
    },
    [currentIndex, translateX],
  );

  const panRef = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_, g) => {
        if (g.dx < -50 && currentIndex < images.length - 1) goTo(currentIndex + 1);
        else if (g.dx > 50 && currentIndex > 0) goTo(currentIndex - 1);
      },
    }),
  );

  useEffect(() => {
    panRef.current = PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_, g) => {
        if (g.dx < -50 && currentIndex < images.length - 1) goTo(currentIndex + 1);
        else if (g.dx > 50 && currentIndex > 0) goTo(currentIndex - 1);
      },
    });
  }, [currentIndex, images.length, goTo]);

  return (
    <View style={galleryStyles.overlay}>
      <StatusBar hidden />
      <Animated.View
        style={[galleryStyles.imageWrapper, { transform: [{ translateX }] }]}
        {...panRef.current.panHandlers}
      >
        <Image
          source={{ uri: images[currentIndex].uri }}
          style={galleryStyles.fullImage}
          contentFit="contain"
          transition={120}
          cachePolicy="memory-disk"
        />
      </Animated.View>
      <TouchableOpacity
        style={[galleryStyles.closeBtn, { top: insets.top + 12 }]}
        onPress={onClose}
        activeOpacity={0.85}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <CloseIcon color="#18222f" size={18} />
      </TouchableOpacity>
      {currentIndex > 0 && (
        <TouchableOpacity
          style={[galleryStyles.arrowBtn, galleryStyles.arrowLeft]}
          onPress={() => goTo(currentIndex - 1)}
          activeOpacity={0.7}
        >
          <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
            <Line
              x1="15"
              y1="6"
              x2="9"
              y2="12"
              stroke="#18222f"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <Line
              x1="9"
              y1="12"
              x2="15"
              y2="18"
              stroke="#18222f"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </Svg>
        </TouchableOpacity>
      )}
      {currentIndex < images.length - 1 && (
        <TouchableOpacity
          style={[galleryStyles.arrowBtn, galleryStyles.arrowRight]}
          onPress={() => goTo(currentIndex + 1)}
          activeOpacity={0.7}
        >
          <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
            <Line
              x1="9"
              y1="6"
              x2="15"
              y2="12"
              stroke="#18222f"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <Line
              x1="15"
              y1="12"
              x2="9"
              y2="18"
              stroke="#18222f"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </Svg>
        </TouchableOpacity>
      )}
      <View style={[galleryStyles.counter, { bottom: insets.bottom + 20 }]}>
        <Text style={galleryStyles.counterText}>
          {currentIndex + 1} / {images.length}
        </Text>
      </View>
    </View>
  );
}

const galleryStyles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(24, 34, 47, 0.96)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  imageWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  fullImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  closeBtn: {
    position: "absolute",
    right: 16,
    width: 38,
    height: 38,
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#18222f",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  arrowBtn: {
    position: "absolute",
    top: "50%",
    width: 40,
    height: 40,
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#18222f",
    alignItems: "center",
    justifyContent: "center",
    marginTop: -20,
    zIndex: 10,
  },
  arrowLeft: { left: 14 },
  arrowRight: { right: 14 },
  counter: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: "#18222f",
    borderWidth: 1.5,
    borderColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  counterText: {
    color: "#ffffff",
    fontFamily: "FiraSansCondensed_600SemiBold",
    fontSize: 13,
    letterSpacing: 0.8,
  },
});

// ── Place Screen (Studio Design) ──────────────────────────────────────────────

export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const [paywallShown, setPaywallShown] = useState(false);

  const { isPro } = useAuth();
  const placeIdNum = Number(id);
  const place = usePlacesStore((s) => s.placesById.get(placeIdNum));
  const allPlaces = usePlacesStore((s) => s.places);
  const lockedSightsIds = usePlacesStore((s) => s.lockedSightsIds);
  const isLocked = !isPro && lockedSightsIds.has(placeIdNum);

  // Deep-link guard: if someone navigates directly to a locked place (e.g.
  // shared URL), show the paywall immediately instead of the detail screen.
  useEffect(() => {
    if (!isLocked || paywallShown) return;
    setPaywallShown(true);
    router.replace("/custom-paywall");
  }, [isLocked, paywallShown, router]);

  // Bloki tekstu opisu
  const descriptionBlocks = useMemo(
    () => (place?.Vollbeschreibung ? parseDescriptionBlocks(place.Vollbeschreibung) : []),
    [place?.Vollbeschreibung],
  );

  // Do 3 powiązanych / pobliskich miejsc (najpierw z tego samego miasta, potem najbliższe z okolicy)
  const relatedPlaces = useMemo(() => {
    if (!place?.location?.coordinates) return [];
    const coords = place.location.coordinates;
    const unlocked = allPlaces.filter(
      (p) =>
        p.id !== place.id &&
        p.location?.coordinates &&
        (isPro || !lockedSightsIds.has(p.id)),
    );

    const sameCity = place.Stadt
      ? unlocked
          .filter((p) => p.Stadt === place.Stadt)
          .map((p) => ({
            place: p,
            meters: distanceInMeters(coords, p.location!.coordinates),
          }))
          .sort((a, b) => a.meters - b.meters)
      : [];

    const picked = [...sameCity.slice(0, 3)];
    if (picked.length < 3) {
      const usedIds = new Set([place.id, ...picked.map((r) => r.place.id)]);
      const nearby = unlocked
        .filter((p) => !usedIds.has(p.id))
        .map((p) => ({
          place: p,
          meters: distanceInMeters(coords, p.location!.coordinates),
        }))
        .sort((a, b) => a.meters - b.meters)
        .slice(0, 3 - picked.length);
      picked.push(...nearby);
    }

    return picked;
  }, [place, allPlaces, isPro, lockedSightsIds]);

  if (!place) {
    return (
      <View style={styles.notFound}>
        <Text style={styles.notFoundText}>Ort nicht gefunden.</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Zurück</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // While paywall is being shown for a locked place, render nothing.
  if (isLocked) return null;

  const imageUrl = resolveMediaUri(getMainImageUrl(place), "image");
  const audioUrl = resolveMediaUri(getAudioUrl(place), "audio");
  const categories = getCategories(place);
  const firstCategory = categories[0];
  const headerColor = categoryColorFor(firstCategory);

  const galleryImages = getGalleryUrls(place).map((url) => ({
    key: url,
    uri: resolveMediaUri(url, "image") ?? url,
  }));

  // Wszystkie obrazy dla pełnoekranowego podglądu (zdjęcie główne + galeria)
  const allLightboxImages = imageUrl
    ? [{ key: `main-${place.id}`, uri: imageUrl }, ...galleryImages]
    : galleryImages;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* ── Przycisk zamknięcia w stylu Studio (prawy górny róg) ── */}
      <TouchableOpacity
        style={[styles.closeButton, { top: Math.max(insets.top, 12) + 8 }]}
        onPress={() => router.back()}
        activeOpacity={0.85}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <CloseIcon color="#18222f" size={18} />
      </TouchableOpacity>

      {/* ── ScrollView (cała strona przewija się spójnie jak na Webie) ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 36 }}
        showsVerticalScrollIndicator={false}
        bounces={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* 1. Zdjęcie główne (tap otwiera pełny ekran) */}
        {imageUrl && (
          <TouchableOpacity
            activeOpacity={0.92}
            onPress={() => setGalleryIndex(0)}
            style={styles.mainImageSection}
          >
            <Image
              source={{ uri: imageUrl }}
              style={styles.mainImage}
              contentFit="cover"
              transition={150}
              cachePolicy="memory-disk"
            />
          </TouchableOpacity>
        )}

        {/* 2. Kolorowy nagłówek w barwie kategorii (Studio Header — jak na Webie) */}
        <View
          style={[
            styles.placeHeader,
            {
              backgroundColor: headerColor,
              paddingTop: imageUrl ? 24 : Math.max(insets.top, 20) + 40,
            },
          ]}
        >
          {/* Odznaki kategorii z ikoną */}
          {categories.length > 0 && (
            <View style={styles.categoryBadges}>
              {categories.map((cat) => (
                <View key={cat.id} style={styles.categoryBadge}>
                  <CategoryIcon
                    categoryId={cat.id}
                    color="rgba(255,255,255,0.22)"
                    strokeColor="#fff"
                    size={24}
                  />
                  <Text style={styles.categoryBadgeText}>{cat.Name}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Tytuł miejsca */}
          <Text style={styles.placeName}>{place.Name}</Text>

          {/* Adres i miasto */}
          {(place.Adresse || place.Stadt) && (
            <Text style={styles.placeAddress}>
              {place.Adresse}
              {place.Adresse && place.Stadt ? "\n" : ""}
              {place.Stadt}
              {place.Land ? `, ${place.Land}` : ""}
            </Text>
          )}

          {/* Pigułki kontaktu: Telefon + Strona WWW */}
          {(place.Telefon || place.Link_URL) && (
            <View style={styles.contactRow}>
              {place.Telefon ? (
                <TouchableOpacity
                  style={styles.contactPill}
                  onPress={() =>
                    openExternalUrl(
                      `tel:${place.Telefon?.replace(/\s+/g, "")}`,
                      "Auf diesem Gerät können keine Anrufe getätigt werden.",
                    )
                  }
                  activeOpacity={0.8}
                >
                  <PhoneSvgIcon color="#ffffff" size={14} />
                  <Text style={styles.contactPillText}>{place.Telefon}</Text>
                </TouchableOpacity>
              ) : null}

              {place.Link_URL ? (
                <TouchableOpacity
                  style={styles.contactPill}
                  onPress={() =>
                    place.Link_URL &&
                    openExternalUrl(place.Link_URL, "Die Website ist derzeit nicht erreichbar.")
                  }
                  activeOpacity={0.8}
                >
                  <ExternalLinkSvgIcon color="#ffffff" size={14} />
                  <Text style={styles.contactPillText} numberOfLines={1}>
                    {place.Link_Text || "Website besuchen"}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {/* Zintegrowany odtwarzacz Audio w nagłówku kategorii */}
          {audioUrl && (
            <View style={styles.audioPlayerWrap}>
              <AudioPlayer src={audioUrl} />
            </View>
          )}
        </View>

        {/* 3. Treść główna na tle Studio (#f8f8ff) */}
        <View style={styles.body}>
          {/* Sformatowany opis (akapity, nagłówki, listy punktowane) */}
          {descriptionBlocks.length > 0 && (
            <View style={styles.infoSection}>
              {descriptionBlocks.map((block, idx) => {
                if (block.type === "heading") {
                  return (
                    <Text key={idx} style={styles.descHeading}>
                      {block.text}
                    </Text>
                  );
                }
                if (block.type === "list-item") {
                  return (
                    <View key={idx} style={styles.descListRow}>
                      <Text style={styles.descBullet}>•</Text>
                      <Text style={styles.descListText}>{block.text}</Text>
                    </View>
                  );
                }
                return (
                  <Text
                    key={idx}
                    style={[
                      styles.descriptionParagraph,
                      idx === descriptionBlocks.length - 1 && { marginBottom: 0 },
                    ]}
                  >
                    {block.text}
                  </Text>
                );
              })}
            </View>
          )}

          {/* Certyfikaty i odznaki zrównoważonego rozwoju */}
          {place.Zertifizierungen && place.Zertifizierungen.length > 0 && (
            <View style={styles.infoSection}>
              <Text style={styles.sectionTitle}>Zertifizierungen & Labels</Text>
              <View style={styles.zertGrid}>
                {place.Zertifizierungen.map((z) => {
                  const item = z.Zertifizierungen_id;
                  if (!item) return null;
                  return (
                    <View key={item.id} style={styles.zertCard}>
                      {item.Image ? (
                        <Image
                          source={{
                            uri:
                              resolveMediaUri(`${DIRECTUS_URL}/assets/${item.Image}`, "image") ??
                              `${DIRECTUS_URL}/assets/${item.Image}`,
                          }}
                          style={styles.zertLogo}
                          contentFit="contain"
                          cachePolicy="memory-disk"
                        />
                      ) : null}
                      <Text style={styles.zertName} numberOfLines={2}>
                        {item.Name}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Galeria zdjęć w ramkach Studio */}
          {galleryImages.length > 0 && (
            <View style={styles.infoSection}>
              <Text style={styles.sectionTitle}>Bildergalerie</Text>
              <View style={styles.gallery}>
                {galleryImages.map(({ key, uri }, index) => (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setGalleryIndex(imageUrl ? index + 1 : index)}
                    activeOpacity={0.85}
                    style={styles.galleryItemWrap}
                  >
                    <Image
                      source={{ uri }}
                      style={styles.galleryImage}
                      contentFit="cover"
                      transition={150}
                      cachePolicy="memory-disk"
                    />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Sekcja „Lage & Routenplaner” — w 100% wewnątrz aplikacji (Mapbox) */}
          {(place.location?.coordinates || place.Adresse) && (
            <View style={styles.infoSection}>
              <Text style={styles.sectionTitle}>Lage & Routenplaner</Text>
              <RoutePlannerCard
                place={place}
                firstCategory={firstCategory}
                headerColor={headerColor}
                onOpenOnMap={() => {
                  router.dismissTo?.("/(tabs)/karte");
                  router.replace("/(tabs)/karte");
                }}
              />
            </View>
          )}

          {/* Sekcja „Weitere Orte” (jak na Webie) */}
          {relatedPlaces.length > 0 && (
            <View style={styles.infoSection}>
              <Text style={styles.sectionTitle}>
                {place.Stadt ? `Weitere Orte in ${place.Stadt}` : "Weitere Orte in der Nähe"}
              </Text>
              <View style={styles.relatedList}>
                {relatedPlaces.map(({ place: other, meters }) => {
                  const otherCats = getCategories(other);
                  const otherCat = otherCats[0];
                  return (
                    <TouchableOpacity
                      key={other.id}
                      style={styles.relatedCard}
                      onPress={() => router.replace(`/place/${other.id}`)}
                      activeOpacity={0.85}
                    >
                      <CategoryIcon
                        categoryId={otherCat?.id ?? null}
                        color={categoryColorFor(otherCat)}
                        strokeColor="#fff"
                        size={36}
                      />
                      <View style={styles.relatedCardBody}>
                        <Text style={styles.relatedCardName} numberOfLines={1}>
                          {other.Name}
                        </Text>
                        <Text style={styles.relatedCardMeta} numberOfLines={1}>
                          {[otherCat?.Name, other.Stadt, formatDistance(meters)]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </View>
                      <ArrowRightSvgIcon color="#fc6c14" size={18} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Pełnoekranowa przeglądarka zdjęć ── */}
      {galleryIndex !== null && allLightboxImages.length > 0 && (
        <GalleryViewer
          images={allLightboxImages}
          initialIndex={galleryIndex}
          onClose={() => setGalleryIndex(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f8ff",
  },
  scroll: {
    flex: 1,
  },
  notFound: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8f8ff",
    gap: 16,
  },
  notFoundText: {
    fontFamily: "FiraSansCondensed_600SemiBold",
    fontSize: 18,
    color: "#18222f",
  },
  backBtn: {
    backgroundColor: "#fc6c14",
    borderWidth: 2,
    borderColor: "#18222f",
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  backBtnText: {
    color: "#fff",
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 16,
    textTransform: "uppercase",
  },

  // Przycisk zamknięcia w stylu Studio (jak w PlaceInfoPanel na Webie)
  closeButton: {
    position: "absolute",
    right: 16,
    width: 38,
    height: 38,
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#18222f",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#18222f",
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 8,
    zIndex: 20,
  },

  // Zdjęcie główne
  mainImageSection: {
    width: "100%",
    height: IMAGE_HEIGHT,
    backgroundColor: "#e2e8f0",
    borderBottomWidth: 2,
    borderBottomColor: "#18222f",
  },
  mainImage: {
    width: "100%",
    height: "100%",
  },

  // Nagłówek w kolorze kategorii (Studio Header)
  placeHeader: {
    alignItems: "center",
    paddingHorizontal: 22,
    paddingBottom: 24,
    borderBottomWidth: 2,
    borderBottomColor: "#18222f",
    gap: 10,
  },
  categoryBadges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  categoryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0, 0, 0, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.32)",
    paddingVertical: 4,
    paddingLeft: 5,
    paddingRight: 12,
    borderRadius: 999,
  },
  categoryBadgeText: {
    color: "#ffffff",
    fontSize: 13,
    fontFamily: "FiraSansCondensed_700Bold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  placeName: {
    fontFamily: "Anton_400Regular",
    fontSize: 30,
    lineHeight: 36,
    color: "#ffffff",
    textAlign: "center",
    letterSpacing: 0.5,
    marginTop: 2,
  },
  placeAddress: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 16,
    lineHeight: 22,
    color: "rgba(255, 255, 255, 0.94)",
    textAlign: "center",
  },
  contactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    marginTop: 2,
  },
  contactPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.35)",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  contactPillText: {
    color: "#ffffff",
    fontFamily: "FiraSansCondensed_600SemiBold",
    fontSize: 14,
  },
  audioPlayerWrap: {
    width: "100%",
    marginTop: 8,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.24)",
  },

  // Główny obszar treści Studio
  body: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 28,
  },
  infoSection: {
    gap: 12,
  },
  sectionTitle: {
    fontFamily: "Anton_400Regular",
    fontSize: 21,
    color: "#18222f",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    paddingBottom: 6,
    borderBottomWidth: 3,
    borderBottomColor: "#fc6c14",
  },

  // Typografia opisu
  descHeading: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 19,
    lineHeight: 25,
    color: "#18222f",
    marginTop: 6,
  },
  descriptionParagraph: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 17,
    lineHeight: 26,
    color: "#18222f",
    marginBottom: 8,
  },
  descListRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingLeft: 4,
    marginBottom: 4,
  },
  descBullet: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 18,
    lineHeight: 25,
    color: "#fc6c14",
  },
  descListText: {
    flex: 1,
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 17,
    lineHeight: 25,
    color: "#18222f",
  },

  // Certyfikaty (Studio Cards)
  zertGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  zertCard: {
    width: Math.floor((SCREEN_WIDTH - 40 - 12) / 2),
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    shadowColor: "#18222f",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  zertLogo: {
    width: "100%",
    height: 64,
  },
  zertName: {
    fontFamily: "FiraSansCondensed_600SemiBold",
    fontSize: 13,
    color: "#18222f",
    textAlign: "center",
  },

  // Galeria zdjęć w ramkach Studio
  gallery: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  galleryItemWrap: {
    width: GALLERY_IMAGE_SIZE,
    height: GALLERY_IMAGE_SIZE,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#18222f",
    overflow: "hidden",
    backgroundColor: "#e2e8f0",
  },
  galleryImage: {
    width: "100%",
    height: "100%",
  },

  // Karta „Lage & Route” w stylu Studio
  locationCard: {
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#18222f",
    padding: 16,
    gap: 14,
    shadowColor: "#18222f",
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  locationCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  locationIconWrap: {
    borderWidth: 2,
    borderColor: "#18222f",
    borderRadius: 23,
  },
  locationTextWrap: {
    flex: 1,
  },
  locationPlaceName: {
    fontFamily: "Anton_400Regular",
    fontSize: 18,
    color: "#18222f",
    letterSpacing: 0.3,
  },
  locationAddressText: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 14,
    color: "#475569",
    marginTop: 2,
    lineHeight: 19,
  },
  locationActions: {
    gap: 8,
  },
  routePrimaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fc6c14",
    borderWidth: 2,
    borderColor: "#18222f",
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  routePrimaryBtnLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  routePrimaryBtnText: {
    color: "#ffffff",
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 15,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  routeSecondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#f8fafc",
    borderWidth: 1.5,
    borderColor: "#18222f",
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  routeSecondaryBtnText: {
    color: "#18222f",
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 14,
  },

  // Karty „Weitere Orte” (spójne z Webem)
  relatedList: {
    gap: 10,
  },
  relatedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff7ed",
    borderWidth: 2,
    borderColor: "#18222f",
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: "#18222f",
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 2,
  },
  relatedCardBody: {
    flex: 1,
    gap: 2,
  },
  relatedCardName: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 16,
    color: "#18222f",
  },
  relatedCardMeta: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 13,
    color: "#475569",
  },
});
