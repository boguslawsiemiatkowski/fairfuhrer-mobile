import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  StatusBar,
  GestureResponderEvent,
  LayoutChangeEvent,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Svg, { Polygon, Rect } from "react-native-svg";
import { useAudioPlayerStatus } from "expo-audio";

import {
  usePlaylistStore,
  selectCurrentPlace,
  selectIsPlaylistActive,
} from "@/stores/playlistStore";
import { useSharedPlayer } from "@/context/PlayerContext";
import { getMainImageUrl } from "@/lib/mediaUrls";

const { width: SCREEN_W } = Dimensions.get("window");
const COVER_SIZE = Math.min(SCREEN_W - 60, 320);

// ─── Ikony ──────────────────────────────────────────────────────────────────

function PlayIcon({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon points="9.5,7.5 16.5,12 9.5,16.5" fill="#fff" />
    </Svg>
  );
}
function PauseIcon({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="9" y="7.5" width="2.5" height="9" fill="#fff" rx="0.5" />
      <Rect x="12.5" y="7.5" width="2.5" height="9" fill="#fff" rx="0.5" />
    </Svg>
  );
}
function PrevIcon({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x="6" y="6" width="2" height="12" fill="#fff" />
      <Polygon points="17,6 9,12 17,18" fill="#fff" />
    </Svg>
  );
}
function NextIcon({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Polygon points="7,6 15,12 7,18" fill="#fff" />
      <Rect x="16" y="6" width="2" height="12" fill="#fff" />
    </Svg>
  );
}
function ChevronDown() {
  return (
    <Svg width={28} height={28} viewBox="0 0 24 24" fill="none">
      <Polygon points="5,8.5 12,15.5 19,8.5" fill="#fff" />
    </Svg>
  );
}
function CloseXIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Polygon
        points="6.5,5 12,10.5 17.5,5 19,6.5 13.5,12 19,17.5 17.5,19 12,13.5 6.5,19 5,17.5 10.5,12 5,6.5"
        fill="#fff"
      />
    </Svg>
  );
}

// ─── Utils ──────────────────────────────────────────────────────────────────

const formatTime = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

// ─── Player Screen ──────────────────────────────────────────────────────────

