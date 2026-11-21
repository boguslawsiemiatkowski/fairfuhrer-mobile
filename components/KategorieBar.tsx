import React, { useState, useCallback } from "react";
import { View, Text, TouchableOpacity, Modal, StyleSheet, Platform } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { CategoryIcon, categoryColorFor } from "./CategoryIcon";
// isSightsCategory wird hier nicht mehr gebraucht, seit der Hinweis zur
// 50-%-Sperre entfallen ist. `isPro` bleibt als Prop bestehen: die
// aufrufenden Bildschirme übergeben es, und ein Entfernen würde dort
// Änderungen erzwingen, ohne etwas zu gewinnen.
import { BRAND_ORANGE_TEXT } from "@/lib/colors";
import type { DirectusKategorie } from "@/types";

// DEFAULT_COLOR ist entfallen: categoryColorFor() bringt den Rückfall
// (#fc6c14) selbst mit, siehe CategoryIcon.tsx.
// Warmer Cremeton für die Kategorie-Leiste im Ausgangszustand (kein Filter
// aktiv). Border der Leiste nutzt denselben Wert (randlos wirkende Kante).
const BAR_BG = "rgba(255, 242, 232, 0.9)";

export function KategorieBar({
  categories,
  selectedId,
  onSelect,
  isPro,
}: {
  categories: DirectusKategorie[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  isPro: boolean;
}) {
  const [modalVisible, setModalVisible] = useState(false);
  const slideAnim = useSharedValue(0);
  const insets = useSafeAreaInsets();

  const selectedCat = selectedId ? categories.find((c) => c.id === selectedId) : null;
  // Abgedunkelt, weil die Leiste bei Auswahl weiße Schrift trägt: die rohen
  // Directus-Farben erreichen dort keinen lesbaren Kontrast (Gelb 1,58:1).
  // Dieselbe Rechnung wie im Web — siehe categoryColor().
  const barColor = selectedCat ? categoryColorFor(selectedCat) : BAR_BG;

  const openMenu = useCallback(() => {
    void Haptics.selectionAsync().catch(() => {});
    slideAnim.set(0);
    setModalVisible(true);
  }, [slideAnim]);

  const handleModalShow = useCallback(() => {
    slideAnim.set(
      withTiming(1, {
        duration: 240,
        easing: Easing.out(Easing.quad),
      }),
    );
  }, [slideAnim]);

  const finishClose = useCallback(
    (id: number | null) => {
      setModalVisible(false);
      onSelect(id);
    },
    [onSelect],
  );

  const closeMenu = useCallback(
    (id: number | null) => {
      if (id !== selectedId) {
        void Haptics.selectionAsync().catch(() => {});
      }
      slideAnim.set(
        withTiming(
          0,
          {
            duration: 190,
            easing: Easing.in(Easing.quad),
          },
          (finished) => {
            if (finished) {
              scheduleOnRN(finishClose, id);
            }
          },
        ),
      );
    },
    [slideAnim, finishClose, selectedId],
  );

  const backdropAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(slideAnim.value, [0, 1], [0, 0.4]),
  }));

  const menuAnimatedStyle = useAnimatedStyle(() => ({
    opacity: slideAnim.value,
    transform: [{ translateY: interpolate(slideAnim.value, [0, 1], [24, 0]) }],
  }));

  return (
    <View>
      <Modal
        transparent
        visible={modalVisible}
        animationType="none"
        onShow={handleModalShow}
        onRequestClose={() => closeMenu(selectedId)}
        statusBarTranslucent
      >
        <Animated.View
          style={[styles.kategorieBackdrop, backdropAnimatedStyle]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => closeMenu(selectedId)}
          />
        </Animated.View>

        <Animated.View
          style={[styles.kategorieMenu, { paddingBottom: insets.bottom }, menuAnimatedStyle]}
        >
          <TouchableOpacity
            style={[
              styles.kategorieMenuItem,
              selectedId === null && styles.kategorieMenuItemActive,
            ]}
            onPress={() => closeMenu(null)}
            activeOpacity={0.7}
          >
            <View style={styles.kategorieMenuIcon}>
              <CategoryIcon
                categoryId={null}
                color={selectedId === null ? "#fff" : "#000"}
                strokeColor={selectedId === null ? "#000" : "#fff"}
              />
            </View>
            <Text
              style={[
                styles.kategorieMenuText,
                selectedId === null && styles.kategorieMenuTextActive,
              ]}
            >
              Alle
            </Text>
          </TouchableOpacity>
          {categories.map((cat) => {
            const isActive = cat.id === selectedId;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.kategorieMenuItem, isActive && styles.kategorieMenuItemActive]}
                onPress={() => closeMenu(cat.id)}
                activeOpacity={0.7}
              >
                <View style={styles.kategorieMenuIcon}>
                  <CategoryIcon
                    categoryId={cat.id}
                    color={categoryColorFor(cat)}
                    strokeColor="#fff"
                  />
                </View>
                <View style={styles.kategorieMenuTextWrap}>
                  <Text
                    style={[styles.kategorieMenuText, isActive && styles.kategorieMenuTextActive]}
                  >
                    {cat.Name}
                  </Text>
                  {/* Der Hinweis „Basis-Nutzer sehen nur 50 % der
                      Sehenswertes-Orte" ist entfallen: alle Audiopins sind
                      für jeden frei. */}
                </View>
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      </Modal>

      <TouchableOpacity
        style={[styles.kategorieBar, { backgroundColor: barColor }]}
        onPress={openMenu}
        activeOpacity={0.85}
      >
        {selectedCat ? (
          <>
            <View style={styles.kategorieBarIcon}>
              <CategoryIcon
                categoryId={selectedCat.id}
                color="rgba(255,255,255,0.22)"
                strokeColor="#fff"
                size={28}
              />
            </View>
            <Text style={[styles.kategorieBarText, { color: "#fff" }]}>{selectedCat.Name}</Text>
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                onSelect(null);
              }}
              style={styles.kategorieClearBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.kategorieClearText, { color: "#fff" }]}>✕</Text>
            </TouchableOpacity>
          </>
        ) : (
          // Orange auf hellorangem Balken — Vorgabe für die Konsistenz mit
          // der Website. Bewusst BRAND_ORANGE_TEXT statt BRAND_ORANGE: das
          // helle Orange käme auf BAR_BG nur auf 2,65:1 und wäre bei
          // Sonnenlicht kaum lesbar. Bei gewählter Kategorie färbt sich der
          // Balken in die Kategoriefarbe, dort bleibt die Schrift weiß (oben).
          <Text style={[styles.kategorieBarText, { color: BRAND_ORANGE_TEXT }]}>
            Kategorie wählen ›
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  kategorieBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000",
  },
  kategorieMenu: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#fff",
    borderTopWidth: 2,
    borderTopColor: "#18222f",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 20,
  },
  kategorieMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  kategorieMenuItemActive: { backgroundColor: "#000" },
  kategorieMenuIcon: {
    marginRight: 14,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  kategorieMenuTextWrap: { flex: 1 },
  kategorieMenuText: {
    fontSize: 20,
    fontFamily: "FiraSansCondensed_600SemiBold",
    color: "#000",
  },
  kategorieMenuTextActive: { color: "#fff" },
  kategorieMenuHint: {
    fontSize: 13,
    fontFamily: "FiraSansCondensed_400Regular",
    color: "#5c2121",
    marginTop: 2,
    paddingRight: 8,
  },
  kategorieMenuHintActive: { color: "rgba(255,255,255,0.9)" },
  kategorieBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    // Keine eigene Linie: vorher stand hier borderTopWidth in BAR_BG, dem
    // hellen Cremeton. Ohne Auswahl fiel das nicht auf, weil die Leiste
    // dieselbe Farbe hat — sobald aber eine Kategorie gewählt ist, wechselt
    // der Hintergrund auf die dunkle Kategoriefarbe und die helle Linie
    // blieb als weißer Rand stehen. Im Web war es derselbe Fehler.
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
  },
  kategorieBarIcon: { marginRight: 10 },
  kategorieBarText: {
    fontSize: 18,
    fontFamily: "FiraSansCondensed_600SemiBold",
    color: "#000",
    flex: 1,
  },
  kategorieClearBtn: { paddingLeft: 10 },
  kategorieClearText: { fontSize: 16, color: "#000" },
});
