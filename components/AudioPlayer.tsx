import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  GestureResponderEvent,
  LayoutChangeEvent,
} from "react-native";
import Svg, { Polygon, Rect, Path } from "react-native-svg";
import * as Haptics from "expo-haptics";
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from "expo-audio";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
} from "react-native-reanimated";

// ─── Ikony — spójne z ColumnAudioPlayer na Web ───────────────────────────────

function PlayIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polygon points="8.5,6.5 17.5,12 8.5,17.5" fill="#ffffff" />
    </Svg>
  );
}

function PauseIcon({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="7.5" y="6.5" width="3" height="11" fill="#ffffff" rx="0.8" />
      <Rect x="13.5" y="6.5" width="3" height="11" fill="#ffffff" rx="0.8" />
    </Svg>
  );
}

function SkipBackIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M11 17l-5-5 5-5M18 17l-5-5 5-5"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function SkipForwardIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M13 17l5-5-5-5M6 17l5-5-5-5"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ─── Przycisk z animacją press ───────────────────────────────────────────────

function PressButton({
  onPress,
  children,
  style,
}: {
  onPress: () => void;
  children: React.ReactNode;
  style?: object;
}) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const onPressIn = useCallback(() => {
    scale.value = withTiming(0.92, { duration: 100, easing: Easing.out(Easing.cubic) });
  }, [scale]);

  const onPressOut = useCallback(() => {
    scale.value = withSpring(1, { damping: 12, stiffness: 220, mass: 0.5 });
  }, [scale]);

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
    >
      <Animated.View style={[style, animStyle]}>{children}</Animated.View>
    </TouchableOpacity>
  );
}

// ─── Utils ──────────────────────────────────────────────────────────────────

const formatTime = (t: number) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

// ─── AudioPlayer (Studio / ColumnAudioPlayer Design) ─────────────────────────

const SPEED_OPTIONS = [1, 1.25, 1.5, 1.75, 2] as const;
type SpeedOption = (typeof SPEED_OPTIONS)[number];

interface AudioPlayerProps {
  src: string;
}

