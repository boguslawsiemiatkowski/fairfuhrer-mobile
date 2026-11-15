import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  ImageBackground,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Purchases, { PurchasesPackage } from "react-native-purchases";
import { ENTITLEMENT_ID, isAlreadyOwnedError, restoreAndCheckPro } from "@/lib/revenuecat";
import { useAuth } from "@/context/AuthContext";
import { getPaywallContent, type PaywallContent } from "@/lib/directus";
import AccountBenefitsCard from "@/components/AccountBenefitsCard";

// Fallback-Texte, falls Directus nichts liefert
const DEFAULTS = {
  hero_eyebrow: "FAIRFÜHRER+",
  hero_headline: "WERDE\nFAIR-\nMACHER:IN.",
  hero_subtitle:
    "Fairführer wird von einem kleinen Team gemacht. Mit deinem Beitrag bleiben wir frei und unabhängig — alle Funktionen gehören dazu.",
  // „Alle Sehenswürdigkeiten — nicht nur 50 %" ist entfallen: alle
  // Audiopins sind inzwischen für jeden frei (siehe placesStore). Offline-
  // Karten stehen jetzt an erster Stelle — sie sind die eigentliche
  // Gegenleistung. Die Texte kommen aus Directus; dort muss dieselbe
  // Änderung nachgezogen werden, das hier sind nur die Rückfalltexte.
  features: [
    "Offline-Karten für unterwegs",
    "Eigene Orte vorschlagen & Pins erstellen",
    "Redaktionelle Prüfung deiner Pins",
    "Du hältst den Fairführer frei und unabhängig",
  ],
  popular_badge: "BELIEBT",
  cta_prefix: "FAIRFÜHRER+ aktivieren",
  restore_text: "Käufe wiederherstellen",
  legal_link_terms: "Nutzungsbedingungen",
  legal_link_privacy: "Datenschutz",
};

// CMS-Felder pro Paket-Identifier (Label/Sub). Preise/order/popular bleiben im Code.
const PACKAGE_CMS_KEYS: Record<string, { label: keyof PaywallContent; sub: keyof PaywallContent }> =
  {
    small_yearly: { label: "package_small_label", sub: "package_small_sub" },
    fair_yearly: { label: "package_fair_label", sub: "package_fair_sub" },
    large_yearly: { label: "package_large_label", sub: "package_large_sub" },
  };

const HERO_IMAGE = require("@/assets/images/engagement-unsplash.jpeg");

// Identyfikatory pakietów z RevenueCat Dashboard → Offerings → Packages.
// Sortowanie tablicy = kolejność na ekranie (od najtańszego do najdroższego).
const PACKAGE_META: Record<
  string,
  { label: string; sub: string; popular?: boolean; order: number }
> = {
  small_yearly: {
    label: "Kleine Unterstützung",
    sub: "Ein Kaffee fürs Team",
    order: 1,
  },
  fair_yearly: {
    label: "Faire Unterstützung",
    sub: "Empfohlen · deckt deinen Anteil",
    popular: true,
    order: 2,
  },
  large_yearly: {
    label: "Große Unterstützung",
    sub: "Du machst den Unterschied",
    order: 3,
  },
};

// Plattformspezifische Bezeichnungen für rechtliche Hinweise zum Abo.
// Google Play und App Store haben unterschiedliche Konto- und
// Verwaltungs-Begriffe – beide Stores prüfen diese Texte in der Review.
const STORE_ACCOUNT = Platform.OS === "ios" ? "Apple-ID-Konto" : "Google-Konto";
const STORE_NAME = Platform.OS === "ios" ? "App Store" : "Google Play";

/**
 * Liczy cenę miesięczną z rocznego pakietu. Zwraca string w lokalnej walucie
 * pakietu (RC ustawia ją automatycznie wg sklepu). Format dostosowany do
 * niemieckich konwencji (przecinek jako separator dziesiętny).
 */
function formatPerMonth(pkg: PurchasesPackage): string {
  const yearlyPrice = pkg.product.price; // liczba (np. 9.99)
  const monthly = yearlyPrice / 12;
  // Symbol waluty z lokalnego stringa, np. "9,99 €" -> "€"
  const currencySymbol = pkg.product.priceString.replace(/[\d.,\s]/g, "");
  const formatted = monthly.toFixed(2).replace(".", ",");
  return `${formatted} ${currencySymbol}/Monat`;
}

