import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import MenuButton from "./MenuButton";
import type { DirectusEinstellungen } from "@/types";

const DIRECTUS_URL = process.env.EXPO_PUBLIC_DIRECTUS_URL ?? "";

interface HomeHeaderProps {
  einstellungen: DirectusEinstellungen | null;
}

export default function HomeHeader({ einstellungen }: HomeHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <View style={styles.headerSpacer} />
        <View style={styles.logoCenterWrap}>
          {einstellungen?.Logo ? (
            <Image
              source={{ uri: `${DIRECTUS_URL}/assets/${einstellungen.Logo}` }}
              style={styles.logoImage}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          ) : (
            <Text style={styles.logo}>FAIRFÜHRER</Text>
          )}
        </View>
        <View style={styles.headerMenuSlot}>
          <MenuButton />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 8,
    paddingBottom: 6,
    backgroundColor: "#fff",
    borderBottomWidth: 2,
    borderBottomColor: "#18222f",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  headerSpacer: {
    width: 36,
  },
  logoCenterWrap: {
    flex: 1,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
  },
  headerMenuSlot: {
    width: 36,
    alignItems: "flex-end",
  },
  logoImage: {
    width: "100%",
    height: 68,
  },
  logo: {
    fontFamily: "Anton_400Regular",
    fontSize: 28,
    color: "#fc6c14",
    textAlign: "center",
    letterSpacing: 3,
  },
});
