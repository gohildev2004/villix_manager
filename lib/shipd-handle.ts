export function normalizeShipdHandle(value: unknown) {
  const raw = String(value ?? "").trim();
  const handle = raw.startsWith("@") ? raw : `@${raw}`;
  if (!/^@[A-Za-z0-9_.-]{2,64}$/.test(handle)) {
    throw new Error("Enter the Shipd.ai username you use or plan to use (2–64 letters, numbers, dots, dashes, or underscores).");
  }
  return handle;
}
