import { invokeTauriCommand, isTauriRuntime } from "./sqliteClient";
import {
  isMaskedSmtpPasswordValue,
  normalizeSmtpPasswordValue,
} from "@/infrastructure/local/adminSettingsState";

export interface DesktopEmailRequest {
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
  fromEmail: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
}

function normalizeDesktopEmailRequest(request: DesktopEmailRequest): DesktopEmailRequest {
  return {
    host: typeof request.host === "string" ? request.host.trim() : "",
    port: typeof request.port === "number" ? request.port : Number.NaN,
    username: typeof request.username === "string" ? request.username.trim() : "",
    password: typeof request.password === "string" ? request.password : "",
    secure: request.secure,
    fromEmail: typeof request.fromEmail === "string" ? request.fromEmail.trim() : "",
    fromName: typeof request.fromName === "string" ? request.fromName.trim() : "",
    to: typeof request.to === "string" ? request.to.trim() : "",
    subject: typeof request.subject === "string" ? request.subject : "",
    body: typeof request.body === "string" ? request.body : "",
  };
}

function describeInvalidDesktopEmailRequest(request: DesktopEmailRequest) {
  const invalidFields: string[] = [];

  if (request.host.length === 0) {
    invalidFields.push("host");
  }

  if (!Number.isInteger(request.port) || request.port <= 0 || request.port > 65535) {
    invalidFields.push("port");
  }

  if (request.username.length === 0) {
    invalidFields.push("username");
  }

  if (
    normalizeSmtpPasswordValue(request.password).length === 0 ||
    isMaskedSmtpPasswordValue(request.password)
  ) {
    invalidFields.push("password");
  }

  if (typeof request.secure !== "boolean") {
    invalidFields.push("secure");
  }

  if (request.fromEmail.length === 0) {
    invalidFields.push("fromEmail");
  }

  if (request.to.length === 0) {
    invalidFields.push("to");
  }

  return invalidFields;
}

export async function sendDesktopEmail(request: DesktopEmailRequest) {
  if (!isTauriRuntime()) {
    throw new Error("Envoi email direct indisponible hors application desktop.");
  }

  const normalizedRequest = normalizeDesktopEmailRequest(request);
  const invalidFields = describeInvalidDesktopEmailRequest(normalizedRequest);

  if (invalidFields.length > 0) {
    throw new Error(
      `Payload SMTP invalide : champs manquants ou invalides : ${invalidFields.join(", ")}.`,
    );
  }

  try {
    await invokeTauriCommand<void>("send_smtp_email", {
      host: normalizedRequest.host,
      port: normalizedRequest.port,
      username: normalizedRequest.username,
      password: normalizedRequest.password,
      secure: normalizedRequest.secure,
      fromEmail: normalizedRequest.fromEmail,
      fromName: normalizedRequest.fromName,
      to: normalizedRequest.to,
      subject: normalizedRequest.subject,
      body: normalizedRequest.body,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid input";

    if (/^invalid input$/i.test(message.trim())) {
      throw new Error(
        "Payload SMTP invalide : champs manquants ou invalides : host, port, username, password, secure, fromEmail, to.",
      );
    }

    throw error;
  }
}
