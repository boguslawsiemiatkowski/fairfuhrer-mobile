import { Alert, Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Sentry from "@sentry/react-native";

function isNativeAppOrMapsUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
    return true; // tel:, mailto:, geo:, itp.
  }
  return (
    lower.includes("maps.apple.com") ||
    lower.includes("google.com/maps") ||
    lower.includes("maps.app.goo.gl")
  );
}

// Linking.openURL odrzuca promise, gdy urzadzenie nie ma aplikacji obslugujacej
// dany schemat (brak klienta poczty, brak dialera) albo gdy URL jest zepsuty —
// np. blednie wpisany adres partnera w bazie. Bez zlapania tego leci
// nieobsluzone odrzucenie promise: uzytkownik nie dostaje zadnej informacji,
// a Sentry zapisuje to jako blad bez kontekstu.
//
// Dla zwyklych stron WWW (partnerzy, certyfikaty) otwieramy wewnetrzna karte
// przegladarki (Safari View Controller / Chrome Custom Tabs) z przyciskiem
// zamkniecia, aby uzytkownik nie opuszczal aplikacji Fairführer.
export async function openExternalUrl(url: string, notAvailableMessage: string): Promise<void> {
  try {
    if (!isNativeAppOrMapsUrl(url)) {
      await WebBrowser.openBrowserAsync(url, {
        toolbarColor: "#18222f",
        controlsColor: "#fc6c14",
        showTitle: true,
      });
      return;
    }
    await Linking.openURL(url);
  } catch (e) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // Fallback też się nie powiódł — raportujemy i pokazujemy komunikat
    }
    Sentry.captureException(e, {
      tags: { feature: "external-link" },
      extra: { url },
    });
    Alert.alert("Link konnte nicht geöffnet werden", notAvailableMessage);
  }
}
