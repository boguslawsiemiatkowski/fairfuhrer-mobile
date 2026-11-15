import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useProfileSettings } from "@/hooks/useProfileSettings";
import PasswordInput from "@/components/PasswordInput";

export default function EinstellungenSection({
  user,
  profile,
  signOut,
  deleteAccount,
  refreshProfile,
}: any) {
  const { emailForm, passwordForm, handleDeleteAccount } = useProfileSettings(
    user,
    profile,
    refreshProfile,
    deleteAccount,
  );

  // Nutzer, die sich nur über Google angemeldet haben, besitzen noch kein
  // Passwort – für sie heißt die Aktion "festlegen", nicht "ändern".
  const providers: string[] = user?.app_metadata?.providers ?? [];
  const hasPassword = providers.includes("email");
  const passwordTitle = hasPassword ? "Passwort ändern" : "Passwort festlegen";

  return (
    <View style={s.section}>
      <View style={s.card}>
        <Text style={s.sectionTitle}>E-Mail-Adresse ändern</Text>
        <Text style={s.sectionHint}>Aktuelle Adresse: {user?.email}</Text>
        {emailForm.emailError && <Text style={s.errorText}>{emailForm.emailError}</Text>}
        {emailForm.emailSuccess && (
          <Text style={s.successMsg}>Bestätigungslink wurde an Ihre neue Adresse gesendet.</Text>
        )}
        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Neue E-Mail-Adresse</Text>
          <TextInput
            style={s.input}
            value={emailForm.newEmail}
            onChangeText={emailForm.setNewEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
        </View>
        <TouchableOpacity
          style={[s.button, emailForm.emailLoading && s.buttonDisabled]}
          onPress={emailForm.handleEmailChange}
          disabled={emailForm.emailLoading}
        >
          {emailForm.emailLoading ? (
            <ActivityIndicator color="#fc6c14" />
          ) : (
            <Text style={s.buttonText}>Ändern</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={s.card}>
        <Text style={s.sectionTitle}>{passwordTitle}</Text>
        {!hasPassword && (
          <Text style={s.sectionHint}>
            Du hast dich mit Google angemeldet. Lege optional ein Passwort fest, um dich zusätzlich
            mit E-Mail und Passwort anmelden zu können.
          </Text>
        )}
        {passwordForm.pwError && <Text style={s.errorText}>{passwordForm.pwError}</Text>}
        {passwordForm.pwSuccess && (
          <Text style={s.successMsg}>
            {hasPassword ? "Passwort erfolgreich geändert." : "Passwort erfolgreich festgelegt."}
          </Text>
        )}
        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Neues Passwort</Text>
          <PasswordInput
            style={s.input}
            value={passwordForm.newPassword}
            onChangeText={passwordForm.setNewPassword}
            autoComplete="new-password"
          />
        </View>
        <View style={s.fieldGroup}>
          <Text style={s.fieldLabel}>Passwort bestätigen</Text>
          <PasswordInput
            style={s.input}
            value={passwordForm.confirmPassword}
            onChangeText={passwordForm.setConfirmPassword}
            autoComplete="new-password"
          />
        </View>
        <TouchableOpacity
          style={[s.button, passwordForm.pwLoading && s.buttonDisabled]}
          onPress={passwordForm.handlePasswordChange}
          disabled={passwordForm.pwLoading}
        >
          {passwordForm.pwLoading ? (
            <ActivityIndicator color="#fc6c14" />
          ) : (
            <Text style={s.buttonText}>
              {hasPassword ? "Passwort aktualisieren" : "Passwort festlegen"}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={s.cardDanger}>
        <Text style={s.sectionTitleDanger}>Konto löschen</Text>
        <Text style={s.sectionHint}>
          Diese Aktion ist unwiderruflich. Alle Ihre Daten werden dauerhaft gelöscht.
        </Text>
        <TouchableOpacity style={s.buttonDanger} onPress={handleDeleteAccount}>
          <Text style={s.buttonDangerText}>Konto unwiderruflich löschen</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  section: { gap: 16 },
  card: {
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderRadius: 8,
    padding: 18,
    gap: 12,
  },
  cardDanger: {
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: "#c0392b",
    borderRadius: 8,
    padding: 18,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: "FiraSansCondensed_700Bold",
    color: "#18222f",
    letterSpacing: 0.3,
  },
  sectionTitleDanger: {
    fontSize: 16,
    fontFamily: "FiraSansCondensed_700Bold",
    color: "#c0392b",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  sectionHint: {
    fontSize: 15,
    color: "#4a5568",
    fontFamily: "FiraSansCondensed_400Regular",
    lineHeight: 20,
  },
  errorText: {
    color: "#c0392b",
    fontSize: 13,
    backgroundColor: "#fff0ee",
    borderWidth: 1.5,
    borderColor: "#c0392b",
    padding: 10,
    borderRadius: 8,
    width: "100%",
    fontFamily: "FiraSansCondensed_400Regular",
  },
  successMsg: {
    fontSize: 13,
    color: "#2D6A4F",
    backgroundColor: "#f0faf5",
    borderWidth: 1.5,
    borderColor: "#2D6A4F",
    padding: 10,
    borderRadius: 8,
    fontFamily: "FiraSansCondensed_400Regular",
  },
  fieldGroup: { width: "100%", gap: 6 },
  fieldLabel: {
    fontSize: 11,
    fontFamily: "FiraSansCondensed_700Bold",
    color: "#18222f",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    paddingLeft: 2,
  },
  input: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: "#18222f",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#18222f",
    backgroundColor: "#f8f8ff",
    fontFamily: "FiraSansCondensed_400Regular",
  },
  button: {
    width: "100%",
    backgroundColor: "#18222f",
    paddingTop: 12,
    paddingBottom: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: {
    color: "#fc6c14",
    fontSize: 18,
    fontFamily: "FiraSansCondensed_700Bold",
    letterSpacing: 0.5,
  },
  buttonDanger: {
    width: "100%",
    borderWidth: 1.5,
    borderColor: "#18222f",
    backgroundColor: "#c0392b",
    paddingVertical: 13,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonDangerText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "FiraSansCondensed_700Bold",
    letterSpacing: 0.4,
  },
});
