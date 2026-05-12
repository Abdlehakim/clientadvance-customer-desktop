const DEFAULT_PASSWORD_ITERATIONS = 120000;

function requireCrypto() {
  const cryptoApi = globalThis.crypto;

  if (!cryptoApi?.subtle) {
    throw new Error("Le navigateur ne prend pas en charge le hashage local sécurisé.");
  }

  return cryptoApi;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export function getOfflinePasswordIterations() {
  return DEFAULT_PASSWORD_ITERATIONS;
}

export function generateOfflinePasswordSalt() {
  const cryptoApi = requireCrypto();
  const salt = new Uint8Array(16);
  cryptoApi.getRandomValues(salt);
  return toBase64(salt);
}

export async function hashOfflinePassword(
  password: string,
  salt: string,
  iterations = DEFAULT_PASSWORD_ITERATIONS,
) {
  const cryptoApi = requireCrypto();
  const keyMaterial = await cryptoApi.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await cryptoApi.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: fromBase64(salt),
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  return toBase64(new Uint8Array(bits));
}