export function AudioPlayer({ src }: AudioPlayerProps) {
  const [readyToMountPlayer, setReadyToMountPlayer] = useState(false);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true });
    // Odrocz inicjalizację natywnego odtwarzacza i buforowanie strumienia MP3
    // do momentu, aż wątek będzie bezczynny po otwarciu modala (zgodnie z RN 0.83+
    // używamy requestIdleCallback zamiast przestarzałego InteractionManager).
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(() => {
        setReadyToMountPlayer(true);
      });
      return () => cancelIdleCallback(id);
    }
    const timer = setTimeout(() => {
      setReadyToMountPlayer(true);
    }, 80);
    return () => clearTimeout(timer);
  }, []);

  if (!readyToMountPlayer) {
    return (
      <View style={styles.audioPlayer}>
        <View style={styles.audioControls}>
          <View style={styles.skipButton}>
            <SkipBackIcon size={20} />
          </View>
          <View style={styles.playButton}>
            <PlayIcon size={26} />
          </View>
          <View style={styles.skipButton}>
            <SkipForwardIcon size={20} />
          </View>
        </View>
        <View style={styles.progressContainer}>
          <Text style={styles.timeText}>0:00</Text>
          <View style={styles.trackTouchable}>
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: "0%" }]} />
              <View style={[styles.thumb, { left: "0%" }]} />
            </View>
          </View>
          <Text style={styles.timeText}>0:00</Text>
        </View>
        <View style={styles.speedControl}>
          {SPEED_OPTIONS.map((speed) => {
            const isActive = speed === 1;
            return (
              <View
                key={speed}
                style={[styles.speedButton, isActive && styles.speedButtonActive]}
              >
                <Text style={[styles.speedButtonText, isActive && styles.speedButtonTextActive]}>
                  {speed}x
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  return <AudioPlayerMounted src={src} />;
}

function AudioPlayerMounted({ src }: AudioPlayerProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<SpeedOption>(1);

  const player = useAudioPlayer(src);
  const status = useAudioPlayerStatus(player);
  const isPlaying = status.playing;
  const currentTime = status.currentTime ?? 0;
  const duration = status.duration ?? 0;
  const progress = duration > 0 ? currentTime / duration : 0;

  const handleTrackPress = useCallback(
    (e: GestureResponderEvent) => {
      if (!trackWidth || !duration) return;
      player.seekTo(Math.min(1, Math.max(0, e.nativeEvent.locationX / trackWidth)) * duration);
    },
    [trackWidth, duration, player],
  );

  const handleSkipBack = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    player.seekTo(Math.max(0, currentTime - 10));
  }, [player, currentTime]);

  const handleSkipForward = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    player.seekTo(Math.min(duration, currentTime + 10));
  }, [player, duration, currentTime]);

  const handleTogglePlay = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  }, [isPlaying, player]);

  const handleSetSpeed = useCallback(
    (speed: SpeedOption) => {
      void Haptics.selectionAsync().catch(() => {});
      setPlaybackSpeed(speed);
      player.setPlaybackRate(speed);
    },
    [player],
  );

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  return (
    <View style={styles.audioPlayer}>
      {/* Kontrolki główne — wzorowane na ColumnAudioPlayer z Web */}
      <View style={styles.audioControls}>
        <PressButton onPress={handleSkipBack}>
          <View style={styles.skipButton}>
            <SkipBackIcon size={20} />
          </View>
        </PressButton>

        <PressButton onPress={handleTogglePlay}>
          <View style={[styles.playButton, isPlaying && styles.playButtonActive]}>
            {isPlaying ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
          </View>
        </PressButton>

        <PressButton onPress={handleSkipForward}>
          <View style={styles.skipButton}>
            <SkipForwardIcon size={20} />
          </View>
        </PressButton>
      </View>

      {/* Pasek postępu */}
      <View style={styles.progressContainer}>
        <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
        <TouchableOpacity
          activeOpacity={1}
          style={styles.trackTouchable}
          onPress={handleTrackPress}
          onLayout={handleLayout}
        >
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
            <View style={[styles.thumb, { left: `${progress * 100}%` }]} />
          </View>
        </TouchableOpacity>
        <Text style={styles.timeText}>{formatTime(duration)}</Text>
      </View>

      {/* Prędkość odtwarzania */}
      <View style={styles.speedControl}>
        {SPEED_OPTIONS.map((speed) => {
          const isActive = playbackSpeed === speed;
          return (
            <TouchableOpacity
              key={speed}
              onPress={() => handleSetSpeed(speed)}
              activeOpacity={0.75}
              style={[styles.speedButton, isActive && styles.speedButtonActive]}
            >
              <Text style={[styles.speedButtonText, isActive && styles.speedButtonTextActive]}>
                {speed}x
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  audioPlayer: {
    width: "100%",
    maxWidth: 340,
    alignSelf: "center",
    paddingTop: 4,
  },
  audioControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
  },
  skipButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  playButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderWidth: 2,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  playButtonActive: {
    backgroundColor: "rgba(24, 34, 47, 0.32)",
  },
  progressContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  trackTouchable: {
    flex: 1,
    height: 28,
    justifyContent: "center",
  },
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255, 255, 255, 0.35)",
    overflow: "visible",
  },
  trackFill: {
    position: "absolute",
    top: 0,
    left: 0,
    height: 4,
    backgroundColor: "#ffffff",
    borderRadius: 2,
  },
  thumb: {
    position: "absolute",
    top: -5,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#ffffff",
    marginLeft: -7,
  },
  timeText: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.92)",
    fontFamily: "FiraSansCondensed_600SemiBold",
    width: 36,
    textAlign: "center",
  },
  speedControl: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
  },
  speedButton: {
    height: 26,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.35)",
    backgroundColor: "rgba(0, 0, 0, 0.16)",
    minWidth: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  speedButtonActive: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff",
  },
  speedButtonText: {
    fontSize: 12,
    color: "#ffffff",
    fontFamily: "FiraSansCondensed_600SemiBold",
  },
  speedButtonTextActive: {
    color: "#18222f",
    fontFamily: "FiraSansCondensed_700Bold",
  },
});
