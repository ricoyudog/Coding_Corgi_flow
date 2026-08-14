**English** | [繁體中文](cross-session-memory.zh-TW.md)

# RFC-first Cross-Session Memory

CorgiSpec v4 keeps RFC governance, long-term knowledge, and live delivery state separate:

- RFCs define accepted goals, boundaries, Slices, and acceptance criteria.
- Wiki stores research, verified architecture, reusable patterns, ADRs, guides, questions, and delivery outcomes.
- Memory carries permanent constraints and durable cross-session checkpoints.
- `.corgi/loop` is the only live lifecycle authority.

Memory/Wiki is mandatory. Fresh bootstrap creates it transactionally; v4 migration preserves existing user knowledge.

## Structure

```text
memory/
├── MEMORY.md             permanent source-backed constraints
├── session-bridge.md      durable delivery checkpoint mirror
└── pitfalls.md            verified cross-delivery pitfalls

wiki/
├── hot.md                 compact current project pulse
├── index.md               on-demand navigation
├── schema.md              page contracts and ownership markers
├── architecture/           verified current system
├── research/               evidence and hypotheses
├── patterns/               verified reusable approaches
├── decisions/              ADRs inside accepted RFC scope
├── guides/                 verified operational instructions
├── questions/              human Q&A
├── deliveries/             archived RFC Slice outcomes
└── meta/                   explicit generated reports
```

Existing `wiki/sessions/` and `wiki/log.md` are preserved during migration as legacy read-only data. Fresh projects do not create them, and current workflows never append to them.

## Startup

Every agent reads exactly three files first:

1. `memory/session-bridge.md`
2. `memory/MEMORY.md`
3. `wiki/hot.md`

It then reads the RFC/Slice and Change overlays named by the bridge. `wiki/index.md` is read only when domain knowledge is needed.

SessionStart and PostCompact hooks synthesize current phase, Task Group, run revision, and next action from `.corgi/loop`. A bridge mismatch is reported as drift; the bridge never overrides the Run Contract.

## Write Boundaries

| Location | Accepted writes |
|---|---|
| `MEMORY.md` | Human-accepted permanent constraints or promoted verified knowledge, always with a source |
| `session-bridge.md` | Planning baseline and immediately before a Task Group commit; `corgispec archive --local` writes archive closeout |
| `pitfalls.md` | Verified failure modes with evidence and remediation |
| `architecture/` | Current behavior verified against final source and accepted delivery evidence |
| `research/` | Investigations and unverified findings |
| `deliveries/` | One immutable closeout page per archived RFC Slice |

Only content inside matching `corgi:managed` markers is tool-owned. Human text outside those markers is preserved.

For an RFC Slice closeout, `corgispec archive --local` is the sole writer of archive-derived delivery pages and promoted provenance in `hot`, `architecture`, `patterns`, `MEMORY.md`, `pitfalls.md`, and the archive bridge checkpoint. Skills may prepare a read-only candidate report before that command or verify its result afterward; they must not write a second closeout after the commit is sealed.

## Delivery Closeout

Only a successful `corgispec archive --local` creates `wiki/deliveries/<RFC-ID>-<Slice-ID>.md` and its archive-derived knowledge updates. It contains:

- delivered boundary and outcome;
- every AC and its automated/human evidence;
- Task Group commits and final HEAD;
- human review and Human QA result;
- promoted architecture, patterns, pitfalls, or permanent constraints;
- links to the RFC, archived Change, evidence manifest, and single Issue.

Unverified discoveries remain in Research or the Session Bridge Promotion Queue.

## Ask and Lint

`/corgi-ask` uses early-stop retrieval: the three startup files, then at most two relevant Wiki pages, with five total context files beyond the question. It cites sources and queues knowledge candidates; it never promotes an answer directly into Architecture, Pitfalls, Patterns, Decisions, or MEMORY.

`/corgi-lint` runs 14 checks and is read-only by default. Use `/corgi-lint --report` to persist a report under `wiki/meta/`; lint never auto-fixes project knowledge.

## Size Limits

| File | Target | Hard cap |
|---|---:|---:|
| `wiki/hot.md` | 500 words | 600 words |
| `wiki/index.md` | 40 lines | 80 lines |
| `memory/pitfalls.md` | 10 active | 20 active |
| `memory/session-bridge.md` | 30 lines | 50 lines |

## Setup and Migration

```text
# Fresh project or managed update
corgispec bootstrap

# Explicit v3 → v4 cutover
corgispec bootstrap --migrate-v4

# Source-backed knowledge enrichment after bootstrap
/corgi-migrate

# Read-only health check
/corgi-lint
```

Migration never auto-accepts an RFC. Existing documents and archived changes may inform the Foundation RFC or Research, but a human must review, accept, and merge the RFC.
