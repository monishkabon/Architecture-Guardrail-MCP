/**
 * Sample source file in mock repository fixture.
 */

export interface SampleRecord {
  id: string;
  name: string;
  active: boolean;
}

export function parseSampleRecord(raw: unknown): SampleRecord {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid sample record");
  }
  const record = raw as Record<string, unknown>;
  return {
    id: String(record.id ?? ""),
    name: String(record.name ?? ""),
    active: Boolean(record.active),
  };
}
