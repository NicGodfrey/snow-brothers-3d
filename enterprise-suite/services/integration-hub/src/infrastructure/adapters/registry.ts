import { DomainError } from "@enterprise-suite/shared-kernel";
import type { AdapterDescriptor, AdapterKind } from "../../domain/adapter.js";
import type { AdapterDriver, AdapterDriverRegistry } from "../../application/ports.js";
import { CsvFileAdapterDriver } from "./csv-file.js";
import { EmailAdapterDriver } from "./email.js";
import { HttpAdapterDriver } from "./http.js";
import { KafkaAdapterDriver } from "./kafka.js";
import { S3AdapterDriver } from "./s3.js";
import { SftpAdapterDriver } from "./sftp.js";

export class InMemoryAdapterDriverRegistry implements AdapterDriverRegistry {
  private readonly drivers = new Map<AdapterKind, AdapterDriver>();

  register(driver: AdapterDriver): void {
    this.drivers.set(driver.descriptor.kind, driver);
  }

  get(kind: AdapterKind): AdapterDriver {
    const driver = this.drivers.get(kind);
    if (!driver) throw new DomainError(`No adapter driver for kind '${kind}'`, "VALIDATION");
    return driver;
  }

  has(kind: AdapterKind): boolean {
    return this.drivers.has(kind);
  }

  descriptors(): AdapterDescriptor[] {
    return [...this.drivers.values()].map((driver) => driver.descriptor);
  }
}

export interface DefaultDrivers {
  readonly registry: InMemoryAdapterDriverRegistry;
  readonly http: HttpAdapterDriver;
  readonly sftp: SftpAdapterDriver;
  readonly s3: S3AdapterDriver;
  readonly kafka: KafkaAdapterDriver;
  readonly csv: CsvFileAdapterDriver;
  readonly email: EmailAdapterDriver;
}

/** Registry preloaded with every bundled stub driver. */
export function createDefaultDriverRegistry(): DefaultDrivers {
  const registry = new InMemoryAdapterDriverRegistry();
  const http = new HttpAdapterDriver();
  const sftp = new SftpAdapterDriver();
  const s3 = new S3AdapterDriver();
  const kafka = new KafkaAdapterDriver();
  const csv = new CsvFileAdapterDriver();
  const email = new EmailAdapterDriver();
  for (const driver of [http, sftp, s3, kafka, csv, email]) registry.register(driver);
  return { registry, http, sftp, s3, kafka, csv, email };
}
