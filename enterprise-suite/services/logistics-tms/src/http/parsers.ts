import type { PackageInput } from "../domain/shipment.js";
import type { Address, Dimensions } from "../domain/values.js";
import {
  expectObject,
  optNumber,
  optString,
  reqNumber,
  reqString,
} from "./validate.js";

/** Shape-level parsing of shared payload fragments (addresses, packages). */

export function parseAddress(raw: unknown, label: string): Address {
  const obj = expectObject(raw, label);
  return {
    name: reqString(obj, "name"),
    line1: reqString(obj, "line1"),
    line2: optString(obj, "line2"),
    city: reqString(obj, "city"),
    region: optString(obj, "region"),
    postalCode: reqString(obj, "postalCode"),
    country: reqString(obj, "country"),
  };
}

export function parseDimensions(raw: unknown, label: string): Dimensions {
  const obj = expectObject(raw, label);
  return {
    lengthCm: reqNumber(obj, "lengthCm"),
    widthCm: reqNumber(obj, "widthCm"),
    heightCm: reqNumber(obj, "heightCm"),
  };
}

export function parsePackage(raw: unknown, label: string): PackageInput {
  const obj = expectObject(raw, label);
  return {
    reference: optString(obj, "reference"),
    weightKg: reqNumber(obj, "weightKg"),
    dimensions: parseDimensions(obj.dimensions, `${label}.dimensions`),
    declaredValueMinor: optNumber(obj, "declaredValueMinor"),
  };
}
