import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import {
  acceptRfc,
  createGovernanceRfcDraft,
  listRfcs,
  loadRfcStatus,
  renumberDraftRfc,
  resolveAcceptedRfcSlice,
  validateRfc,
  type RfcStatusSnapshot,
} from "../lib/rfc.js";

export function createRfcCommand(): Command {
  const command = new Command("rfc").description("Manage human-authored RFC governance records");
  command.addCommand(createRfcNewCommand());
  command.addCommand(createRfcValidateCommand());
  command.addCommand(createRfcStatusCommand());
  command.addCommand(createRfcRenumberCommand());
  command.addCommand(createRfcAcceptCommand());
  return command;
}

function createRfcNewCommand(): Command {
  return new Command("new")
    .description("Create an RFC draft in an isolated governance worktree")
    .argument("<slug>", "Semantic kebab-case RFC slug")
    .option("--amends <RFC-ID>", "Create an amendment of an accepted RFC")
    .action((slug: string, options: { amends?: string }) => {
      runRfcAction(() => {
        const created = createGovernanceRfcDraft({
          projectDir: process.cwd(),
          slug,
          amends: options.amends,
        });
        console.log(`Created ${created.rfc.metadata.id}`);
        console.log(`Worktree: ${created.worktree}`);
        console.log(`Branch: ${created.branch}`);
        console.log(`Document: ${created.rfc.documentPath}`);
        console.log("Complete the RFC, then run `corgispec rfc validate <RFC-ID>`.");
      });
    });
}

function createRfcValidateCommand(): Command {
  return new Command("validate")
    .description("Validate an RFC and its delivery sidecar")
    .argument("<RFC-ID>")
    .option("--json", "Print machine-readable validation output")
    .action((rfcId: string, options: { json?: boolean }) => {
      const result = validateRfc(process.cwd(), rfcId);
      if (options.json) {
        console.log(JSON.stringify({ valid: result.valid, issues: result.issues }, null, 2));
      } else if (result.valid) {
        console.log(`${rfcId}: valid`);
      } else {
        console.error(`${rfcId}: invalid`);
        for (const issue of result.issues) console.error(`- [${issue.code}] ${issue.message}`);
      }
      if (!result.valid) process.exitCode = 1;
    });
}

function createRfcStatusCommand(): Command {
  return new Command("status")
    .description("Show RFC governance and delivery state")
    .argument("[RFC-ID]")
    .option("--json", "Print machine-readable status output")
    .action((rfcId: string | undefined, options: { json?: boolean }) => {
      runRfcAction(() => {
        const ids = rfcId ? [rfcId] : listRfcs(process.cwd());
        const statuses = ids.map((id) => rfcStatus(loadRfcStatus(process.cwd(), id)));
        if (options.json) {
          console.log(JSON.stringify(statuses, null, 2));
        } else if (statuses.length === 0) {
          console.log("No RFCs found");
        } else {
          for (const status of statuses) {
            console.log(`${status.id}\t${status.status}\t${status.effectiveness}\t${status.slices} Slice(s)`);
          }
        }
      });
    });
}

function createRfcRenumberCommand(): Command {
  return new Command("renumber")
    .description("Resolve a draft RFC number collision using the next available number")
    .argument("<draft-RFC-ID>")
    .requiredOption("--next", "Use the next available RFC number")
    .action((rfcId: string) => {
      runRfcAction(() => {
        const renamed = renumberDraftRfc(process.cwd(), rfcId);
        console.log(`Renumbered ${rfcId} to ${renamed.metadata.id}`);
      });
    });
}

function createRfcAcceptCommand(): Command {
  return new Command("accept")
    .description("Record an explicit human RFC approval")
    .argument("<RFC-ID>")
    .requiredOption("--approver <human-id>", "Human reviewer identity")
    .action(async (rfcId: string, options: { approver: string }) => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error("RFC acceptance requires an interactive terminal and cannot be delegated to an Agent.");
        process.exitCode = 1;
        return;
      }
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const confirmation = await rl.question(`Type ${rfcId} to accept this RFC: `);
      rl.close();
      if (confirmation.trim() !== rfcId) {
        console.error("RFC acceptance cancelled.");
        process.exitCode = 1;
        return;
      }
      runRfcAction(() => {
        const accepted = acceptRfc({
          projectDir: process.cwd(),
          rfcId,
          approver: options.approver,
          humanConfirmed: true,
        });
        console.log(`Accepted ${accepted.metadata.id} at digest ${accepted.digest}`);
        console.log("Commit and merge the accepted RFC into the configured integration branch before Propose.");
      });
    });
}

function rfcStatus(snapshot: RfcStatusSnapshot): Record<string, unknown> {
  const { rfc } = snapshot;
  let effectiveness = rfc.metadata.status === "accepted" ? "accepted-local" : "not-effective";
  if (rfc.metadata.status === "accepted" && rfc.slices[0]) {
    try {
      resolveAcceptedRfcSlice({
        projectDir: rfc.projectDir,
        rfcId: rfc.metadata.id,
        sliceId: rfc.slices[0].id,
      });
      effectiveness = "effective";
    } catch {
      // Local acceptance is intentionally distinct from merged/effective.
    }
  }
  return {
    id: rfc.metadata.id,
    type: rfc.metadata.type,
    status: rfc.metadata.status,
    effectiveness,
    digest: rfc.digest,
    slices: rfc.slices.length,
    valid: snapshot.validation.valid,
    issues: snapshot.validation.issues,
    deliveryRevision: snapshot.delivery.revision,
  };
}

function runRfcAction(action: () => void): void {
  try {
    action();
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
