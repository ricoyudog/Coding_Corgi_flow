## ADDED Requirements

### Requirement: Empty catch blocks MUST log errors to stderr
All try/catch blocks in the CLI codebase SHALL log caught errors to `console.error` with sufficient context (file/operation name) rather than silently swallowing them with empty `catch {}` blocks.

#### Scenario: Catch block in non-critical path logs warning
- **WHEN** a non-critical operation (e.g., optional file read, metadata lookup) throws an error
- **THEN** the error message and operation context SHALL be written to stderr via `console.error`
- **AND** the command SHALL continue execution with graceful degradation

#### Scenario: Catch block in critical path logs error and sets exit code
- **WHEN** a critical operation (e.g., config parsing, required file write) throws an error
- **THEN** the error message and stack trace SHALL be written to stderr via `console.error`
- **AND** `process.exitCode` SHALL be set to 1

### Requirement: Commands MUST use process.exitCode for failure signaling
All command files SHALL use `process.exitCode = 1` to signal failure instead of `process.exit(1)`. This ensures cleanup handlers and pending I/O complete before the process terminates.

#### Scenario: Command encounters a fatal error
- **WHEN** any CLI command encounters a fatal error
- **THEN** the command SHALL set `process.exitCode = 1`
- **AND** the command SHALL NOT call `process.exit(1)` directly

#### Scenario: Command completes successfully
- **WHEN** any CLI command completes without error
- **THEN** `process.exitCode` SHALL remain 0 (default)
- **AND** no explicit exit call SHALL be made

### Requirement: Error variables MUST use unknown type with proper narrowing
Caught errors SHALL be typed as `unknown` and narrowed via `instanceof Error` or equivalent type guard before accessing `.message` or `.stack` properties. The `err: any` pattern is forbidden.

#### Scenario: Catch clause uses unknown type
- **WHEN** a try/catch block catches an error
- **THEN** the catch variable SHALL be typed as `unknown` (or left untyped, which defaults to `unknown` in strict mode)
- **AND** property access on the error SHALL only occur after type narrowing

#### Scenario: Error message extraction with narrowing
- **WHEN** an error is caught and its message needs to be logged
- **THEN** the code SHALL narrow via `if (err instanceof Error)` or `String(err)` before accessing properties
