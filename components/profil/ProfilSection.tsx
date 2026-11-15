// Hinweis (2026-07-04): Community-Feature auf Eis gelegt (Entscheidung Frank —
// Aufwand/Kosten Rechtsberatung). Diese Datei wurde auf den Stand vor dem
// Feature zurückgesetzt. Der fertige Community-Block (Bio + Sichtbarkeit) liegt
// als Referenz im Web-Projekt: components/auth/CommunityProfilSection.tsx.
// DB-Felder profiles.bio / profiles.is_public bleiben in Supabase erhalten.
// Zum Reaktivieren: Block von dort nach React Native portieren + Props
// profile/refreshProfile aus (tabs)/profil.tsx werden bereits übergeben.

import { useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from "react-native";

export default function ProfilSection({ user, signOut }: any) {
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <View style={s.section}>
      <View style={s.card}>
        <Text style={s.sectionTitle}>Kontodaten</Text>
        <View style={s.infoRow}>
          <Text style={s.infoLabel}>E-Mail-Adresse</Text>
          <Text style={s.infoValue}>{user?.email ?? "—"}</Text>
        </View>
      </View>

      {/* RevenueCat bindet das Abo an die Konto-ID. Beim Abmelden erzeugt das
          SDK eine neue anonyme ID ohne Kauf — Premium verschwindet also, bis
          sich der Nutzer wieder anmeldet. Das muss vor dem Klick klar sein. */}
      <View style={s.warningBox}>
        <Text style={s.warningText}>
          Nach dem Abmelden stehen dir die FAIRFÜHRER+ Funktionen nicht mehr zur Verfügung. Melde
          dich einfach wieder mit diesem Konto an — dein Abo ist sofort wieder aktiv.
        </Text>
      </View>
      <TouchableOpacity
        style={[s.signOutBtn, signingOut && s.btnDisabled]}
        onPress={handleSignOut}
        disabled={signingOut}
        activeOpacity={0.7}
      >
        {signingOut ? (
          <ActivityIndicator color="#18222f" size="small" />
        ) : (
          <Text style={s.signOutBtnText}>Abmelden</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  section: { gap: 14 },
  card: {
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderRadius: 8,
    padding: 18,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "FiraSansCondensed_700Bold",
    color: "#fc6c14",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  btnDisabled: { opacity: 0.5 },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "rgba(24,34,47,0.12)",
  },
  infoLabel: {
    fontSize: 14,
    fontFamily: "FiraSansCondensed_600SemiBold",
    color: "#5a6472",
  },
  infoValue: {
    fontSize: 15,
    fontFamily: "FiraSansCondensed_600SemiBold",
    color: "#18222f",
    flexShrink: 1,
    textAlign: "right",
  },
  warningBox: {
    backgroundColor: "#fff5ef",
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderLeftWidth: 4,
    borderLeftColor: "#fc6c14",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  warningText: {
    fontSize: 14,
    fontFamily: "FiraSansCondensed_400Regular",
    color: "#18222f",
    lineHeight: 20,
  },
  signOutBtn: {
    borderWidth: 1.5,
    borderColor: "#18222f",
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },
  signOutBtnText: {
    fontFamily: "FiraSansCondensed_700Bold",
    fontSize: 16,
    color: "#18222f",
    letterSpacing: 0.4,
  },
});
