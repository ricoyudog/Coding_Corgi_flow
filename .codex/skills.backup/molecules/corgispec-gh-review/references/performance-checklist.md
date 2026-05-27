# Review: Performance Checklist

Use this checklist during the review phase for deeper performance scrutiny. This is supplementary to the baseline Performance check in `quality-checks.md`.

This checklist is informational — it feeds findings into the review report. It does not independently block or approve.

## Core Principle

> **Measure before optimizing.** Flag patterns that are known performance risks. Do not prescribe specific optimizations without benchmark data. The goal is to identify potential problems, not to mandate solutions.

## Check Items

### 1. N+1 Query Patterns

- [ ] Check for queries inside loops:
  - Pattern: Database query (SELECT, find, get) called repeatedly inside a `for`, `while`, or `.map()`/`.forEach()` loop
  - Common in: ORM lazy loading, REST API calls in loops, GraphQL resolvers
  - Detection: Look for `.find(` / `.get(` / `.query(` / `fetch(` inside loop bodies
  
**Flag if found**: 🟡 Important — N+1 queries scale linearly with data size. Can degrade to minutes on moderate datasets.

### 2. Missing Pagination on List Endpoints

- [ ] Check list/GET-all endpoints for pagination support:
  - Pattern: API endpoint returning arrays/lists without `limit`, `offset`, `page`, `cursor` parameters
  - Red flag: `SELECT * FROM table` with no LIMIT clause
  - Red flag: `Model.find_all()` / `collection.find()` with no pagination args

**Flag if found**: 🟡 Important — Unpaginated endpoints can return unbounded data, causing memory exhaustion and client timeout.

### 3. Blocking Synchronous Operations

- [ ] Check for sync operations in async contexts:
  - Pattern: CPU-intensive work or blocking I/O in event loop (Node.js: `fs.readFileSync`, Python: blocking `requests.get` in async function)
  - Pattern: Heavy computation in request handlers without offloading to workers/queues
  - Detection: `readFileSync` / `writeFileSync` in Node.js. Blocking calls in `async def` Python functions.

**Flag if found**: 🟡 Important — Blocking operations stall the entire event loop/thread, preventing other requests from being served.

### 4. Bundle Size / Import Cost Concerns

- [ ] Check for unnecessary imports or heavy dependencies:
  - Pattern: Importing entire libraries for single utility functions (`import lodash` for just `_.get`)
  - Pattern: Large dependency added for minor functionality
  - Detection: Check package.json/bundle analysis. Look for tree-shaking opportunities.

**Flag if found**: 🔵 Suggestion — Bundle size impacts initial load time and user experience. Flag for awareness, not blocking.

### 5. Unbounded Loops or Memory Leaks

- [ ] Check for potential memory issues:
  - Pattern: Unbounded data accumulation (growing arrays without limiting, caching without eviction policy)
  - Pattern: Missing cleanup (`useEffect` without cleanup function, open streams/connections not closed)
  - Pattern: Event listeners added but not removed
  - Detection: `useEffect(() => { ... })` with no return cleanup. `setInterval` without `clearInterval`. `addEventListener` without `removeEventListener`.

**Flag if found**:
- Memory leaks → 🔴 Critical (can crash the application)
- Growing unbounded data structures → 🟡 Important (performance degrades over time)
- Missing stream cleanup → 🟡 Important

## Detection Techniques per Language

### Python

```bash
# N+1 queries: queries in loops
grep -nE "(for|while).*:\s*$" --include="*.py" . -A5 | grep -E "\.(filter|get|all|select|query)\("

# Blocking sync in async
grep -n "requests\.(get|post)" --include="*.py" . | head -20

# Missing cleanup: unclosed files
grep -nE "open\(.*\).*\.(read|write)" --include="*.py" . | grep -v "with "
```

### JavaScript/TypeScript

```bash
# N+1 queries: queries in loops
grep -rnE "(for|while|\.map|\.forEach).*\.(find|findOne|findAll|fetch)\(" --include="*.{js,ts,tsx}" .

# Blocking I/O
grep -rnE "\.readFileSync|\.writeFileSync" --include="*.{js,ts,tsx}" .

# Missing useEffect cleanup
grep -rnE "useEffect\(\s*\(\s*\)\s*=>\s*\{[^}]*\}" --include="*.{js,ts,tsx}" . | grep -v "return"

# Event listeners without cleanup
grep -rnE "addEventListener|setInterval" --include="*.{js,ts,tsx}" .
```

## Severity Guidance

| Finding | Default Severity | Rationale |
|---------|-----------------|-----------|
| Memory leak (missing cleanup, unclosed resources) | 🔴 Critical | Can crash the application under load |
| N+1 queries | 🟡 Important | Degrades with data scale; fix before production |
| Missing pagination | 🟡 Important | Memory/performance risk on large datasets |
| Blocking sync operations | 🟡 Important | Stalls request handling |
| Large bundle / heavy import | 🔵 Suggestion | UX concern; not blocking |
| Unbounded growth (caching, arrays) | 🟡 Important | Resource exhaustion risk |

**Reviewer's judgment applies**: The default severity is a starting point. Adjust based on actual context — a N+1 query on a table with 10 rows is less urgent than one on a table with 10 million.