export default function PaywallScreen() {
  const router = useRouter();
  const { session, refreshPro } = useAuth();

  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [selected, setSelected] = useState<PurchasesPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [content, setContent] = useState<PaywallContent | null>(null);

  useEffect(() => {
    let active = true;
    getPaywallContent().then((c) => {
      if (active) setContent(c);
    });
    return () => {
      active = false;
    };
  }, []);

  const t = {
    hero_eyebrow: content?.hero_eyebrow || DEFAULTS.hero_eyebrow,
    hero_headline: content?.hero_headline || DEFAULTS.hero_headline,
    hero_subtitle: content?.hero_subtitle || DEFAULTS.hero_subtitle,
    features:
      content?.features && content.features.length > 0
        ? content.features.map((f) => f.text)
        : DEFAULTS.features,
    popular_badge: content?.popular_badge || DEFAULTS.popular_badge,
    cta_prefix: content?.cta_prefix || DEFAULTS.cta_prefix,
    restore_text: content?.restore_text || DEFAULTS.restore_text,
    legal_link_terms: content?.legal_link_terms || DEFAULTS.legal_link_terms,
    legal_link_privacy: content?.legal_link_privacy || DEFAULTS.legal_link_privacy,
  };

  useEffect(() => {
    Purchases.getOfferings()
      .then((offerings) => {
        const raw = offerings.current?.availablePackages ?? [];
        // Sortuj wg PACKAGE_META.order, nieznane identyfikatory na końcu.
        const sorted = [...raw].sort((a, b) => {
          const oa = PACKAGE_META[a.identifier]?.order ?? 99;
          const ob = PACKAGE_META[b.identifier]?.order ?? 99;
          return oa - ob;
        });
        setPackages(sorted);
        // Domyślnie zaznacz Faire Unterstützung (środkowy, oznaczony jako BELIEBT).
        const fair = sorted.find((p) => p.identifier === "fair_yearly");
        setSelected(fair ?? sorted[0] ?? null);
      })
      .catch((e) => console.error("[Paywall] getOfferings error:", e))
      .finally(() => setLoading(false));
  }, []);

  // Nach erfolgreichem Kauf bzw. Restore: Status auffrischen und weiter.
  // Bez Kontos: zeige Erfolgs-Screen mit Konto-Anmeldeoption (für
  // Offline-Karten und Ort-Vorschläge). Mit Konto: direkt zurück.
  const finishWithPro = async () => {
    await refreshPro();
    if (!session) {
      router.replace("/purchase-success");
    } else {
      router.back();
    }
  };

  const executePurchase = async (pkg: PurchasesPackage) => {
    setPurchasing(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      if (customerInfo.entitlements.active[ENTITLEMENT_ID]) {
        await finishWithPro();
      }
    } catch (e: any) {
      if (e.userCancelled) return;

      // "Gehört dir bereits": Der Store kennt den Kauf, RevenueCat hat ihn
      // aber einer anderen App-User-ID zugeordnet — typischerweise der
      // anonymen ID von vor der Registrierung. Ein Restore hängt den Beleg
      // an den aktuellen Nutzer; sonst säße der Käufer fest (kein zweiter
      // Kauf möglich, aber auch kein Premium).
      if (isAlreadyOwnedError(e)) {
        const recovered = await restoreAndCheckPro().catch(() => false);
        if (recovered) {
          await finishWithPro();
        } else {
          Alert.alert(
            "Kauf bereits vorhanden",
            "Dein Kauf konnte diesem Konto nicht zugeordnet werden. Bitte versuche es über „Käufe wiederherstellen“ — falls das nicht hilft, melde dich bei uns.",
          );
        }
        return;
      }

      Alert.alert("Fehler", "Kauf konnte nicht abgeschlossen werden.");
    } finally {
      setPurchasing(false);
    }
  };

  const handlePurchase = async () => {
    if (!selected) return;
    // Kauf ohne Konto möglich (Apple-Richtlinie 5.1.1(v)): RevenueCat verwaltet
    // das Abo über eine anonyme App-User-ID. Ein Konto ist optional und dient
    // nur der geräteübergreifenden Synchronisation. Nach erfolgreichem Kauf
    // können wir dem Nutzer optional ein Konto anbieten.
    await executePurchase(selected);
  };

  const handleRestore = async () => {
    try {
      const info = await Purchases.restorePurchases();
      if (info.entitlements.active[ENTITLEMENT_ID]) {
        await refreshPro();
        router.back();
      } else {
        Alert.alert("Keine Käufe gefunden", "Es wurden keine früheren Käufe gefunden.");
      }
    } catch {
      Alert.alert("Fehler", "Wiederherstellung fehlgeschlagen.");
    }
  };

  const selectedPrice = selected?.product.priceString ?? "";

  return (
    <SafeAreaView style={s.container} edges={["top", "bottom"]}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        {/* ── Hero ── */}
        <ImageBackground source={HERO_IMAGE} style={s.hero} resizeMode="cover">
          <LinearGradient
            colors={["rgba(24,23,22,0.2)", "rgba(24,23,22,0.85)"]}
            style={StyleSheet.absoluteFill}
          />

          <TouchableOpacity style={s.closeBtn} onPress={() => router.back()} hitSlop={12}>
            <Text style={s.closeBtnText}>✕</Text>
          </TouchableOpacity>

          <View style={s.heroContent}>
            <Text style={s.heroEyebrow}>{t.hero_eyebrow}</Text>
            <Text style={s.heroHeadline}>{t.hero_headline}</Text>
            <Text style={s.heroSubtitle}>{t.hero_subtitle}</Text>
          </View>
        </ImageBackground>

        {/* ── Features ── */}
        <View style={s.featuresSection}>
          {t.features.map((f) => (
            <View key={f} style={s.featureRow}>
              <Text style={s.featureCheck}>✓</Text>
              <Text style={s.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        {/* ── Konto-Vorteile: prominente Karte statt kleiner Grau-Kursiv-Note ── */}
        <View style={s.benefitsSection}>
          <AccountBenefitsCard
            onCtaPress={() => {
              router.dismissTo?.("/(tabs)/profil");
              // Fallback für ältere expo-router Versionen ohne dismissTo:
              router.replace("/(tabs)/profil");
            }}
          />
        </View>

        {/* ── Packages (Reich layout) ── */}
        {loading ? (
          <ActivityIndicator color="#fc6c14" style={{ marginVertical: 24 }} />
        ) : (
          <View style={s.packagesSection}>
            {packages.map((pkg) => {
              const isSelected = selected?.identifier === pkg.identifier;
              const price = pkg.product.priceString;
              const meta = PACKAGE_META[pkg.identifier];
              const cmsKeys = PACKAGE_CMS_KEYS[pkg.identifier];
              const label =
                (cmsKeys && (content?.[cmsKeys.label] as string)) ||
                meta?.label ||
                pkg.product.title;
              const sub =
                (cmsKeys && (content?.[cmsKeys.sub] as string)) || meta?.sub || "Jährlich";
              const perMonth = formatPerMonth(pkg);
              const isPopular = meta?.popular ?? false;

              return (
                <TouchableOpacity
                  key={pkg.identifier}
                  style={[s.packageCard, isSelected && s.packageCardSelected]}
                  onPress={() => setSelected(pkg)}
                  activeOpacity={0.85}
                >
                  <View style={[s.radioOuter, isSelected && s.radioOuterActive]}>
                    {isSelected && <View style={s.radioInner} />}
                  </View>

                  <View style={s.packageInfo}>
                    <Text style={s.packageTitle}>{label}</Text>
                    <Text style={s.packageDescription}>{sub}</Text>
                  </View>

                  <View style={s.packagePrice}>
                    <Text style={s.packagePriceValue}>{price}</Text>
                    {!!perMonth && <Text style={s.packagePerMonth}>{perMonth}</Text>}
                  </View>

                  {isPopular && (
                    <View style={s.popularBadge}>
                      <Text style={s.popularBadgeText}>{t.popular_badge}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* ── CTA ── */}
        <View style={s.ctaSection}>
          <TouchableOpacity
            style={[s.ctaBtn, (!selected || purchasing) && s.ctaBtnDisabled]}
            onPress={handlePurchase}
            disabled={!selected || purchasing}
          >
            {purchasing ? (
              <ActivityIndicator color="#fc6c14" />
            ) : (
              <Text style={s.ctaBtnText}>
                {t.cta_prefix} · {selectedPrice}/Jahr
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={handleRestore} style={s.restoreBtn}>
            <Text style={s.restoreBtnText}>{t.restore_text}</Text>
          </TouchableOpacity>

          {/* ── Legal (Voll) ── */}
          <View style={s.legalBlock}>
            <Text style={s.legalText}>
              <Text style={s.legalStrong}>Jahres-Abo · {selectedPrice}/Jahr.</Text> Zahlung wird
              nach Bestätigung des Kaufs deinem {STORE_ACCOUNT} belastet. Das Abo verlängert sich
              automatisch um 12 Monate zum dann gültigen Preis, sofern es nicht mindestens 24
              Stunden vor Ablauf der laufenden Periode gekündigt wird.
            </Text>
            <Text style={s.legalText}>
              Du kannst dein Abo jederzeit in den Einstellungen deines {STORE_NAME}-Kontos verwalten
              und kündigen — eine Erstattung des laufenden Zeitraums ist nicht möglich.
            </Text>
            <View style={s.legalLinks}>
              <Text style={s.legalLink} onPress={() => router.push("/(drawer)/agb")}>
                {t.legal_link_terms}
              </Text>
              <Text style={s.legalSep}> · </Text>
              <Text style={s.legalLink} onPress={() => router.push("/(drawer)/datenschutz")}>
                {t.legal_link_privacy}
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8f8ff" },
  scroll: { flexGrow: 1 },

  // Hero
  hero: {
    minHeight: 380,
    justifyContent: "flex-end",
    borderBottomWidth: 2,
    borderBottomColor: "#18222f",
  },
  closeBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#18222f",
    borderRadius: 8,
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  closeBtnText: {
    color: "#18222f",
    fontSize: 16,
    fontFamily: "FiraSansCondensed_700Bold",
  },
  heroContent: { paddingHorizontal: 24, paddingBottom: 32, gap: 10 },
  heroEyebrow: {
    fontSize: 11,
    fontFamily: "FiraSansCondensed_700Bold",
    color: "#fc6c14",
    letterSpacing: 2.5,
  },
  heroHeadline: {
    fontFamily: "Anton_400Regular",
    fontSize: 52,
    color: "#fff",
    lineHeight: 54,
    letterSpacing: 1,
  },
  heroSubtitle: {
    fontSize: 16,
    fontFamily: "FiraSansCondensed_400Regular",
    color: "rgba(255,255,255,0.9)",
    lineHeight: 22,
  },

  // Features
  featuresSection: {
    marginHorizontal: 20,
    marginTop: 20,
    padding: 18,
    gap: 10,
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderRadius: 8,
  },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  featureCheck: {
    fontSize: 15,
    color: "#2D6A4F",
    fontFamily: "FiraSansCondensed_700Bold",
    lineHeight: 22,
    width: 18,
  },
  featureText: {
    fontSize: 15,
    fontFamily: "FiraSansCondensed_400Regular",
    color: "#18222f",
    flex: 1,
    lineHeight: 22,
  },
  benefitsSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },

  // Packages — Reich layout
  packagesSection: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 12,
  },
  packageCard: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderRadius: 8,
    paddingVertical: 16,
    paddingHorizontal: 18,
    backgroundColor: "#ffffff",
  },
  packageCardSelected: {
    borderWidth: 2,
    borderColor: "#18222f",
    backgroundColor: "#fff5ef",
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#18222f",
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterActive: {
    borderColor: "#fc6c14",
    backgroundColor: "#fc6c14",
  },
  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#fff",
  },
  packageInfo: { flex: 1 },
  packageTitle: {
    fontSize: 15,
    fontFamily: "FiraSansCondensed_700Bold",
    color: "#18222f",
  },
  packageDescription: {
    fontSize: 12,
    fontFamily: "FiraSansCondensed_400Regular",
    color: "#5a6472",
    marginTop: 2,
  },
  packagePrice: { alignItems: "flex-end" },
  packagePriceValue: {
    fontFamily: "Anton_400Regular",
    fontSize: 22,
    color: "#18222f",
    letterSpacing: 0.5,
  },
  packagePerMonth: {
    fontFamily: "FiraSansCondensed_400Regular",
    fontSize: 11,
    color: "#5a6472",
  },
  popularBadge: {
    position: "absolute",
    top: -10,
    right: 14,
    backgroundColor: "#fc6c14",
    borderWidth: 1,
    borderColor: "#18222f",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  popularBadgeText: {
    fontSize: 10,
    fontFamily: "FiraSansCondensed_700Bold",
    color: "#fff",
    letterSpacing: 1,
  },

  // CTA
  ctaSection: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
    gap: 12,
  },
  ctaBtn: {
    backgroundColor: "#18222f",
    paddingTop: 14,
    paddingBottom: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  ctaBtnDisabled: { opacity: 0.4 },
  ctaBtnText: {
    color: "#fc6c14",
    fontSize: 18,
    fontFamily: "FiraSansCondensed_700Bold",
    letterSpacing: 0.5,
  },
  restoreBtn: { alignItems: "center", paddingVertical: 8 },
  restoreBtnText: {
    fontSize: 14,
    fontFamily: "FiraSansCondensed_600SemiBold",
    color: "#5a6472",
  },

  // Legal — Voll
  legalBlock: { gap: 8, paddingHorizontal: 8, marginTop: 4 },
  legalText: {
    fontSize: 12,
    fontFamily: "FiraSansCondensed_400Regular",
    color: "#4a5568",
    textAlign: "center",
    lineHeight: 16,
  },
  legalStrong: {
    color: "#18222f",
    fontFamily: "FiraSansCondensed_600SemiBold",
  },
  legalLinks: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 2,
  },
  legalLink: {
    fontSize: 12,
    fontFamily: "FiraSansCondensed_600SemiBold",
    color: "#18222f",
    textDecorationLine: "underline",
  },
  legalSep: { fontSize: 12, color: "#18222f" },
});
