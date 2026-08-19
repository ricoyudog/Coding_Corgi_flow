import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  ChangeContractError,
  computeDeliveryBindingDigest,
  digestValue,
  type LoadedChangeContract,
  type MaintenanceSource,
  type RfcSliceSource,
  type TrackerBinding,
} from "./change-contract.js";
import { loadConfigFromDir, resolveTrackingProvider } from "./config.js";
import { classifyMaintenance } from "./maintenance.js";
import {
  assertFoundationAccepted,
  loadRfc,
  loadRfcDelivery,
  resolveAcceptedRfcSlice,
  type RfcDeliveryBinding,
} from "./rfc.js";
import {
  featureIssueMarker,
  maintenanceIssueMarker,
  repositoryIdentity,
} from "./tracker.js";

export interface ContractProvenanceOptions {
  /** Propose validates the prospective binding before its final delivery CAS. */
  allowUnboundDelivery?: boolean;
}

export function validateMaintenanceContractReferences(
  projectDir: string,
  contractRefs: readonly string[],
): ChangeContractError[] {
  const failures: ChangeContractError[] = [];
  const root = resolve(projectDir);
  for (const reference of [...new Set(contractRefs.map((value) => value.trim()))]) {
    const rfcMatch = /^(RFC-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*)\/(AC-\d{3})$/u.exec(reference);
    if (rfcMatch) {
      try {
        const [, rfcId, criterionId] = rfcMatch;
        const source = loadRfc(root, rfcId!);
        const sourceSlice = source.slices.find((slice) =>
          slice.acceptanceCriteria.some((criterion) => criterion.id === criterionId)
        );
        if (!sourceSlice) throw new Error(`RFC '${rfcId}' does not contain '${criterionId}'`);
        const effective = resolveAcceptedRfcSlice({
          projectDir: root,
          rfcId: rfcId!,
          sliceId: sourceSlice.id,
        });
        if (!effective.slice.acceptanceCriteria.some((criterion) => criterion.id === criterionId)) {
          throw new Error(`Effective RFC '${effective.rfc.metadata.id}' no longer contains '${criterionId}'`);
        }
      } catch (error) {
        failures.push(failure(
          "MAINTENANCE_CONTRACT_REFERENCE_INVALID",
          error instanceof Error ? error.message : String(error),
          reference,
        ));
      }
      continue;
    }

    const specMatch = /^spec:([^#]+)(?:#(.+))?$/u.exec(reference);
    if (specMatch) {
      const path = specMatch[1]!.replace(/\\/gu, "/").replace(/^\.\//u, "");
      const anchor = specMatch[2]?.trim();
      const absolute = resolve(root, path);
      const lexical = relative(root, absolute).replace(/\\/gu, "/");
      if (
        !path.startsWith("openspec/specs/")
        || isAbsolute(path)
        || lexical === ".."
        || lexical.startsWith("../")
        || !existsSync(absolute)
        || !lstatSync(absolute).isFile()
        || lstatSync(absolute).isSymbolicLink()
        || (anchor && !readFileSync(absolute, "utf8").includes(anchor))
      ) {
        failures.push(failure(
          "MAINTENANCE_CONTRACT_REFERENCE_INVALID",
          `Canonical spec reference '${reference}' does not resolve to a regular file${anchor ? " containing its anchor" : ""}`,
          reference,
        ));
      }
      continue;
    }
    failures.push(failure(
      "MAINTENANCE_CONTRACT_REFERENCE_INVALID",
      `Contract reference '${reference}' must be RFC-ID/AC-ID or spec:openspec/specs/<path>[#anchor]`,
      reference,
    ));
  }
  return failures;
}

/** Re-resolve mutable repository state instead of trusting source.yaml alone. */
export function validateContractProvenance(
  projectDir: string,
  changeName: string,
  contract: LoadedChangeContract,
  options: ContractProvenanceOptions = {},
): ChangeContractError[] {
  const failures: ChangeContractError[] = [];
  const configuredProvider = resolveTrackingProvider(loadConfigFromDir(projectDir)).provider;
  if (configuredProvider !== contract.source.tracker.provider) {
    failures.push(failure(
      "TRACKER_BINDING_DRIFT",
      `source tracker '${contract.source.tracker.provider}' does not match configured provider '${configuredProvider}'`,
      contract.sourcePath,
    ));
  }

  try {
    if (contract.source.kind === "maintenance") {
      assertFoundationAccepted(projectDir);
      validateMaintenanceProvenance(
        projectDir,
        changeName,
        contract.source,
        contract.sourcePath,
        failures,
      );
      return failures;
    }
    const effective = resolveAcceptedRfcSlice({
      projectDir,
      rfcId: contract.source.rfc.id,
      sliceId: contract.source.slice.id,
    });
    const expectedDeliveryRef = `${effective.rfc.metadata.id}/${effective.slice.id}`;
    if (contract.source.deliveryRef !== expectedDeliveryRef) {
      failures.push(failure("RFC_DELIVERY_REF_DRIFT", `deliveryRef must be '${expectedDeliveryRef}'`, contract.sourcePath));
    }
    const expectedRfcPath = relative(projectDir, effective.rfc.directory).replace(/\\/gu, "/");
    if (contract.source.rfc.path !== expectedRfcPath) {
      failures.push(failure("RFC_PATH_DRIFT", `RFC path must be '${expectedRfcPath}'`, contract.sourcePath));
    }
    const expectedRfcDigest = `sha256:${effective.rfc.digest}`;
    if (contract.source.rfc.digest !== expectedRfcDigest) {
      failures.push(failure("RFC_DIGEST_DRIFT", "accepted RFC digest differs from source.yaml", contract.sourcePath));
    }
    if (contract.source.rfc.acceptedCommit !== effective.acceptedCommit) {
      failures.push(failure("RFC_ACCEPTED_COMMIT_DRIFT", "accepted RFC commit differs from source.yaml", contract.sourcePath));
    }
    if (contract.source.slice.digest !== digestValue(effective.slice)) {
      failures.push(failure("RFC_SLICE_DIGEST_DRIFT", "RFC Slice digest differs from source.yaml", contract.sourcePath));
    }
    const expectedAcceptance = effective.slice.acceptanceCriteria.map((criterion) => ({
      id: criterion.id,
      evidence: criterion.evidence,
    }));
    if (digestValue(contract.source.acceptance) !== digestValue(expectedAcceptance)) {
      failures.push(failure("RFC_ACCEPTANCE_DRIFT", "RFC Slice AC membership or evidence differs from source.yaml", contract.sourcePath));
    }
    const marker = featureIssueMarker({
      repository: repositoryIdentity(projectDir),
      deliveryRef: expectedDeliveryRef,
      rfcDigest: effective.rfc.digest,
    });
    if (contract.source.tracker.idempotencyKey !== marker.key) {
      failures.push(failure("TRACKER_MARKER_DRIFT", "Feature Issue marker differs from accepted RFC provenance", contract.sourcePath));
    }

    const delivery = loadRfcDelivery(projectDir, effective.rfc.metadata.id);
    const selected = delivery.slices[effective.slice.id];
    if (!selected) {
      failures.push(failure(
        "RFC_DELIVERY_SLICE_MISSING",
        "delivery.yaml does not contain the accepted RFC Slice",
        effective.rfc.deliveryPath,
      ));
      validateDeliveryDigest(
        contract.source.deliveryBindingDigest,
        effective.rfc.metadata.id,
        effective.slice.id,
        changeName,
        trackerIssue(contract.source.tracker),
        contract.sourcePath,
        failures,
      );
    } else if (!selected.binding || selected.status === "unbound") {
      if (!options.allowUnboundDelivery) {
        failures.push(failure("RFC_SLICE_UNBOUND", "RFC Slice is not bound in delivery.yaml", effective.rfc.deliveryPath));
      }
      validateDeliveryDigest(
        contract.source.deliveryBindingDigest,
        effective.rfc.metadata.id,
        effective.slice.id,
        changeName,
        trackerIssue(contract.source.tracker),
        contract.sourcePath,
        failures,
      );
    } else {
      validateBoundDelivery(
        changeName,
        contract.source,
        contract.sourceDigest,
        effective.rfc.metadata.id,
        effective.slice.id,
        selected.binding,
        effective.rfc.deliveryPath,
        failures,
      );
    }
  } catch (error) {
    failures.push(failure(
      error && typeof error === "object" && "code" in error ? String(error.code) : "RFC_PROVENANCE_INVALID",
      error instanceof Error ? error.message : String(error),
      contract.sourcePath,
    ));
  }
  return failures;
}

function validateMaintenanceProvenance(
  projectDir: string,
  changeName: string,
  source: MaintenanceSource,
  sourcePath: string,
  failures: ChangeContractError[],
): void {
  failures.push(...validateMaintenanceContractReferences(projectDir, source.maintenance.contractRefs));
  const expectedDeliveryRef = `maintenance/${changeName}`;
  if (source.deliveryRef !== expectedDeliveryRef) {
    failures.push(failure("MAINTENANCE_DELIVERY_REF_DRIFT", `deliveryRef must be '${expectedDeliveryRef}'`, sourcePath));
  }
  const classification = classifyMaintenance(
    source.maintenance.description,
    source.maintenance.contractRefs,
  );
  const expected = {
    category: classification.category,
    reason: classification.reason,
    boundary: classification.boundary,
    acceptance: classification.acceptance,
  };
  const actual = {
    category: source.maintenance.category,
    reason: source.maintenance.reason,
    boundary: source.maintenance.boundary,
    acceptance: source.acceptance,
  };
  if (digestValue(actual) !== digestValue(expected)) {
    failures.push(failure(
      "MAINTENANCE_CLASSIFICATION_DRIFT",
      "maintenance source no longer matches the closed exemption classifier",
      sourcePath,
    ));
  }
  const marker = maintenanceIssueMarker({
    repository: repositoryIdentity(projectDir),
    changeName,
    description: source.maintenance.description,
  });
  if (source.tracker.idempotencyKey !== marker.key) {
    failures.push(failure("TRACKER_MARKER_DRIFT", "Maintenance Issue marker differs from canonical source", sourcePath));
  }
}

function validateBoundDelivery(
  changeName: string,
  source: RfcSliceSource,
  sourceDigest: string,
  rfcId: string,
  sliceId: string,
  binding: RfcDeliveryBinding,
  deliveryPath: string,
  failures: ChangeContractError[],
): void {
  if (binding.change !== changeName) {
    failures.push(failure(
      "RFC_SLICE_CHANGE_DRIFT",
      `RFC Slice is bound to Change '${binding.change}', not '${changeName}'`,
      deliveryPath,
    ));
  }
  if (binding.sourceDigest !== sourceDigest) {
    failures.push(failure("RFC_DELIVERY_SOURCE_DRIFT", "delivery.yaml source digest differs from source.yaml", deliveryPath));
  }
  const expectedIssue = trackerIssue(source.tracker);
  if (digestValue(binding.issue ?? null) !== digestValue(expectedIssue)) {
    failures.push(failure("RFC_DELIVERY_ISSUE_DRIFT", "delivery.yaml Issue binding differs from source.yaml", deliveryPath));
  }
  validateDeliveryDigest(
    source.deliveryBindingDigest,
    rfcId,
    sliceId,
    changeName,
    binding.issue ?? expectedIssue,
    deliveryPath,
    failures,
  );
}

function validateDeliveryDigest(
  actual: string,
  rfcId: string,
  sliceId: string,
  change: string,
  issue: NonNullable<RfcDeliveryBinding["issue"]>,
  path: string,
  failures: ChangeContractError[],
): void {
  const expected = computeDeliveryBindingDigest({ rfcId, sliceId, change, issue });
  if (actual !== expected) {
    failures.push(failure("RFC_DELIVERY_BINDING_DIGEST_DRIFT", "delivery binding digest is not canonical", path));
  }
}

function trackerIssue(tracker: TrackerBinding): NonNullable<RfcDeliveryBinding["issue"]> {
  return {
    provider: tracker.provider,
    ...(tracker.issue ? { id: tracker.issue.id, url: tracker.issue.url } : {}),
  };
}

function failure(code: string, message: string, path: string): ChangeContractError {
  return new ChangeContractError(message, code, [path]);
}
