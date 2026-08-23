import type { SmtpProviderType } from "@/domain/types";

const GMAIL_AUTH_MESSAGE =
  "Connexion Gmail refusée. Vérifiez l’adresse Gmail et utilisez un mot de passe d’application valide.";
const SMTP_AUTH_MESSAGE =
  "Identifiants SMTP incorrects. Vérifiez l’adresse email et le mot de passe SMTP.";
const SMTP_CONFIGURATION_MESSAGE =
  "Les paramètres email sont incomplets ou invalides. Vérifiez la configuration SMTP.";
const SMTP_CONNECTION_MESSAGE =
  "Impossible de se connecter au serveur email. Vérifiez votre connexion Internet et les paramètres SMTP.";
const SMTP_HOST_MESSAGE =
  "Serveur email introuvable. Vérifiez l’adresse du serveur SMTP.";
const SMTP_SECURITY_MESSAGE =
  "Connexion sécurisée au serveur email impossible. Vérifiez les paramètres de sécurité SMTP.";
const SMTP_RECIPIENT_MESSAGE =
  "Adresse email invalide ou refusée. Vérifiez le destinataire.";
const SMTP_TEMPORARY_MESSAGE =
  "Le serveur email refuse temporairement l’envoi. Réessayez dans quelques minutes.";
const SMTP_SENDER_MESSAGE =
  "L’adresse email d’envoi a été refusée. Vérifiez l’adresse d’expéditeur dans les paramètres SMTP.";
const SMTP_FALLBACK_MESSAGE =
  "L’envoi de l’email a échoué. Vérifiez les paramètres email puis réessayez.";
const DESKTOP_EMAIL_UNAVAILABLE_MESSAGE =
  "Email direct depuis l'application indisponible hors application desktop.";

const FRIENDLY_MESSAGES = new Set([
  GMAIL_AUTH_MESSAGE,
  SMTP_AUTH_MESSAGE,
  SMTP_CONFIGURATION_MESSAGE,
  SMTP_CONNECTION_MESSAGE,
  SMTP_HOST_MESSAGE,
  SMTP_SECURITY_MESSAGE,
  SMTP_RECIPIENT_MESSAGE,
  SMTP_TEMPORARY_MESSAGE,
  SMTP_SENDER_MESSAGE,
  SMTP_FALLBACK_MESSAGE,
  DESKTOP_EMAIL_UNAVAILABLE_MESSAGE,
]);

function readErrorMessage(errorOrMessage: unknown) {
  if (
    errorOrMessage instanceof Error &&
    errorOrMessage.message.trim().length > 0
  ) {
    return errorOrMessage.message.trim();
  }

  if (
    typeof errorOrMessage === "string" &&
    errorOrMessage.trim().length > 0
  ) {
    return errorOrMessage.trim();
  }

  if (typeof errorOrMessage === "object" && errorOrMessage !== null) {
    const maybeMessage = Reflect.get(errorOrMessage, "message");

    if (
      typeof maybeMessage === "string" &&
      maybeMessage.trim().length > 0
    ) {
      return maybeMessage.trim();
    }
  }

  return "";
}

export function getFriendlySmtpErrorMessage(
  errorOrMessage: unknown,
  providerType?: SmtpProviderType,
): string {
  const message = readErrorMessage(errorOrMessage);

  if (FRIENDLY_MESSAGES.has(message)) {
    return message;
  }

  const normalizedMessage = message.toLowerCase();

  if (
    /payload smtp invalide|champs? manquants?|h[oô]te smtp manquant|port smtp invalide|adresse email manquante|param[eè]tres smtp manquants|mot de passe smtp manquant|invalid input/i.test(
      normalizedMessage,
    )
  ) {
    return SMTP_CONFIGURATION_MESSAGE;
  }

  const authenticationFailure =
    /\bauth\b|authentication|credential|credentials|password|username|login failed|authentication failed|authentication unsuccessful|\b535\b/i.test(
      normalizedMessage,
    );
  const obviousGmailAuthenticationFailure =
    /\b535\b|5\.7\.8|badcredentials|username and password not accepted|support\.google\.com|gsmtp/i.test(
      normalizedMessage,
    );

  if (
    (providerType === "gmail" && authenticationFailure) ||
    (providerType === undefined && obviousGmailAuthenticationFailure)
  ) {
    return GMAIL_AUTH_MESSAGE;
  }

  if (
    /dns|getaddrinfo|name or service not known|host not found|hostname|failed to lookup|could not resolve|nodename nor servname/i.test(
      normalizedMessage,
    )
  ) {
    return SMTP_HOST_MESSAGE;
  }

  if (
    /tls|ssl|starttls|certificate|certificate verify|handshake|secure connection/i.test(
      normalizedMessage,
    )
  ) {
    return SMTP_SECURITY_MESSAGE;
  }

  if (
    /5\.1\.1|recipient address rejected|recipient rejected|invalid recipient|user unknown|mailbox unavailable|no such user|address not found/i.test(
      normalizedMessage,
    )
  ) {
    return SMTP_RECIPIENT_MESSAGE;
  }

  if (
    /sender rejected|sender address rejected|from address rejected|invalid sender|mail from rejected/i.test(
      normalizedMessage,
    )
  ) {
    return SMTP_SENDER_MESSAGE;
  }

  if (
    /\b421\b|\b450\b|\b451\b|\b452\b|4\.7\.|temporarily|temporary failure|try again later|too many|rate limit|rate-limit|throttled/i.test(
      normalizedMessage,
    )
  ) {
    return SMTP_TEMPORARY_MESSAGE;
  }

  if (
    /connection refused|could not connect|connection failed|network is unreachable|network unreachable|timed out|timeout|connection reset|broken pipe|socket error|server unavailable|serveur indisponible/i.test(
      normalizedMessage,
    )
  ) {
    return SMTP_CONNECTION_MESSAGE;
  }

  if (authenticationFailure) {
    return SMTP_AUTH_MESSAGE;
  }

  return SMTP_FALLBACK_MESSAGE;
}
