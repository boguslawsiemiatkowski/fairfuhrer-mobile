// Gemeinsame Standort-Helfer für Karte (useTabGpsCenter) und Liste
// (useGpsSort). Beide Hooks hatten dieselbe Aufgabe und dieselbe Falle —
// der Timeout lag aber nur in einem von beiden.

import type { SeverityLevel } from "@sentry/react-native";

const POSITION_TIMEOUT_MS = 10000;

/**
 * Eigener Fehlertyp, damit die Aufrufer den Timeout von echten Fehlern
 * unterscheiden können, ohne auf den Meldungstext zu prüfen.
 */
export class PositionTimeoutError extends Error {
  constructor() {
    super(`getCurrentPositionAsync timeout (${POSITION_TIMEOUT_MS / 1000}s)`);
    this.name = "PositionTimeoutError";
  }
}

/**
 * getCurrentPositionAsync kann endlos hängen, wenn das Gerät keinen Fix
 * bekommt. Ohne Timeout bleibt der aufrufende Hook dauerhaft "in flight"
 * und versucht es nie wieder — bis die App neu gestartet wird.
 *
 * Der Timer wird auch im Erfolgsfall aufgeräumt, sonst bliebe bei jedem
 * Tab-Wechsel ein hängendes setTimeout zurück.
 */
export function withPositionTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PositionTimeoutError()), POSITION_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Meldeschwere für Standortfehler.
 *
 * Ein ausbleibender GPS-Fix ist keine Störung der App: er passiert in
 * Gebäuden, bei abgeschalteter Ortung, im Emulator und auf den Testgeräten
 * von Google Play, die nie einen Fix bekommen. Solche Ereignisse als `error`
 * zu melden lässt die Issue-Liste nach Ausfall aussehen, wo keiner ist —
 * beim Durchsehen am 2026-11-25 war das der häufigste Eintrag überhaupt.
 *
 * `warning` behält den diagnostischen Wert, ohne Alarm auszulösen.
 */
export function locationErrorLevel(err: unknown): SeverityLevel {
  if (err instanceof PositionTimeoutError) return "warning";

  // expo-location meldet abgeschaltete Ortungsdienste bzw. fehlende
  // Systemeinstellungen über diese Texte — ebenfalls Gerätezustand,
  // nicht Fehlverhalten der App.
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (
    /unsatisfied device settings|location services are disabled|location provider/i.test(message)
  ) {
    return "warning";
  }

  return "error";
}