export default function PlayerScreen() {
  const router = useRouter();
  const isActive = usePlaylistStore(selectIsPlaylistActive);
  const currentPlace = usePlaylistStore(selectCurrentPlace);
  const queue = usePlaylistStore((s) => s.queue);
  const currentIndex = usePlaylistStore((s) => s.currentIndex);
  const isPlaying = usePlaylistStore((s) => s.isPlaying);
  const context = usePlaylistStore((s) => s.context);
  const togglePlay = usePlaylistStore((s) => s.togglePlay);
  const next = usePlaylistStore((s) => s.next);
  const previous = usePlaylistStore((s) => s.previous);
  const jumpTo = usePlaylistStore((s) => s.jumpTo);
  const stop = usePlaylistStore((s) => s.stop);

  // KLUCZOWE: używamy SHARED player'a z GlobalAudioPlayer przez PlayerContext.
  // Wcześniej tworzyłem tu drugi useAudioPlayer(audioUrl) → to była osobna
  // martwa instancja natywnego playera, jej currentTime nigdy nie rósł,
  // seekTo działało "obok" faktycznego audio. Teraz mamy jeden player.
  const player = useSharedPlayer();
  const status = useAudioPlayerStatus(player);
  const currentTime = status?.currentTime ?? 0;
  const duration = status?.duration ?? 0;
  const progress = duration > 0 ? currentTime / duration : 0;

  // ── Seekbar: touchable bar oblicza pozycję kliknięcia i wywołuje seekTo ──
  const [trackWidth, setTrackWidth] = useState(0);
  const handleTrackLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);
  const handleSeek = useCallback(
    (e: GestureResponderEvent) => {
      if (!trackWidth || !duration) return;
      const ratio = Math.min(1, Math.max(0, e.nativeEvent.locationX / trackWidth));
      player.seekTo(ratio * duration);
    },
    [trackWidth, duration, player],
  );

  const contextLabel = useMemo(() => {
    if (!context) return "";
    if (context.kind === "umgebung") return "Meine Umgebung";
    if (context.kind === "stadt") return context.stadt;
    if (context.kind === "kategorie") return context.kategorieName;
    if (context.kind === "aktuelle_liste") return context.label;
    return "";
  }, [context]);

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  const handleStop = useCallback(() => {
    stop();
    router.back();
  }, [stop, router]);

  if (!isActive || !currentPlace) {
    // Playlista skończyła się i została oczyszczona — wróć
    return (
      <SafeAreaView style={s.emptyContainer}>
        <Text style={s.emptyText}>Keine aktive Playlist</Text>
        <TouchableOpacity onPress={handleClose} style={s.emptyBtn}>
          <Text style={s.emptyBtnText}>Zurück</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const imageUrl = getMainImageUrl(currentPlace);

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={s.container} edges={["top", "bottom"]}>
        {/* ── Header (przyklejony na górze, duże przyciski minimalizowania i zamykania) ── */}
        <View style={s.header}>
          <TouchableOpacity
            onPress={handleClose}
            style={s.headerBtn}
            activeOpacity={0.75}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ChevronDown />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={s.headerLabel}>TOUR-PLAYLIST</Text>
            <Text style={s.headerTitle} numberOfLines={1}>
              {contextLabel}
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleStop}
            style={[s.headerBtn, s.headerBtnClose]}
            activeOpacity={0.75}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <CloseXIcon />
          </TouchableOpacity>
        </View>

        {/* ── Główny ScrollView: okładka + odtwarzacz + lista pozycji przewijają się razem ── */}
        <ScrollView
          style={s.mainScroll}
          contentContainerStyle={s.mainScrollContent}
          showsVerticalScrollIndicator
        >
          {/* ── Cover ── */}
          <View style={s.coverWrap}>
            {imageUrl ? (
              <Image
                source={{ uri: imageUrl }}
                style={s.cover}
                contentFit="cover"
                transition={150}
                cachePolicy="memory-disk"
              />
            ) : (
              <View style={[s.cover, s.coverPlaceholder]} />
            )}
          </View>

          {/* ── Meta ── */}
          <View style={s.meta}>
            <Text style={s.trackTitle} numberOfLines={2}>
              {currentPlace.Name}
            </Text>
            {currentPlace.Stadt && (
              <Text style={s.trackCity}>
                {currentPlace.Stadt}
                {currentPlace.Land ? ` · ${currentPlace.Land}` : ""}
              </Text>
            )}
            <Text style={s.trackPosition}>
              {currentIndex + 1} / {queue.length}
            </Text>
          </View>

          {/* ── Progress (touchable, seekable) ── */}
          <View style={s.progressWrap}>
            <TouchableOpacity
              activeOpacity={1}
              onPress={handleSeek}
              onLayout={handleTrackLayout}
              style={s.progressTouchable}
            >
              <View style={s.progressBar}>
                <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
                <View style={[s.progressThumb, { left: `${progress * 100}%` }]} />
              </View>
            </TouchableOpacity>
            <View style={s.progressTimes}>
              <Text style={s.timeText}>{formatTime(currentTime)}</Text>
              <Text style={s.timeText}>{formatTime(duration)}</Text>
            </View>
          </View>

          {/* ── Controls ── */}
          <View style={s.controls}>
            <TouchableOpacity
              onPress={previous}
              disabled={currentIndex === 0}
              style={[s.ctrlBtn, currentIndex === 0 && s.ctrlBtnDisabled]}
            >
              <PrevIcon />
            </TouchableOpacity>

            <TouchableOpacity onPress={togglePlay} style={s.playBtn}>
              {isPlaying ? <PauseIcon size={36} /> : <PlayIcon size={36} />}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={next}
              disabled={currentIndex >= queue.length - 1}
              style={[s.ctrlBtn, currentIndex >= queue.length - 1 && s.ctrlBtnDisabled]}
            >
              <NextIcon />
            </TouchableOpacity>
          </View>

          {/* ── Queue (Als Nächstes) — przesuwa się w górę razem z resztą ekranu ── */}
          <View style={s.queueSection}>
            <View style={s.queueHeader}>
              <Text style={s.queueTitle}>Als Nächstes ({queue.length} Orte)</Text>
              <Text style={s.queueSubtitle}>Nach oben wischen für die gesamte Liste</Text>
            </View>

            <View style={s.queueContent}>
              {queue.map((place, i) => {
                const isCurrent = i === currentIndex;
                return (
                  <TouchableOpacity
                    key={place.id}
                    style={[s.queueRow, isCurrent && s.queueRowActive]}
                    onPress={() => jumpTo(i)}
                    activeOpacity={0.8}
                  >
                    <View style={[s.queueIdxBadge, isCurrent && s.queueIdxBadgeActive]}>
                      <Text style={[s.queueIdx, isCurrent && s.queueIdxActive]}>{i + 1}</Text>
                    </View>
                    <View style={s.queueInfo}>
                      <Text style={[s.queueName, isCurrent && s.queueNameActive]} numberOfLines={2}>
                        {place.Name}
                      </Text>
                      {place.Stadt && (
                        <Text
                          style={[s.queueCity, isCurrent && s.queueCityActive]}
                          numberOfLines={1}
                        >
                          {place.Stadt}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#18222F" },
  container: { flex: 1 },

  emptyContainer: {
    flex: 1,
    backgroundColor: "#18222F",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  emptyText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "FiraSansCondensed_400Regular",
  },
  emptyBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#fc6c14",
    borderRadius: 20,
  },
  emptyBtnText: {
    color: "#fff",
    fontFamily: "FiraSansCondensed_600SemiBold",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  headerBtn: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.32)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerBtnClose: {
    backgroundColor: "rgba(252,108,20,0.22)",
    borderColor: "#fc6c14",
  },
  headerCenter: { flex: 1, alignItems: "center", paddingHorizontal: 10 },
  headerLabel: {
    color: "#fc6c14",
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontFamily: "FiraSansCondensed_700Bold",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 17,
    fontFamily: "FiraSansCondensed_700Bold",
    marginTop: 2,
  },

  mainScroll: {
    flex: 1,
  },
  mainScrollContent: {
    paddingBottom: 36,
  },

  coverWrap: {
    alignItems: "center",
    marginTop: 18,
    marginBottom: 18,
  },
  cover: {
    width: COVER_SIZE,
    height: COVER_SIZE,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "#333",
  },
  coverPlaceholder: { backgroundColor: "#333" },

  meta: {
    paddingHorizontal: 24,
    alignItems: "center",
    marginBottom: 18,
  },
  trackTitle: {
    color: "#fff",
    fontSize: 24,
    textAlign: "center",
    fontFamily: "FiraSansCondensed_700Bold",
    lineHeight: 30,
  },
  trackCity: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 15,
    marginTop: 6,
    fontFamily: "FiraSansCondensed_400Regular",
  },
  trackPosition: {
    color: "#fc6c14",
    fontSize: 13,
    marginTop: 8,
    letterSpacing: 1,
    fontFamily: "FiraSansCondensed_700Bold",
  },

  progressWrap: {
    paddingHorizontal: 24,
    marginBottom: 18,
  },
  progressTouchable: {
    height: 32,
    justifyContent: "center",
  },
  progressBar: {
    height: 5,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: 3,
    overflow: "visible",
  },
  progressFill: {
    height: 5,
    backgroundColor: "#fc6c14",
    borderRadius: 3,
  },
  progressThumb: {
    position: "absolute",
    top: -6,
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: "#fc6c14",
    marginLeft: -8.5,
    borderWidth: 2,
    borderColor: "#fff",
  },
  progressTimes: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  timeText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "FiraSansCondensed_600SemiBold",
  },

  controls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 30,
    marginBottom: 24,
  },
  ctrlBtn: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  ctrlBtnDisabled: { opacity: 0.3 },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#fc6c14",
    borderWidth: 2,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#fc6c14",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },

  queueSection: {
    borderTopWidth: 1.5,
    borderTopColor: "rgba(255,255,255,0.14)",
    paddingTop: 18,
  },
  queueHeader: {
    paddingHorizontal: 20,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  queueTitle: {
    color: "#fc6c14",
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontFamily: "FiraSansCondensed_700Bold",
  },
  queueSubtitle: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontFamily: "FiraSansCondensed_400Regular",
  },
  queueContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  queueRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 14,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  queueRowActive: {
    backgroundColor: "rgba(252,108,20,0.2)",
    borderColor: "#fc6c14",
    borderWidth: 1.5,
  },
  queueIdxBadge: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  queueIdxBadgeActive: {
    backgroundColor: "#fc6c14",
  },
  queueIdx: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 15,
    fontFamily: "FiraSansCondensed_700Bold",
  },
  queueIdxActive: {
    color: "#ffffff",
  },
  queueInfo: { flex: 1 },
  queueName: {
    color: "#ffffff",
    fontSize: 18,
    lineHeight: 23,
    fontFamily: "FiraSansCondensed_600SemiBold",
  },
  queueNameActive: {
    fontFamily: "FiraSansCondensed_700Bold",
    color: "#ffffff",
  },
  queueCity: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 14,
    marginTop: 3,
    fontFamily: "FiraSansCondensed_400Regular",
  },
  queueCityActive: {
    color: "#fc6c14",
    fontFamily: "FiraSansCondensed_600SemiBold",
  },
});
