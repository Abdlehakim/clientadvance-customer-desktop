export const TUNISIA_COUNTRY_CODE = "+216";
export const TUNISIAN_LOCAL_PHONE_LENGTH = 8;
export const TUNISIAN_PHONE_VALIDATION_MESSAGE =
  "Num\u00e9ro de t\u00e9l\u00e9phone invalide. Saisissez un num\u00e9ro tunisien \u00e0 8 chiffres.";

function digitsOnly(value: string) {
  return value.replace(/\D+/g, "");
}

export function getTunisianLocalPhone(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "";
  }

  const digits = digitsOnly(trimmedValue);

  if (!digits) {
    return "";
  }

  if (digits.startsWith("00216")) {
    return digits.slice(5);
  }

  if (trimmedValue.startsWith(TUNISIA_COUNTRY_CODE) && digits.startsWith("216")) {
    return digits.slice(3);
  }

  if (digits.startsWith("216") && digits.length > TUNISIAN_LOCAL_PHONE_LENGTH) {
    return digits.slice(3);
  }

  return digits;
}

export function isValidTunisianPhone(value: string) {
  return /^\d{8}$/.test(getTunisianLocalPhone(value));
}

export function normalizeTunisianPhone(value: string) {
  const localPhone = getTunisianLocalPhone(value);
  return /^\d{8}$/.test(localPhone) ? `${TUNISIA_COUNTRY_CODE}${localPhone}` : "";
}

export function normalizeStoredTunisianPhone(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "";
  }

  return normalizeTunisianPhone(trimmedValue) || trimmedValue;
}

export function formatTunisianLocalPhone(value: string) {
  const localPhone = getTunisianLocalPhone(value).slice(0, TUNISIAN_LOCAL_PHONE_LENGTH);

  if (localPhone.length <= 2) {
    return localPhone;
  }

  if (localPhone.length <= 5) {
    return `${localPhone.slice(0, 2)} ${localPhone.slice(2)}`;
  }

  return `${localPhone.slice(0, 2)} ${localPhone.slice(2, 5)} ${localPhone.slice(5)}`;
}

export function formatTunisianPhoneForDisplay(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return "";
  }

  const normalizedPhone = normalizeTunisianPhone(trimmedValue);

  if (!normalizedPhone) {
    return trimmedValue;
  }

  return `${TUNISIA_COUNTRY_CODE} ${formatTunisianLocalPhone(normalizedPhone)}`;
}
