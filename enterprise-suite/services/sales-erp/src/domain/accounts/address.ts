export interface Address {
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly region?: string;
  readonly postalCode: string;
  readonly countryCode: string;
}

export function formatAddress(a: Address): string {
  return [a.line1, a.line2, `${a.postalCode} ${a.city}`, a.region, a.countryCode]
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
    .join(", ");
}
